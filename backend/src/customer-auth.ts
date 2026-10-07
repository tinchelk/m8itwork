import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type ReviewSession } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ACCOUNT_TTL, assertAccountOpen, cookieHash, requireAccount, setAccountCookie } from "./accounts.js";
import type { Env } from "./config.js";
import { isAppOrigin } from "./config.js";
import { decrypt, encrypt, hash, secret } from "./crypto.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { AppError } from "./shared/errors.js";
import { clientRateLimitKey } from "./proxy-trust.js";
import type { AccountEmailProvider } from "./account-email.js";
import type { GoogleProvider } from "./google-provider.js";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const passwordSchema = z.string().min(12).max(128);
const credentials = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const genericDelivery = { message: "If an account exists for that email, check your inbox. You can request another link if needed." };
export async function lockAccount(transaction: Prisma.TransactionClient, id: string) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`account:${id}`}, 0))`;
}
export async function replaceSession(transaction: Prisma.TransactionClient, request: FastifyRequest, review: ReviewSession, accountId: string, raw: string) {
  assertAccountOpen(await transaction.account.findUniqueOrThrow({ where: { id: accountId } }));
  const [active] = await transaction.$queryRaw<{ accountSessionId: string | null }[]>`SELECT "accountSessionId" FROM "ReviewSession" WHERE "id" = ${review.id} FOR UPDATE`;
  if (!active) throw new AppError(409, "SIGN_IN_CANCELLED", "This sign-in was cancelled. Please sign in again.");
  const previous = [cookieHash(request), active.accountSessionId].filter((value): value is string => Boolean(value));
  if (previous.length) await transaction.accountSession.deleteMany({ where: { id: { in: previous } } });
  await transaction.accountSession.create({ data: { id: hash(raw), accountId, expiresAt: new Date(Date.now() + ACCOUNT_TTL * 1000) } });
  await transaction.reviewSession.update({ where: { id: review.id }, data: {
    accountSessionId: hash(raw), selectedInspectionId: null, tokenEncrypted: null, tokenExpiresAt: null, githubLogin: null,
    oauthAttemptId: null, oauthStateHash: null, oauthExpiresAt: null, verifierEncrypted: null, oauthPurpose: null, oauthAccountId: null, oauthNonceHash: null,
  } });
}
export async function revokeAccount(transaction: Prisma.TransactionClient, accountId: string) {
  const sessions = await transaction.accountSession.findMany({ where: { accountId }, select: { id: true } });
  await transaction.reviewSession.updateMany({ where: { OR: [{ accountSessionId: { in: sessions.map(session => session.id) } }, { oauthAccountId: accountId }] }, data: {
    accountSessionId: null, selectedInspectionId: null, tokenEncrypted: null, tokenExpiresAt: null, githubLogin: null,
    oauthAttemptId: null, oauthStateHash: null, oauthExpiresAt: null, verifierEncrypted: null, oauthPurpose: null, oauthAccountId: null, oauthNonceHash: null,
  } });
  await transaction.accountSession.deleteMany({ where: { accountId } });
  await transaction.accountToken.deleteMany({ where: { accountId } });
}

export async function registerCustomerAuth(app: FastifyInstance, options: {
  prisma: PrismaClient; env: Env; email: AccountEmailProvider; google: GoogleProvider; rateLimiting: boolean;
  session: (request: FastifyRequest, reply: FastifyReply) => Promise<ReviewSession>;
}) {
  const { prisma, env, email, google, session } = options;
  function origin(request: FastifyRequest) {
    if (!isAppOrigin(env, request.headers.origin)) throw new AppError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
  }
  function emailAvailable() {
    if (!email.enabled) throw new AppError(503, "EMAIL_UNAVAILABLE", "Email signup is being set up. Please try again later.");
  }
  async function throttle(request: FastifyRequest, reply: FastifyReply, kind: string, identity: string, max: number) {
    if (!options.rateLimiting) return;
    const now = new Date(), until = new Date(now.getTime() + 15 * 60_000);
    const ids = [{ id: hash(`auth:${kind}:network:${clientRateLimitKey(env)(request)}`), limit: max * 3 }, { id: hash(`auth:${kind}:identity:${identity}`), limit: max }];
    for (const { id, limit } of ids) {
      const rows = await prisma.$queryRaw<{ count: number; expiresAt: Date }[]>`
        INSERT INTO "AuthThrottle" ("id", "count", "expiresAt") VALUES (${id}, 1, ${until})
        ON CONFLICT ("id") DO UPDATE SET
          "count" = CASE WHEN "AuthThrottle"."expiresAt" <= ${now} THEN 1 ELSE "AuthThrottle"."count" + 1 END,
          "expiresAt" = CASE WHEN "AuthThrottle"."expiresAt" <= ${now} THEN ${until} ELSE "AuthThrottle"."expiresAt" END
        RETURNING "count", "expiresAt"`;
      if (rows[0]!.count > limit) {
        reply.header("Retry-After", Math.max(1, Math.ceil((rows[0]!.expiresAt.getTime() - Date.now()) / 1000)));
        throw new AppError(429, "AUTH_THROTTLED", "Too many account requests. Please wait a few minutes and try again.");
      }
    }
  }
  async function issue(accountId: string, destination: string, purpose: "VERIFY_EMAIL" | "RESET_PASSWORD", pending?: { passwordHash: string; displayName: string | null; previousId?: string }) {
    const raw = secret();
    const created = await prisma.$transaction(async transaction => {
      await lockAccount(transaction, accountId);
      const account = await transaction.account.findUniqueOrThrow({ where: { id: accountId } });
      // The recovery address may have changed since the public email lookup.
      if (account.closedAt || account.email !== destination) return false;
      if (purpose === "VERIFY_EMAIL") {
        if (account.emailVerifiedAt || !pending) return false;
        if (pending.previousId && !(await transaction.accountToken.findUnique({ where: { id: pending.previousId } }))) return false;
      }
      await transaction.accountToken.deleteMany({ where: { accountId, purpose } });
      await transaction.accountToken.create({ data: { id: hash(raw), accountId, purpose, pendingPasswordHash: pending?.passwordHash ?? null, pendingDisplayName: pending?.displayName ?? null, expiresAt: new Date(Date.now() + (purpose === "VERIFY_EMAIL" ? 24 * 60 : 30) * 60_000) } });
      return true;
    });
    if (!created) return null;
    const url = new URL(purpose === "VERIFY_EMAIL" ? "/verify-email" : "/reset-password", env.FRONTEND_ORIGIN);
    // Fragment tokens stay out of request URLs, referrer headers and HTTP logs.
    url.hash = `token=${raw}`;
    return { raw, actionUrl: url.toString(), deliveryId: hash(raw) };
  }
  app.post("/v1/auth/register", async (request, reply) => {
    origin(request); emailAvailable();
    const input = credentials.extend({ password: passwordSchema, displayName: z.string().trim().min(1).max(100), consent: z.literal(true) }).parse(request.body);
    await throttle(request, reply, "registration", input.email, 3);
    const existing = await prisma.account.findUnique({ where: { email: input.email } });
    const passwordHash = await hashPassword(input.password);
    let account = existing;
    if (!account) {
      try { account = await prisma.account.create({ data: { email: input.email, displayName: input.displayName } }); }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        account = await prisma.account.findUnique({ where: { email: input.email } });
      }
    }
    if (account && !account.emailVerifiedAt) {
      const issued = await issue(account.id, input.email, "VERIFY_EMAIL", { passwordHash, displayName: input.displayName });
      if (issued) await email.send({ to: input.email, purpose: "VERIFY_EMAIL", ...issued });
    }
    return reply.code(202).send({ message: "Check your inbox to verify your email. If you already have an account, sign in or reset your password." });
  });
  app.post("/v1/auth/login", async (request, reply) => {
    origin(request);
    const input = credentials.parse(request.body);
    await throttle(request, reply, "login", input.email, 8);
    const review = await session(request, reply), attempt = hash(secret());
    await prisma.reviewSession.update({ where: { id: review.id }, data: { oauthAttemptId: attempt, oauthPurpose: "email-login", oauthStateHash: null, oauthExpiresAt: null, verifierEncrypted: null, oauthNonceHash: null, oauthAccountId: null } });
    const account = await prisma.account.findUnique({ where: { email: input.email } });
    const pending = account && !account.emailVerifiedAt ? await prisma.accountToken.findFirst({ where: { accountId: account.id, purpose: "VERIFY_EMAIL", expiresAt: { gt: new Date() } } }) : null;
    if (!(await verifyPassword(input.password, account?.emailVerifiedAt ? account.passwordHash : pending?.pendingPasswordHash ?? null)) || !account)
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    if (!account.emailVerifiedAt) throw new AppError(403, "EMAIL_UNVERIFIED", "Please verify your email before signing in. You can request another verification email below.");
    const raw = secret();
    await prisma.$transaction(async transaction => {
      await lockAccount(transaction, account.id);
      const latest = await transaction.account.findUniqueOrThrow({ where: { id: account.id } });
      if (latest.passwordHash !== account.passwordHash) throw new AppError(401, "INVALID_CREDENTIALS", "Your password changed. Please sign in again.");
      const guarded = await transaction.reviewSession.updateMany({ where: { id: review.id, oauthAttemptId: attempt, expiresAt: { gt: new Date() } }, data: { oauthAttemptId: null } });
      if (guarded.count !== 1) throw new AppError(409, "SIGN_IN_CANCELLED", "This sign-in was cancelled. Please sign in again.");
      await replaceSession(transaction, request, review, account.id, raw);
    });
    setAccountCookie(reply, raw, env);
    return { signedIn: true };
  });
  app.post("/v1/auth/email-verification/request", async (request, reply) => {
    origin(request); emailAvailable();
    const { email: address, password } = credentials.parse(request.body);
    await throttle(request, reply, "verification-email", address, 3);
    const account = await prisma.account.findUnique({ where: { email: address } });
    const pending = account && !account.emailVerifiedAt ? await prisma.accountToken.findFirst({ where: { accountId: account.id, purpose: "VERIFY_EMAIL" } }) : null;
    const matches = await verifyPassword(password, pending?.pendingPasswordHash ?? null);
    if (account && pending?.pendingPasswordHash && matches) {
      const issued = await issue(account.id, address, "VERIFY_EMAIL", { passwordHash: pending.pendingPasswordHash, displayName: pending.pendingDisplayName, previousId: pending.id });
      if (issued) await email.send({ to: address, purpose: "VERIFY_EMAIL", ...issued });
    }
    return reply.code(202).send(genericDelivery);
  });
  app.post("/v1/auth/email-verification/confirm", async (request, reply) => {
    origin(request);
    const { token } = z.object({ token: tokenSchema }).strict().parse(request.body);
    await throttle(request, reply, "verify-token", "verify:" + hash(token), 15);
    const record = await prisma.accountToken.findUnique({ where: { id: hash(token) } });
    if (!record || !record.pendingPasswordHash || record.purpose !== "VERIFY_EMAIL" || record.expiresAt <= new Date()) throw new AppError(400, "TOKEN_EXPIRED", "This link expired or was already used. Create your account again or reset your password.");
    await prisma.$transaction(async transaction => {
      await lockAccount(transaction, record.accountId);
      const consumed = await transaction.accountToken.deleteMany({ where: { id: record.id, purpose: "VERIFY_EMAIL", expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) throw new AppError(400, "TOKEN_EXPIRED", "This link expired or was already used. Request a new verification email.");
      await transaction.account.update({ where: { id: record.accountId }, data: { emailVerifiedAt: new Date(), passwordHash: record.pendingPasswordHash, ...(record.pendingDisplayName ? { displayName: record.pendingDisplayName } : {}) } });
    });
    return { verified: true };
  });
  app.post("/v1/auth/password-reset/request", async (request, reply) => {
    origin(request); emailAvailable();
    const { email: address } = z.object({ email: emailSchema }).strict().parse(request.body);
    await throttle(request, reply, "reset-email", address, 3);
    const account = await prisma.account.findUnique({ where: { email: address } });
    if (account) {
      const issued = await issue(account.id, address, "RESET_PASSWORD");
      try { if (issued) await email.send({ to: address, purpose: "RESET_PASSWORD", ...issued }); }
      catch { request.log.warn({ requestId: request.id }, "password recovery email could not be sent"); }
    }
    return reply.code(202).send(genericDelivery);
  });
  app.post("/v1/auth/password-reset/confirm", async (request, reply) => {
    origin(request);
    const input = z.object({ token: tokenSchema, password: passwordSchema }).strict().parse(request.body);
    await throttle(request, reply, "reset-token", hash(input.token), 8);
    const record = await prisma.accountToken.findUnique({ where: { id: hash(input.token) } });
    if (!record || record.purpose !== "RESET_PASSWORD" || record.expiresAt <= new Date()) throw new AppError(400, "TOKEN_EXPIRED", "This link expired or was already used. Request a new password reset.");
    const passwordHash = await hashPassword(input.password);
    await prisma.$transaction(async transaction => {
      await lockAccount(transaction, record.accountId);
      const consumed = await transaction.accountToken.deleteMany({ where: { id: record.id, purpose: "RESET_PASSWORD", expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) throw new AppError(400, "TOKEN_EXPIRED", "This link expired or was already used. Request a new password reset.");
      await transaction.account.update({ where: { id: record.accountId }, data: { passwordHash, emailVerifiedAt: new Date() } });
      await revokeAccount(transaction, record.accountId);
    });
    return { reset: true };
  });
  app.get("/v1/auth/google/connect", async (request, reply) => {
    if (!env.GOOGLE_CLIENT_ID) throw new AppError(503, "GOOGLE_UNAVAILABLE", "Google sign-in is being set up.");
    const { flow } = z.object({ flow: z.enum(["login", "link"]).default("login") }).parse(request.query);
    const account = flow === "link" ? await requireAccount(prisma, request) : null;
    const review = await session(request, reply);
    await throttle(request, reply, "google", account?.id ?? review.id, 6);
    const state = secret(), verifier = secret(), nonce = secret();
    await prisma.reviewSession.update({ where: { id: review.id }, data: {
      oauthAttemptId: hash(state), oauthStateHash: hash(state), oauthNonceHash: hash(nonce),
      oauthPurpose: flow === "link" ? "google-link" : "google-login", oauthAccountId: account?.id ?? null,
      oauthExpiresAt: new Date(Date.now() + 10 * 60_000), verifierEncrypted: encrypt(verifier, env.TOKEN_ENCRYPTION_KEY),
    } });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for (const [key, value] of Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.PUBLIC_API_URL}/v1/auth/google/callback`,
      response_type: "code", scope: "openid email profile", state, nonce, prompt: "select_account",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" })) url.searchParams.set(key, value);
    return reply.redirect(url.toString());
  });
  app.get("/v1/auth/google/callback", async (request, reply) => {
    const review = await session(request, reply), destination = new URL(review.oauthPurpose === "google-link" ? "/account" : "/dashboard", env.FRONTEND_ORIGIN);
    try {
      const { state, code } = z.object({ state: tokenSchema, code: z.string().min(1).max(2048) }).parse(request.query);
      if (!env.GOOGLE_CLIENT_ID || !["google-login", "google-link"].includes(review.oauthPurpose ?? "") || review.oauthStateHash !== hash(state) || !review.verifierEncrypted || !review.oauthNonceHash)
        throw new AppError(400, "OAUTH_STATE", "Restart Google sign-in.");
      const consumed = await prisma.reviewSession.updateMany({ where: { id: review.id, oauthStateHash: hash(state), oauthExpiresAt: { gt: new Date() } },
        data: { oauthStateHash: null, oauthExpiresAt: null, verifierEncrypted: null, oauthNonceHash: null } });
      if (consumed.count !== 1) throw new AppError(400, "OAUTH_STATE", "Restart Google sign-in.");
      const identity = await google.exchange({ code, verifier: decrypt(review.verifierEncrypted, env.TOKEN_ENCRYPTION_KEY), nonceHash: review.oauthNonceHash });
      const link = review.oauthPurpose === "google-link", raw = secret();
      const finishGoogle = () => prisma.$transaction(async transaction => {
        const active = await transaction.reviewSession.findUniqueOrThrow({ where: { id: review.id } });
        if (active.oauthAttemptId !== hash(state) || active.expiresAt <= new Date()) throw new AppError(400, "OAUTH_CANCELLED", "Google sign-in was cancelled.");
        let account = await transaction.account.findUnique({ where: { googleId: identity.id } });
        if (link) {
          const signedIn = await transaction.accountSession.findUnique({ where: { id: cookieHash(request) ?? "" } });
          if (!signedIn || signedIn.expiresAt <= new Date() || signedIn.accountId !== review.oauthAccountId || active.accountSessionId !== signedIn.id)
            throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in again to link Google.");
          await lockAccount(transaction, signedIn.accountId);
          const current = await transaction.account.findUniqueOrThrow({ where: { id: signedIn.accountId } });
          assertAccountOpen(current);
          if (!identity.mailboxAuthoritative && (!current.emailVerifiedAt || current.email !== identity.email))
            throw new AppError(409, "GOOGLE_EMAIL_CHALLENGE", "Verify your email before connecting this Google account.");
          const emailOwner = await transaction.account.findUnique({ where: { email: identity.email } });
          if (current.email && current.email !== identity.email)
            throw new AppError(409, "ACCOUNT_LINK_EMAIL", "Choose the same email as your m8itwork account.");
          if ((account && account.id !== current.id) || (current.googleId && current.googleId !== identity.id))
            throw new AppError(409, "ACCOUNT_LINK", "Use the same verified email and an unlinked Google account.");
          if (emailOwner && emailOwner.id !== current.id) throw new AppError(409, "ACCOUNT_LINK", "That email belongs to another account. Sign in with it instead.");
          account = await transaction.account.update({ where: { id: current.id }, data: { googleId: identity.id, email: identity.email, emailVerifiedAt: new Date() } });
        } else if (!account) {
          if (!identity.mailboxAuthoritative) throw new AppError(409, "GOOGLE_EMAIL_CHALLENGE", "Create a verified email account first, then connect Google from Account settings.");
          if (await transaction.account.findUnique({ where: { email: identity.email } })) throw new AppError(409, "ACCOUNT_EXISTS", "Sign in to your existing account before linking Google.");
          account = await transaction.account.create({ data: { googleId: identity.id, email: identity.email, emailVerifiedAt: new Date(), displayName: identity.name } });
          await lockAccount(transaction, account.id);
        } else await lockAccount(transaction, account.id);
        let recoveryConflict = false, recoveryChanged = false;
        if (!link) {
          const current = await transaction.account.findUniqueOrThrow({ where: { id: account.id } });
          assertAccountOpen(current);
          if (current.email !== identity.email) {
            recoveryChanged = true;
            const emailOwner = identity.mailboxAuthoritative ? await transaction.account.findUnique({ where: { email: identity.email } }) : null;
            recoveryConflict = !identity.mailboxAuthoritative || Boolean(emailOwner && emailOwner.id !== current.id);
            // Retire a stale recovery address even when the new address cannot be bound.
            await transaction.account.update({ where: { id: current.id }, data: { email: recoveryConflict ? null : identity.email, emailVerifiedAt: recoveryConflict ? null : new Date(), passwordHash: null } });
            await transaction.accountToken.deleteMany({ where: { accountId: current.id } });
          }
        }
        const guarded = await transaction.reviewSession.updateMany({ where: { id: review.id, oauthAttemptId: hash(state), expiresAt: { gt: new Date() } }, data: { oauthAttemptId: null } });
        if (guarded.count !== 1) throw new AppError(400, "OAUTH_CANCELLED", "Google sign-in was cancelled.");
        if (recoveryChanged) await revokeAccount(transaction, account.id);
        await replaceSession(transaction, request, review, account.id, raw);
        return recoveryConflict;
      });
      let recoveryConflict: boolean;
      try { recoveryConflict = await finishGoogle(); }
      catch (error) {
        // A concurrent email claim must retire the old recovery address on retry.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        recoveryConflict = await finishGoogle();
      }
      setAccountCookie(reply, raw, env);
      if (recoveryConflict) destination.pathname = "/account";
      destination.searchParams.set("google", recoveryConflict ? "recovery-conflict" : "connected");
    } catch (error) {
      destination.searchParams.set("google", error instanceof AppError && error.code === "ACCOUNT_CLOSED" ? "account-closed" : error instanceof AppError && error.code === "ACCOUNT_EXISTS" ? "link" : error instanceof AppError && error.code === "ACCOUNT_LINK_EMAIL" ? "link-mismatch" : error instanceof AppError && error.code === "ACCOUNT_LINK" ? "link-unavailable" : error instanceof AppError && error.code === "GOOGLE_EMAIL_CHALLENGE" ? "verify-email" : "error");
    }
    return reply.redirect(destination.toString());
  });
}
