import { assertIdentityOpen } from "./identity-fences.js";
import { createHash } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { PrismaClient, type Account, type ReviewSession } from "@prisma/client";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { isAppOrigin, loadEnv, type Env } from "./config.js";
import { decrypt, encrypt, hash, secret } from "./crypto.js";
import { GitHubClient, type Fetch } from "./github/client.js";
import { AppError } from "./shared/errors.js";
import {
  ACCOUNT_COOKIE,
  ACCOUNT_TTL,
  accountFromRequest,
  assertAccountOpen,
  cookieHash,
  isOperator,
  requireAccount,
  setAccountCookie,
} from "./accounts.js";
import { registerCustomerAuth, lockAccount } from "./customer-auth.js";
import { ResendAccountEmail, type AccountEmailProvider } from "./account-email.js";
import { GoogleOidcProvider, type GoogleProvider } from "./google-provider.js";
import { registerReviews } from "./reviews/routes.js";
import { registerWorkspace } from "./workspace.js";
import { registerNotifications, ResendProjectEmail, type ProjectEmailProvider } from "./notifications.js";
import { registerOperations } from "./operations.js";
import { cleanup } from "./maintenance.js";
import { StripeProvider, type PaymentProvider } from "./stripe-provider.js";
import { StripeBillingProvider, type BillingProvider } from "./billing-provider.js";
import { registerBilling } from "./billing.js";
import { registerAccountClosure } from "./account-closure.js";
import { clientRateLimitKey } from "./proxy-trust.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
    maintenance: () => Promise<void>;
  }
}
const COOKIE = "m8_review_session";
const workflowOptions = [
  "Login & permissions",
  "Payments",
  "Data & dashboards",
  "External integrations",
  "Build & launch",
  "New features",
  "Other",
] as const;
const optionalDemo = z
  .union([
    z.literal(""),
    z
      .url()
      .max(500)
      .refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        );
      }, "Use an http or https demo link without credentials."),
  ])
  .optional();
const submissionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    projectName: z.string().trim().min(1).max(120),
    platform: z.enum(["Lovable", "Base44", "Bolt", "Replit", "Other"]),
    demoUrl: optionalDemo,
    problem: z.string().trim().min(20).max(5000),
    workflows: z
      .array(z.enum(workflowOptions))
      .min(1)
      .max(workflowOptions.length),
    inspectionId: z.uuid().optional(),
    consent: z.literal(true),
  })
  .strict();

