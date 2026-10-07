import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { hash } from "../src/crypto.js";
import { identityKey, assertIdentityOpen } from "../src/identity-fences.js";
import { restoreClosureFences, reconcileRecovery } from "../src/recovery.js";
import { StripeProvider } from "../src/stripe-provider.js";

const database = process.env.TEST_DATABASE_URL;
describe.skipIf(!database)(
  "isolated recovery fences and maintenance boundary",
  () => {
    const schema = `recovery_${randomBytes(8).toString("hex")}`;
    const target = new URL(
      database ?? "postgresql://unused@localhost/m8itwork_test",
    );
    target.searchParams.set("schema", schema);
    const source = new PrismaClient({ datasourceUrl: database! });
    const prisma = new PrismaClient({ datasourceUrl: target.toString() });
    beforeAll(async () => {
      if (!database || !new URL(database).pathname.endsWith("/m8itwork_test"))
        throw new Error("Dedicated test database required");
      // All globally applied restore effects are confined to this disposable schema.
      await source.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
      await promisify(execFile)(
        process.execPath,
        ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
        { env: { ...process.env, DATABASE_URL: target.toString() } },
      );
    }, 30000);
    afterAll(async () => {
      await prisma.$disconnect();
      await source.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await source.$disconnect();
    });
    it("restores current closed identities, fences old aliases and revokes restored sessions; collisions roll back", async () => {
      const account = await prisma.account.create({
        data: {
          email: `${randomUUID()}@example.invalid`,
          googleId: `old-${randomUUID()}`,
        },
      });
      await prisma.accountSession.create({
        data: {
          id: hash(randomUUID()),
          accountId: account.id,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const current = {
        id: account.id,
        email: `${randomUUID()}@example.invalid`,
        githubId: "retired-identity",
        googleId: `new-${randomUUID()}`,
        closedAt: new Date().toISOString(),
      };
      await restoreClosureFences(prisma, {
        accounts: [current],
        identities: [],
      });
      expect(await prisma.accountSession.count()).toBe(0);
      expect(
        await prisma.account.findUnique({ where: { id: account.id } }),
      ).toMatchObject({
        email: current.email,
        googleId: current.googleId,
        closedAt: expect.any(Date),
      });
      for (const [kind, value] of [
        ["email", account.email!],
        ["email", current.email],
        ["googleId", account.googleId!],
        ["googleId", current.googleId],
      ] as const) {
        expect(
          await prisma.closedIdentity.findUnique({
            where: { id: identityKey(kind, value) },
          }),
        ).not.toBeNull();
        await expect(
          assertIdentityOpen(prisma, kind, value),
        ).rejects.toMatchObject({ code: "ACCOUNT_CLOSED" });
      }
      const other = await prisma.account.create({
        data: { email: `${randomUUID()}@example.invalid` },
      });
      await expect(
        restoreClosureFences(prisma, {
          accounts: [{ ...current, email: other.email }],
          identities: [],
        }),
      ).rejects.toThrow();
      expect(
        await prisma.account.findUnique({ where: { id: other.id } }),
      ).toMatchObject({ closedAt: null });
      expect(
        await prisma.account.findUnique({ where: { id: account.id } }),
      ).toMatchObject({ email: current.email });
    });
    it("keeps authenticated and worker access closed while durably accepting signed Stripe events without applying them", async () => {
      const env = loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: target.toString(),
        RECOVERY_MODE: "true",
        STRIPE_SECRET_KEY: "sk_test_fixture",
        STRIPE_WEBHOOK_SECRET: "whsec_fixture",
      });
      const app = await buildApp({
        env,
        prisma,
        logger: false,
        rateLimiting: false,
      });
      try {
        expect((await app.inject({ url: "/health" })).json()).toMatchObject({
          status: "ok",
          recovery: true,
        });
        for (const route of [
          "/v1/auth/session",
          "/v1/projects",
          "/v1/operator/operations",
          "/v1/review-worker/claim",
        ])
          expect((await app.inject({ url: route })).statusCode).toBe(503);
        const id = `evt_${randomUUID()}`,
          stripe = new Stripe("sk_test_fixture");
        const payload = JSON.stringify({
          id,
          object: "event",
          type: "checkout.session.completed",
          livemode: false,
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: `cs_test_${randomUUID()}`,
              metadata: { attemptId: randomUUID() },
            },
          },
        });
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/v1/stripe/webhook",
              payload,
              headers: {
                "content-type": "application/json",
                "stripe-signature": "invalid",
              },
            })
          ).statusCode,
        ).toBe(400);
        const signature = stripe.webhooks.generateTestHeaderString({
          payload,
          secret: env.STRIPE_WEBHOOK_SECRET,
        });
        for (let i = 0; i < 2; i++)
          expect(
            (
              await app.inject({
                method: "POST",
                url: "/v1/stripe/webhook",
                payload,
                headers: {
                  "content-type": "application/json",
                  "stripe-signature": signature,
                },
              })
            ).statusCode,
          ).toBe(200);
        await app.maintenance();
        expect(
          await prisma.paymentInbox.findUnique({ where: { id } }),
        ).toMatchObject({ processedAt: null, attempts: 0 });
        expect(await prisma.paymentInbox.count({ where: { id } })).toBe(1);
      } finally {
        await app.close();
      }
    });
    it("blocks reopening for an app-owned post-snapshot Checkout even when the restored payment ledger is empty", async () => {
      await prisma.paymentInbox.deleteMany();
      const env = loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: target.toString(),
        STRIPE_SECRET_KEY: "sk_test_fixture",
        STRIPE_WEBHOOK_SECRET: "whsec_fixture",
      });
      async function* discover() {
        yield { id: "cs_test_post_snapshot", attemptId: randomUUID() };
      }
      let writes = 0;
      const result = await reconcileRecovery({
        prisma,
        provider: new StripeProvider(env),
        discover,
        reconcile: async () => {
          writes++;
        },
      });
      expect(result).toMatchObject({
        safeToReopen: false,
        unknownSessions: ["cs_test_post_snapshot"],
        reconciled: 0,
      });
      expect(writes).toBe(0);
    });
  },
);
