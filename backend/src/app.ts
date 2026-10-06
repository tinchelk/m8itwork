import { createHash } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { PrismaClient, type ReviewSession } from "@prisma/client";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { loadEnv, type Env } from "./config.js";
import { decrypt, encrypt, hash, secret } from "./crypto.js";
import { GitHubClient, type Fetch } from "./github/client.js";
import { AppError } from "./shared/errors.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
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
  } = {},
) {
  const env = options.env ?? loadEnv();
  const prisma =
    options.prisma ?? new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  const github = new GitHubClient(options.fetcher);
  const app = Fastify({
    logger: options.logger ?? { level: "info" },
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    bodyLimit: 16_000,
  });
  app.decorate("config", env);
  await app.register(cookie);
  await app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  });
  await app.register(helmet);
  await app.register(rateLimit, {
    global: options.rateLimiting ?? true,
    max: 120,
    timeWindow: "1 minute",
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("x-request-id", request.id);
    if (
      request.method === "POST" &&
      request.headers.origin &&
      request.headers.origin !== env.FRONTEND_ORIGIN
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
      return reply
        .code(statusCode)
        .send({
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
  function userToken(current: ReviewSession): string | undefined {
    if (
      !current.tokenEncrypted ||
      !current.tokenExpiresAt ||
      current.tokenExpiresAt <= new Date()
    )
      return undefined;
    return decrypt(current.tokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
  }
  const connectEnabled = Boolean(env.GITHUB_CLIENT_ID);
  const installUrl = connectEnabled
    ? `https://github.com/apps/${encodeURIComponent(env.GITHUB_APP_SLUG)}/installations/new`
    : null;
  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  });
  app.get("/v1/session", async (request, reply) => {
    const current = await session(request, reply);
    const token = userToken(current);
    const latest = current.selectedInspectionId
      ? await prisma.inspection.findFirst({
          where: { id: current.selectedInspectionId, sessionId: current.id },
        })
      : null;
    let connection: {
      repositories: { name: string; url: string; private: boolean }[];
      truncated: boolean;
    } = { repositories: [], truncated: false };
    let connectionError: string | null = null;
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
      if (!connectEnabled)
        throw new AppError(
          503,
          "GITHUB_NOT_CONFIGURED",
          "Private GitHub connections aren't configured yet. Use a public repository link or send your brief.",
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
      await prisma.reviewSession.update({
        where: { id: current.id },
        data: {
          oauthStateHash: hash(state),
          oauthAttemptId: hash(state),
          oauthExpiresAt: new Date(Date.now() + 10 * 60_000),
          verifierEncrypted: encrypt(verifier, env.TOKEN_ENCRYPTION_KEY),
        },
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
      }).toString();
      return reply.redirect(url.toString());
    },
  );
  app.get("/v1/github/callback", async (request, reply) => {
    const destination = new URL("/#review", env.FRONTEND_ORIGIN);
    try {
      const query = z
        .object({
          state: z.string().min(40).max(100),
          code: z.string().min(1).max(200),
        })
        .parse(request.query);
      const current = await session(request, reply);
      if (
        !connectEnabled ||
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
        .object({ login: z.string() })
        .parse(await github.api("/user", result.access_token));
      const connected = await prisma.reviewSession.updateMany({
        where: {
          id: current.id,
          oauthAttemptId: hash(query.state),
          expiresAt: { gt: new Date() },
        },
        data: {
          oauthAttemptId: null,
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
      destination.searchParams.set("github", "connected");
    } catch {
      destination.searchParams.set("github", "error");
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
      const report = await github.inspect(
        input.repositoryUrl,
        userToken(current),
      );
      const inspection = await prisma.$transaction(async (transaction) => {
        const created = await transaction.inspection.create({
          data: { sessionId: current.id, report },
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
      const inspection = input.inspectionId
        ? await prisma.inspection.findFirst({
            where: { id: input.inspectionId, sessionId: current.id },
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
  app.addHook("onClose", () => prisma.$disconnect());
  return app;
}
