import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { readFile, writeFile } from "node:fs/promises";
import { encrypt, decrypt } from "../src/crypto.js";
import {
  closureFencesSchema,
  restoreClosureFences,
  reconcileRecovery,
  verifyRecoveryMerchant,
} from "../src/recovery.js";
import { loadEnv } from "../src/config.js";
import { StripeProvider } from "../src/stripe-provider.js";
import { createProjectAccess } from "../src/project-access.js";
import { registerPayments } from "../src/payments.js";
import Fastify from "fastify";

async function main() {
  const [command, file, frozenAt] = process.argv.slice(2),
    key = process.env.BACKUP_ENCRYPTION_KEY ?? "";
  if (Buffer.from(key, "base64").length !== 32 || !file)
    throw new Error(
      "Provide an encrypted fence file and separate 32-byte BACKUP_ENCRYPTION_KEY.",
    );
  const target = process.env.RECOVERY_DATABASE_URL;
  if (!target)
    throw new Error(
      "Provide RECOVERY_DATABASE_URL explicitly. Do not use the application's default database.",
    );
  const url = new URL(target);
  if (
    command !== "fences" &&
    (!url.pathname.includes("_restore_") ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error(
      "Reconciliation is restricted to an isolated local *_restore_* database.",
    );
  const prisma = new PrismaClient({ datasourceUrl: target });
  try {
    const env = loadEnv({
        ...process.env,
        DATABASE_URL: target,
        RECOVERY_MODE: "true",
      }),
      provider = new StripeProvider(env);
    if (!provider.enabled || !env.STRIPE_ACCOUNT_ID)
      throw new Error(
        "Original Stripe merchant ID and matching credentials are required.",
      );
    const stripe = new Stripe(env.STRIPE_SECRET_KEY),
      merchant = await stripe.accounts.retrieve(null);
    const identity = {
      accountId: merchant.id,
      mode: provider.mode as "test" | "live",
    };
    if (merchant.id !== env.STRIPE_ACCOUNT_ID)
      throw new Error("RECOVERY_MERCHANT_MISMATCH");
    if (command === "fences") {
      const accounts = await prisma.account.findMany({
        where: { closedAt: { not: null } },
        select: {
          id: true,
          closedAt: true,
          email: true,
          githubId: true,
          googleId: true,
        },
      });
      const identities = await prisma.closedIdentity.findMany();
      await writeFile(
        file,
        encrypt(
          JSON.stringify({
            capturedAt: new Date().toISOString(),
            accounts,
            identities,
            provider: identity,
          }),
          key,
        ),
        { mode: 0o600, flag: "wx" },
      );
      console.log(
        "Encrypted closed-account fences exported. Store separately from Railway before recovery.",
      );
    } else if (command === "reconcile") {
      const fences = closureFencesSchema.parse(
        JSON.parse(decrypt(await readFile(file, "utf8"), key)),
      );
      if (
        !frozenAt ||
        !Number.isFinite(Date.parse(frozenAt)) ||
        Date.parse(fences.capturedAt) < Date.parse(frozenAt)
      )
        throw new Error(
          "Closed-account fences must be captured after the original service was frozen. If unavailable, keep writes disabled and reconstruct them before recovery.",
        );
      verifyRecoveryMerchant(fences.provider, env.STRIPE_ACCOUNT_ID, identity);
      await restoreClosureFences(prisma, fences);
      const app = Fastify(),
        payments = await registerPayments(app, {
          prisma,
          env,
          access: createProjectAccess(prisma, env),
          provider,
        });
      // Enumerate all app-tagged Checkout sessions, including older open sessions
      // that could have completed after the snapshot. Missing mappings block recovery.
      const report = await reconcileRecovery({
        prisma,
        provider,
        reconcile: payments.reconcile,
        discover: async function* () {
          for await (const session of stripe.checkout.sessions.list({
            limit: 100,
          }))
            if (session.mode === "payment" && session.metadata?.attemptId)
              yield { id: session.id, attemptId: session.metadata.attemptId };
        },
      });
      await payments.processPending();
      const remaining = await prisma.paymentInbox.count({
        where: { processedAt: null, ignoredAt: null },
      });
      report.pendingEvents = remaining;
      report.safeToReopen =
        !report.unknownSessions.length &&
        !report.blockedAttempts.length &&
        remaining === 0;
      console.log(JSON.stringify(report));
      if (!report.safeToReopen) process.exitCode = 2;
      await app.close();
    } else
      throw new Error(
        "Use fences <new-encrypted-file> or reconcile <fence-file> <service-frozen-ISO-time>.",
      );
  } catch {
    console.error(
      "RECOVERY_BLOCKED: verify isolated database, latest closure fences, matching provider and unresolved transactions. Keep production access disabled.",
    );
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    "RECOVERY_CONFIGURATION_INVALID: verify private configuration; keep access disabled.",
  );
  process.exitCode = 2;
});