export async function buildApp(
  options: {
    env?: Env;
    prisma?: PrismaClient;
    fetcher?: Fetch;
    logger?: boolean;
    rateLimiting?: boolean;
    paymentProvider?: PaymentProvider;
    billingProvider?: BillingProvider;
    accountEmailProvider?: AccountEmailProvider;
    projectEmailProvider?: ProjectEmailProvider;
    googleProvider?: GoogleProvider;
  } = {},
) {
  const env = options.env ?? loadEnv();
  const prisma =
    options.prisma ?? new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  const github = new GitHubClient(options.fetcher);
  const accountEmail = options.accountEmailProvider ?? new ResendAccountEmail(env);
  const app = Fastify({
    logger: options.logger ?? { level: "info" },
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    bodyLimit: 16_000,
  });
  app.decorate("config", env);
  await app.register(cookie);
  await app.register(cors, {
    origin: [env.FRONTEND_ORIGIN, env.ADMIN_ORIGIN],
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  });
  await app.register(helmet);
  await app.register(rateLimit, {
    global: options.rateLimiting ?? true,
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: clientRateLimitKey(env),
  });
  app.addHook("onRequest", async (request, reply) => {
    if (env.RECOVERY_MODE && request.url.startsWith("/v1/") && request.url.split("?")[0] !== "/v1/stripe/webhook") throw new AppError(503, "RECOVERY_MODE", "The service is recovering. Your project history is being reconciled before access resumes.");
    reply.header("Cache-Control", "no-store");
    reply.header("x-request-id", request.id);
    if (
      request.method === "POST" &&
      request.headers.origin &&
      !isAppOrigin(env, request.headers.origin)
    ) {
      throw new AppError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "Request origin is not allowed.",
      );
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Please check the form fields and try again.",
          requestId: request.id,
        },
      });
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
    if (statusCode === 400 || statusCode === 413 || statusCode === 415) {
      return reply.code(statusCode).send({
        error: {
          code: "INVALID_BODY",
          message: "Send a valid, reasonably sized JSON form and try again.",
          requestId: request.id,
        },
      });
    }
    if (statusCode === 429)
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message:
            "Too many requests. Please wait a few minutes and try again.",
          requestId: request.id,
        },
      });
    // Do not log callback URLs, OAuth codes, repository contents, credentials, or submitted briefs.
    request.log.error(
      { requestId: request.id },
      "request could not be completed",
    );
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message:
          "We couldn't complete that request. Your brief has not been confirmed; please try again.",
        requestId: request.id,
      },
    });
  });

  async function session(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ReviewSession> {
    const token = request.cookies[COOKIE];
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      const existing = await prisma.reviewSession.findUnique({
        where: { id: hash(token) },
      });
      if (existing && existing.expiresAt > new Date()) return existing;
    }
    const next = secret();
    const result = await prisma.reviewSession.create({
      data: {
        id: hash(next),
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
    });
    reply.setCookie(COOKIE, next, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });
    return result;
  }
  function userToken(current: ReviewSession, request: FastifyRequest, account: Account | null): string | undefined {
    // A signed-in connection belongs to one account session. Anonymous intake
    // credentials cannot be adopted merely by presenting a different login cookie.
    if (current.accountSessionId
      ? !account || current.accountSessionId !== cookieHash(request)
      : account !== null)
      return undefined;
    if (
      !current.tokenEncrypted ||
      !current.tokenExpiresAt ||
      current.tokenExpiresAt <= new Date()
    )
      return undefined;
    return decrypt(current.tokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
  }
  const connectEnabled = Boolean(env.GITHUB_CLIENT_ID);
  await registerCustomerAuth(app, { prisma, env, session, email: accountEmail,
    google: options.googleProvider ?? new GoogleOidcProvider(env), rateLimiting: options.rateLimiting ?? true });
  await registerAccountClosure(app, prisma, env);
  const installUrl = connectEnabled
    ? `https://github.com/apps/${encodeURIComponent(env.GITHUB_APP_SLUG)}/installations/new`
    : null;
  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", recovery: env.RECOVERY_MODE };
  });
  app.get("/v1/session", async (request, reply) => {
    const current = await session(request, reply);
    const account = await accountFromRequest(prisma, request);
    const token = userToken(current, request, account);
    const latest = current.selectedInspectionId
      ? await prisma.inspection.findFirst({
          where: {
            id: current.selectedInspectionId,
            sessionId: current.id,
            accountId: account?.id ?? null,
          },
        })
      : null;
    let connection: {
      repositories: { name: string; url: string; private: boolean }[];
      truncated: boolean;
    } = { repositories: [], truncated: false };
    let connectionError: string | null = current.tokenEncrypted && !token
      ? "Connect GitHub again to choose your repositories. Your request is still here."
      : null;
    if (token)
      try {
        connection = await github.repositories(token);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        connectionError = error.message;
      }
    return {
      connectEnabled,
      installUrl,
      githubLogin: token ? current.githubLogin : null,
      ...connection,
      connectionError,
      inspection: latest
        ? { id: latest.id, ...(latest.report as object) }
        : null,
    };
  });
  app.get("/v1/auth/session", async (request) => {
    const account = await accountFromRequest(prisma, request);
    return {
      connectEnabled,
      emailEnabled: accountEmail.enabled,
      responseTargetWorkingDays: env.RESPONSE_TARGET_WORKING_DAYS,
      googleEnabled: Boolean(env.GOOGLE_CLIENT_ID),
      account: account
        ? {
            id: account.id,
            githubLogin: account.githubLogin,
            displayName: account.displayName,
            email: account.email,
            emailVerified: Boolean(account.emailVerifiedAt),
            notificationVerified: Boolean(account.notificationEmail ? account.notificationVerifiedAt : account.emailVerifiedAt),
            googleConnected: Boolean(account.googleId),
            isOperator: isOperator(account, env),
          }
        : null,
    };
  });
  app.post("/v1/auth/logout", async (request, reply) => {
    if (!isAppOrigin(env, request.headers.origin))
      throw new AppError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "Request origin is not allowed.",
      );
    const accountSessionId = cookieHash(request);
    const raw = request.cookies[COOKIE];
    await prisma.$transaction(async (transaction) => {
      let bound: string | null = null;
      if (
        raw &&
        /^[A-Za-z0-9_-]{43}$/.test(raw) &&
        (await transaction.reviewSession.findUnique({
          where: { id: hash(raw) },
        }))
      ) {
        const cleared = await transaction.reviewSession.update({
          where: { id: hash(raw) },
          data: {
            oauthAttemptId: null,
            oauthStateHash: null,
            oauthExpiresAt: null,
            verifierEncrypted: null,
            oauthPurpose: null,
            oauthAccountId: null,
            oauthNonceHash: null,
            tokenEncrypted: null,
            tokenExpiresAt: null,
            githubLogin: null,
            selectedInspectionId: null,
          },
        });
        bound = cleared.accountSessionId;
        await transaction.reviewSession.update({
          where: { id: cleared.id },
          data: { accountSessionId: null },
        });
      }
      const revoked = [accountSessionId, bound].filter(
        (value): value is string => Boolean(value),
      );
      if (revoked.length)
        await transaction.accountSession.deleteMany({
          where: { id: { in: revoked } },
        });
    });
    reply.clearCookie(ACCOUNT_COOKIE, { path: "/" });
    reply.clearCookie(COOKIE, { path: "/" });
    return { signedOut: true };
  });
  app.get(
    "/v1/github/connect",
    {
      config: {
        rateLimit:
          options.rateLimiting === false
            ? false
            : { max: 10, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const query = z
        .object({ flow: z.enum(["login", "workspace", "repositories", "admin"]).optional() })
        .parse(request.query);
      try {
        const account =
          query.flow === "login" || query.flow === "admin"
            ? null
            : query.flow === "workspace" || query.flow === "repositories"
              ? await requireAccount(prisma, request)
              : await accountFromRequest(prisma, request);
        if (!connectEnabled)
          throw new AppError(
            503,
            "GITHUB_NOT_CONFIGURED",
            "GitHub connection is being set up. Please try again later or contact hello@m8itwork.com.",
          );
        const details = z
          .object({
            permissions: z.record(z.string(), z.string()),
            client_id: z.string().optional(),
          })
          .parse(
            await github.api(`/apps/${encodeURIComponent(env.GITHUB_APP_SLUG)}`),
          );
        if (
          details.permissions.contents !== "read" ||
          Object.values(details.permissions).some(
            (permission) => permission !== "read",
          ) ||
          (details.client_id && details.client_id !== env.GITHUB_CLIENT_ID)
        ) {
          throw new AppError(
            503,
            "GITHUB_PERMISSIONS",
            "This GitHub App must be configured with read-only repository contents access before connecting.",
          );
        }
        const current = await session(request, reply);
        const state = secret();
        const verifier = secret();
        await prisma.$transaction(async transaction => {
          if (query.flow === "repositories") {
            await lockAccount(transaction, account!.id);
            const active = await transaction.accountSession.findUnique({ where: { id: cookieHash(request)! } });
            if (!active || active.accountId !== account!.id || active.expiresAt <= new Date())
              throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in again to connect GitHub.");
          }
          await transaction.reviewSession.update({
            where: { id: current.id },
            data: {
              oauthStateHash: hash(state),
              oauthAttemptId: hash(state),
              oauthPurpose: query.flow ?? "intake",
              oauthAccountId: account?.id ?? null,
              oauthExpiresAt: new Date(Date.now() + 10 * 60_000),
              verifierEncrypted: encrypt(verifier, env.TOKEN_ENCRYPTION_KEY),
              ...(query.flow === "repositories" ? {
                accountSessionId: cookieHash(request)!,
                ...(current.accountSessionId !== cookieHash(request) ? {
                  selectedInspectionId: null, tokenEncrypted: null, tokenExpiresAt: null, githubLogin: null,
                } : {}),
              } : {}),
            },
          });
        });
        const url = new URL("https://github.com/login/oauth/authorize");
        url.search = new URLSearchParams({
          client_id: env.GITHUB_CLIENT_ID,
          redirect_uri: `${env.PUBLIC_API_URL}/v1/github/callback`,
          state,
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
          ...(query.flow !== "repositories" && account?.githubLogin ? { login: account.githubLogin } : {}),
        }).toString();
        return reply.redirect(url.toString());
      } catch (error) {
        if (query.flow === "repositories" && error instanceof AppError && error.code === "SIGN_IN_REQUIRED")
          return reply.redirect(new URL("/dashboard?github=signin-required", env.FRONTEND_ORIGIN).toString());
        throw error;
      }
    },
  );
  app.get("/v1/github/callback", async (request, reply) => {
    const current = await session(request, reply);
    const workspaceFlow =
      current.oauthPurpose === "login" || current.oauthPurpose === "workspace" || current.oauthPurpose === "repositories";
    const destination = new URL(
      current.oauthPurpose === "admin" ? "/" : workspaceFlow ? "/dashboard" : "/#review",
      current.oauthPurpose === "admin" ? env.ADMIN_ORIGIN : env.FRONTEND_ORIGIN,
    );
    try {
      const query = z
        .object({
          state: z.string().min(40).max(100),
          code: z.string().min(1).max(200),
        })
        .parse(request.query);
      if (
        !connectEnabled ||
        !["login", "workspace", "repositories", "admin", "intake"].includes(current.oauthPurpose ?? "intake") ||
        !current.verifierEncrypted ||
        !current.oauthStateHash ||
        current.oauthStateHash !== hash(query.state)
      )
        throw new AppError(
          400,
          "OAUTH_STATE",
          "Please restart the GitHub connection.",
        );
      const consumed = await prisma.reviewSession.updateMany({
        where: {
          id: current.id,
          oauthStateHash: hash(query.state),
          oauthExpiresAt: { gt: new Date() },
        },
        data: {
          oauthStateHash: null,
          oauthExpiresAt: null,
          verifierEncrypted: null,
        },
      });
      if (consumed.count !== 1)
        throw new AppError(
          400,
          "OAUTH_STATE",
          "Please restart the GitHub connection.",
        );
      const result = await github.exchange({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        code: query.code,
        verifier: decrypt(current.verifierEncrypted, env.TOKEN_ENCRYPTION_KEY),
        redirectUri: `${env.PUBLIC_API_URL}/v1/github/callback`,
      });
      const user = z
        .object({
          login: z.string(),
          id: z.number().int().positive().safe(),
          name: z.string().nullable().optional(),
        })
        .parse(await github.api("/user", result.access_token));
      const reconnectAccount = current.oauthAccountId
        ? await requireAccount(prisma, request)
        : null;
      const repositoriesFlow = current.oauthPurpose === "repositories";
      if (repositoriesFlow && (!reconnectAccount || current.accountSessionId !== cookieHash(request)))
        throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in again to connect GitHub.");
      if (
        reconnectAccount &&
        (reconnectAccount.id !== current.oauthAccountId ||
          (!repositoriesFlow && reconnectAccount.githubId !== null && reconnectAccount.githubId !== String(user.id)))
      ) {
        throw new AppError(
          403,
          "GITHUB_IDENTITY",
          "Reconnect with the GitHub account you used to sign in.",
        );
      }
      const accountToken =
        current.oauthPurpose === "login" || current.oauthPurpose === "admin"
          ? secret()
          : null;
      await prisma.$transaction(async (transaction) => {
        if (accountToken) {
          const registered = await transaction.account.findUnique({ where: { githubId: String(user.id) } });
          if (registered) {
            await lockAccount(transaction, registered.id);
            assertAccountOpen(await transaction.account.findUniqueOrThrow({ where: { id: registered.id } }));
          }
        }
        if (reconnectAccount) {
          await lockAccount(transaction, reconnectAccount.id);
          const activeSession = await transaction.accountSession.findUnique({ where: { id: cookieHash(request) ?? "" } });
          if (!activeSession || activeSession.accountId !== reconnectAccount.id || activeSession.expiresAt <= new Date())
            throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in again to connect GitHub.");
          if (!repositoriesFlow) {
            const registered = await transaction.account.findUnique({ where: { githubId: String(user.id) } });
            const latest = await transaction.account.findUniqueOrThrow({ where: { id: reconnectAccount.id } });
            if ((registered && registered.id !== reconnectAccount.id) || (latest.githubId && latest.githubId !== String(user.id)))
              throw new AppError(403, "GITHUB_IDENTITY", "This GitHub account is already linked to another account. Sign in with that account to continue.");
            await transaction.account.update({ where: { id: reconnectAccount.id }, data: { githubId: String(user.id), githubLogin: user.login } });
          }
        }
        const connected = await transaction.reviewSession.updateMany({
          where: {
            id: current.id,
            oauthAttemptId: hash(query.state),
            oauthPurpose: current.oauthPurpose,
            oauthAccountId: current.oauthAccountId,
            ...(repositoriesFlow ? { accountSessionId: cookieHash(request)! } : {}),
            expiresAt: { gt: new Date() },
          },
          data: {
            oauthAttemptId: null,
            oauthAccountId: null,
            oauthPurpose: null,
            ...(accountToken
              ? {
                  selectedInspectionId: null,
                  accountSessionId: hash(accountToken),
                }
              : {}),
            ...(reconnectAccount ? { selectedInspectionId: null, accountSessionId: cookieHash(request)! } : {}),
            tokenEncrypted: encrypt(
              result.access_token,
              env.TOKEN_ENCRYPTION_KEY,
            ),
            tokenExpiresAt: new Date(
              Date.now() +
                Math.min(result.expires_in ?? 8 * 3600, 8 * 3600) * 1000,
            ),
            githubLogin: user.login,
          },
        });
        if (connected.count !== 1)
          throw new AppError(
            400,
            "OAUTH_CANCELLED",
            "This connection attempt was cancelled. Please connect again.",
          );
        await assertIdentityOpen(transaction, "githubId", String(user.id));
        if (accountToken) {
          const account = await transaction.account.upsert({
            where: { githubId: String(user.id) },
            create: {
              githubId: String(user.id),
              githubLogin: user.login,
              displayName: user.name ?? null,
            },
            update: { githubLogin: user.login, displayName: user.name ?? null },
          });
          await lockAccount(transaction, account.id);
          assertAccountOpen(await transaction.account.findUniqueOrThrow({ where: { id: account.id } }));
          const previous = [
            cookieHash(request),
            current.accountSessionId,
          ].filter((value): value is string => Boolean(value));
          if (previous.length)
            await transaction.accountSession.deleteMany({
              where: { id: { in: previous } },
            });
          await transaction.accountSession.create({
            data: {
              id: hash(accountToken),
              accountId: account.id,
              expiresAt: new Date(Date.now() + ACCOUNT_TTL * 1000),
            },
          });
        }
      });
      if (accountToken) setAccountCookie(reply, accountToken, env);
      destination.searchParams.set("github", "connected");
    } catch (error) {
      destination.searchParams.set(
        "github",
        error instanceof AppError && error.code === "ACCOUNT_CLOSED"
          ? "account-closed"
          : error instanceof AppError && error.code === "GITHUB_IDENTITY"
          ? "identity"
          : current.oauthPurpose === "repositories" && error instanceof AppError && error.code === "SIGN_IN_REQUIRED"
            ? "signin-required"
          : "error",
      );
    }
    return reply.redirect(destination.toString());
  });
  app.post("/v1/github/disconnect", async (request, reply) => {
    const current = await session(request, reply);
    await prisma.reviewSession.update({
      where: { id: current.id },
      data: {
        tokenEncrypted: null,
        oauthAttemptId: null,
        oauthPurpose: null,
        oauthAccountId: null,
        tokenExpiresAt: null,
        githubLogin: null,
        oauthStateHash: null,
        oauthExpiresAt: null,
        verifierEncrypted: null,
      },
    });
    return { disconnected: true };
  });
  app.post(
    "/v1/github/inspect",
    {
      config: {
        rateLimit:
          options.rateLimiting === false
            ? false
            : { max: 6, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const input = z
        .object({ repositoryUrl: z.string().max(500) })
        .strict()
        .parse(request.body);
      const current = await session(request, reply);
      const account = await accountFromRequest(prisma, request);
      const token = userToken(current, request, account);
      if (current.tokenEncrypted && !token)
        throw new AppError(401, "GITHUB_RECONNECT", "Connect GitHub again to inspect your repository. Your request is still here.");
      const report = await github.inspect(
        input.repositoryUrl,
        token,
      );
      const inspection = await prisma.$transaction(async (transaction) => {
        // Keep the owner captured before provider work; discard results after
        // logout, account rotation, reconnect, or disconnect.
        const active = account
          ? await accountFromRequest(transaction, request)
          : null;
        if (account && active?.id !== account.id)
          throw new AppError(
            409,
            "CONNECTION_CHANGED",
            "Your connection changed during inspection. Sign in and inspect again.",
          );
        const locked = await transaction.reviewSession.updateMany({
          where: {
            id: current.id,
            expiresAt: { gt: new Date() },
            accountSessionId: current.accountSessionId,
            tokenEncrypted: current.tokenEncrypted,
          },
          data: { selectedInspectionId: null },
        });
        if (locked.count !== 1)
          throw new AppError(
            409,
            "CONNECTION_CHANGED",
            "Your connection changed during inspection. Inspect again.",
          );
        const created = await transaction.inspection.create({
          data: {
            sessionId: current.id,
            accountId: account?.id ?? null,
            report,
          },
        });
        await transaction.reviewSession.update({
          where: { id: current.id },
          data: { selectedInspectionId: created.id },
        });
        return created;
      });
      return { id: inspection.id, ...report };
    },
  );
  app.post("/v1/inspection-selection/remove", async (request, reply) => {
    const input = z
      .object({ inspectionId: z.uuid() })
      .strict()
      .parse(request.body);
    const current = await session(request, reply);
    await prisma.reviewSession.updateMany({
      where: { id: current.id, selectedInspectionId: input.inspectionId },
      data: { selectedInspectionId: null },
    });
    return { removed: true };
  });
  app.post(
    "/v1/intakes",
    {
      config: {
        rateLimit:
          options.rateLimiting === false
            ? false
            : { max: 5, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const input = submissionSchema.parse(request.body);
      const current = await session(request, reply);
      const account = await accountFromRequest(prisma, request);
      const inspection = input.inspectionId
        ? await prisma.inspection.findFirst({
            where: {
              id: input.inspectionId,
              sessionId: current.id,
              accountId: account?.id ?? null,
            },
          })
        : null;
      if (input.inspectionId && !inspection)
        throw new AppError(
          400,
          "INSPECTION_UNAVAILABLE",
          "This inspection expired or belongs to another session. Inspect the repository again, or send your brief without it.",
        );
      const submission = await prisma.$transaction(async (transaction) => {
        const created = await transaction.submission.create({
          data: {
            name: input.name,
            email: input.email,
            projectName: input.projectName,
            platform: input.platform,
            demoUrl: input.demoUrl || null,
            problem: input.problem,
            workflows: [...new Set(input.workflows)],
            ...(inspection ? { inspectionReport: inspection.report! } : {}),
          },
        });
        await transaction.reviewSession.update({
          where: { id: current.id },
          data: { selectedInspectionId: null },
        });
        return created;
      });
      return reply.code(201).send({
        id: submission.id,
        message:
          "Your brief is saved for review. We'll use the email you provided to follow up about fit, assessment scope, and next steps.",
      });
    },
  );
  const billing = await registerBilling(app, { prisma, env, provider: options.billingProvider ?? new StripeBillingProvider(options.paymentProvider ? { ...env, STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" } : env) });
  const payments = await registerWorkspace(app, {
    prisma,
    env,
    session,
    paymentProvider: options.paymentProvider ?? new StripeProvider(env),
    billing,
  });
  const notifications = await registerNotifications(app, prisma, env, options.projectEmailProvider ?? new ResendProjectEmail(env));
  const operations = await registerOperations(app, prisma, env, payments, notifications);
  let lastCleanup = 0;
  app.decorate("maintenance", async () => {
    if (env.RECOVERY_MODE) return;
    await payments.processPending();
    await operations.alerts();
    await notifications.process();
    if (Date.now() - lastCleanup >= 3600_000) { await cleanup(prisma); lastCleanup = Date.now(); }
  });
  await registerReviews(app, { prisma, env, github });
  app.addHook("onClose", () => prisma.$disconnect());
  return app;
}
