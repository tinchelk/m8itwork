import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccount, isOperator } from "./accounts.js";
import { lockAccount } from "./customer-auth.js";
import { isAppOrigin, type Env } from "./config.js";
import { decrypt, encrypt, hash, secret } from "./crypto.js";
import { AppError } from "./shared/errors.js";
import { financialLock } from "./financial-lock.js";

export interface ProjectEmail {
  to: string;
  kind: string;
  actionUrl: string;
  deliveryId: string;
}
export interface ProjectEmailProvider {
  readonly enabled: boolean;
  send(message: ProjectEmail): Promise<void>;
}
export class ResendProjectEmail implements ProjectEmailProvider {
  readonly enabled: boolean;
  constructor(private env: Env) {
    this.enabled = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  }
  async send(message: ProjectEmail) {
    const verify = message.kind === "VERIFY_CONTACT";
    const team = message.kind.startsWith("OPERATOR_");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.deliveryId,
      },
      body: JSON.stringify({
        from: `m8itwork <${this.env.EMAIL_FROM}>`,
        to: [message.to],
        subject: verify
          ? "Verify your notification email — m8itwork"
          : team
            ? "Your backoffice needs attention — m8itwork"
            : "Your project has an update — m8itwork",
        text: verify
          ? `Confirm this email for project updates. This link expires in 30 minutes. It does not change your sign-in or recovery email.\n\n${message.actionUrl}\n\nIf you didn't request this, ignore it.`
          : `There is an update in your m8itwork ${team ? "backoffice" : "dashboard"}. Sign in to see the details.\n\n${message.actionUrl}\n\nManage project emails in Account settings.`,
      }),
    });
    if (!response.ok) throw new Error("EMAIL_UNAVAILABLE");
    await response.body?.cancel();
  }
}
export async function enqueueUpdate(
  tx: Prisma.TransactionClient,
  accountId: string,
  projectId: string,
  kind: string,
  id: string,
) {
  await tx.notificationOutbox.upsert({
    where: { id },
    update: {},
    create: { id, accountId, projectId, kind },
  });
}
export async function enqueueOperators(
  tx: Prisma.TransactionClient,
  env: Env,
  kind: string,
  id: string,
  projectId: string | null = null,
) {
  const operators = await tx.account.findMany({
    where: {
      githubId: {
        in: env.OPERATOR_GITHUB_IDS.split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      },
      closedAt: null,
    },
    select: { id: true },
  });
  for (const account of operators)
    await tx.notificationOutbox.upsert({
      where: { id: `${id}:${account.id}` },
      update: {},
      create: {
        id: `${id}:${account.id}`,
        accountId: account.id,
        projectId,
        kind,
      },
    });
}
export async function registerNotifications(
  app: FastifyInstance,
  prisma: PrismaClient,
  env: Env,
  provider: ProjectEmailProvider,
) {
  const origin = (value: string | undefined) => {
    if (!isAppOrigin(env, value))
      throw new AppError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "Request origin is not allowed.",
      );
  };
  app.get("/v1/auth/notifications", async (request) => {
    const account = await requireAccount(prisma, request);
    return {
      enabled: provider.enabled,
      email: account.notificationEmail ?? account.email,
      verified: Boolean(
        account.notificationEmail
          ? account.notificationVerifiedAt
          : account.emailVerifiedAt,
      ),
      projectUpdates: account.projectNotifications,
      operatorAlerts: isOperator(account, env)
        ? account.operatorNotifications
        : null,
    };
  });
  app.post("/v1/auth/notifications", async (request) => {
    origin(request.headers.origin);
    const account = await requireAccount(prisma, request);
    const input = z
      .object({
        projectUpdates: z.boolean().optional(),
        operatorAlerts: z.boolean().optional(),
      })
      .strict()
      .refine(
        (v) => v.projectUpdates !== undefined || v.operatorAlerts !== undefined,
      )
      .parse(request.body);
    if (input.operatorAlerts !== undefined && !isOperator(account, env))
      throw new AppError(
        403,
        "OPERATOR_REQUIRED",
        "Team alerts are for approved operators.",
      );
    await prisma.$transaction(
      async (tx) => {
        await lockAccount(tx, account.id);
        await financialLock(tx);
        const active = await requireAccount(tx, request);
        if (active.id !== account.id)
          throw new AppError(409, "ACCOUNT_CHANGED", "Refresh your account.");
        await tx.account.update({
          where: { id: account.id },
          data: {
            ...(input.projectUpdates !== undefined
              ? { projectNotifications: input.projectUpdates }
              : {}),
            ...(input.operatorAlerts !== undefined
              ? { operatorNotifications: input.operatorAlerts }
              : {}),
          },
        });
      },
      { timeout: 20_000 },
    );
    return { saved: true };
  });
  app.post("/v1/auth/notifications/contact", async (request) => {
    origin(request.headers.origin);
    if (
      !provider.enabled ||
      Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64").length !== 32
    )
      throw new AppError(
        503,
        "EMAIL_UNAVAILABLE",
        "Notification email is unavailable. Updates are still in your dashboard.",
      );
    const account = await requireAccount(prisma, request);
    const { email } = z
      .object({
        email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
      })
      .strict()
      .parse(request.body);
    const raw = secret(),
      tokenId = hash(raw),
      action = new URL("/account", env.FRONTEND_ORIGIN);
    action.hash = `contact=${raw}`;
    await prisma.$transaction(
      async (tx) => {
        await lockAccount(tx, account.id);
        await financialLock(tx);
        const active = await requireAccount(tx, request);
        if (active.id !== account.id)
          throw new AppError(409, "ACCOUNT_CHANGED", "Refresh your account.");
        if (
          (await tx.notificationOutbox.count({
            where: {
              accountId: account.id,
              kind: "VERIFY_CONTACT",
              createdAt: { gt: new Date(Date.now() - 3600_000) },
            },
          })) >= 3
        )
          throw new AppError(
            429,
            "CONTACT_THROTTLED",
            "Wait an hour before requesting another notification email link.",
          );
        await tx.notificationToken.create({
          data: {
            id: tokenId,
            accountId: account.id,
            email,
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
        await tx.notificationOutbox.create({
          data: {
            id: `contact:${tokenId}`,
            accountId: account.id,
            kind: "VERIFY_CONTACT",
            destination: email,
            verificationUrlEncrypted: encrypt(
              action.toString(),
              env.TOKEN_ENCRYPTION_KEY,
            ),
          },
        });
      },
      { timeout: 20_000 },
    );
    return {
      message:
        "Check that inbox for a verification link. Your sign-in email stays the same.",
    };
  });
  app.post("/v1/auth/notifications/verify", async (request) => {
    origin(request.headers.origin);
    const account = await requireAccount(prisma, request),
      { token } = z
        .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .strict()
        .parse(request.body);
    await prisma.$transaction(
      async (tx) => {
        await lockAccount(tx, account.id);
        await financialLock(tx);
        const active = await requireAccount(tx, request);
        if (active.id !== account.id)
          throw new AppError(409, "ACCOUNT_CHANGED", "Refresh your account.");
        const saved = await tx.notificationToken.findFirst({
          where: {
            id: hash(token),
            accountId: account.id,
            expiresAt: { gt: new Date() },
          },
        });
        if (!saved)
          throw new AppError(
            400,
            "CONTACT_LINK_EXPIRED",
            "This link is unavailable. Request a new notification verification link.",
          );
        await tx.account.update({
          where: { id: account.id },
          data: {
            notificationEmail: saved.email,
            notificationVerifiedAt: new Date(),
          },
        });
        await tx.notificationToken.deleteMany({
          where: { accountId: account.id },
        });
      },
      { timeout: 20_000 },
    );
    return { verified: true };
  });
  async function process() {
    if (!provider.enabled) return;
    const rows = await prisma.notificationOutbox.findMany({
      where: {
        sentAt: null,
        skippedAt: null,
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    for (const row of rows) {
      const leaseUntil = new Date(Date.now() + 60_000);
      const reserved = await prisma.$transaction(async (tx) => {
        await financialLock(tx);
        const current = await tx.notificationOutbox.findUnique({
          where: { id: row.id },
          include: { account: true },
        });
        if (!current) return false;
        if (
          current.sentAt ||
          current.skippedAt ||
          (current.leaseUntil && current.leaseUntil > new Date())
        )
          return false;
        const contact = current.kind === "VERIFY_CONTACT";
        const destination = contact
          ? current.destination
          : (current.account.notificationEmail ?? current.account.email);
        const verified = current.account.notificationEmail
          ? current.account.notificationVerifiedAt
          : current.account.emailVerifiedAt;
        const expiredRetry =
          current.firstAttemptAt &&
          Date.now() - current.firstAttemptAt.getTime() >= 23 * 3600_000;
        if (
          (current.kind.startsWith("OPERATOR_") &&
            !isOperator(current.account, env)) ||
          current.account.closedAt ||
          (!contact &&
            !(current.kind.startsWith("OPERATOR_")
              ? current.account.operatorNotifications
              : current.account.projectNotifications)) ||
          expiredRetry ||
          (current.destination && current.destination !== destination)
        ) {
          await tx.notificationOutbox.update({
            where: { id: row.id },
            data: {
              skippedAt: new Date(),
              lastError: expiredRetry ? "DELIVERY_UNCERTAIN" : null,
              verificationUrlEncrypted: null,
            },
          });
          return false;
        }
        if (!destination || (!contact && !verified)) {
          await tx.notificationOutbox.update({
            where: { id: row.id },
            data: {
              nextAttemptAt: new Date(Date.now() + 3600_000),
              lastError: "CONTACT_REQUIRED",
            },
          });
          return false;
        }
        await tx.notificationOutbox.update({
          where: { id: row.id },
          data: {
            destination,
            leaseUntil,
            firstAttemptAt: current.firstAttemptAt ?? new Date(),
            attempts: { increment: 1 },
          },
        });
        return true;
      });
      if (!reserved) continue;
      // Dispatch uses only this account's fence. Slow delivery cannot block
      // other tenants' payments, project mutations or worker heartbeats.
      await prisma.$transaction(
        async (tx) => {
          await lockAccount(tx, row.accountId);
          const current = await tx.notificationOutbox.findUnique({
            where: { id: row.id },
            include: { account: true },
          });
          if (!current) return;
          if (
            current.sentAt ||
            current.skippedAt ||
            current.leaseUntil?.getTime() !== leaseUntil.getTime()
          )
            return;
          const contact = current.kind === "VERIFY_CONTACT";
          const verified = current.account.notificationEmail
            ? current.account.notificationVerifiedAt
            : current.account.emailVerifiedAt;
          const destination = contact
            ? current.destination
            : (current.account.notificationEmail ?? current.account.email);
          const token = contact
            ? await tx.notificationToken.findUnique({
                where: { id: current.id.slice(8) },
              })
            : null;
          if (
            (current.kind.startsWith("OPERATOR_") &&
              !isOperator(current.account, env)) ||
            current.account.closedAt ||
            (!contact &&
              !(current.kind.startsWith("OPERATOR_")
                ? current.account.operatorNotifications
                : current.account.projectNotifications)) ||
            (contact && (!token || token.expiresAt <= new Date()))
          ) {
            await tx.notificationOutbox.update({
              where: { id: row.id },
              data: { skippedAt: new Date(), verificationUrlEncrypted: null },
            });
            return;
          }
          if (!destination || (!contact && !verified)) {
            await tx.notificationOutbox.update({
              where: { id: row.id },
              data: {
                nextAttemptAt: new Date(Date.now() + 3600_000),
                lastError: "CONTACT_REQUIRED",
              },
            });
            return;
          }
          // Freeze a destination for an ambiguous retry. If it changed, suppress this event;
          // never deliver a previously accepted request to a replacement mailbox.
          if (current.destination && current.destination !== destination) {
            await tx.notificationOutbox.update({
              where: { id: row.id },
              data: { skippedAt: new Date() },
            });
            return;
          }
          const action = new URL(
            current.kind.startsWith("OPERATOR_") ? "/" : "/dashboard",
            current.kind.startsWith("OPERATOR_")
              ? env.ADMIN_ORIGIN
              : env.FRONTEND_ORIGIN,
          );
          if (current.projectId)
            action.searchParams.set("project", current.projectId);
          try {
            await provider.send({
              to: destination,
              kind: current.kind,
              actionUrl: contact
                ? decrypt(
                    current.verificationUrlEncrypted!,
                    env.TOKEN_ENCRYPTION_KEY,
                  )
                : action.toString(),
              deliveryId: hash(`notification:${row.id}`),
            });
            await tx.notificationOutbox.update({
              where: { id: row.id },
              data: {
                sentAt: new Date(),
                leaseUntil: null,
                lastError: null,
                verificationUrlEncrypted: null,
              },
            });
          } catch {
            // Resend retains idempotency keys for 24h; stop ambiguous retries inside that window.
            await tx.notificationOutbox.update({
              where: { id: row.id },
              data: {
                leaseUntil: null,
                lastError: "EMAIL_UNAVAILABLE",
                nextAttemptAt: new Date(
                  Date.now() +
                    Math.min(
                      3600_000,
                      30_000 * 2 ** Math.min(current.attempts, 7),
                    ),
                ),
              },
            });
          }
        },
        { timeout: 20_000 },
      );
    }
  }
  return { process };
}
