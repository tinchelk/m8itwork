import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { hash } from "../src/crypto.js";
import { hashPassword } from "../src/passwords.js";

const dbUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!dbUrl)("GitHub repository access separate from sign-in", () => {
  const prisma = new PrismaClient({ datasourceUrl: dbUrl! });
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: dbUrl, GITHUB_CLIENT_ID: "repositories-client", GITHUB_CLIENT_SECRET: "fixture", GITHUB_APP_SLUG: "repositories-fixture", GOOGLE_CLIENT_ID: "repositories-google", GOOGLE_CLIENT_SECRET: "fixture", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"), OPERATOR_GITHUB_IDS: "941666000" });
  let app: Awaited<ReturnType<typeof buildApp>>, password: string;
  let identity = { id: 941666000, login: "repository-owner", name: "Repository Owner" };
  let googleIdentity = { id: randomUUID(), email: `${randomUUID()}@example.invalid`, name: "Google Builder", mailboxAuthoritative: true };
  let exchangeHook = async () => {}, inspectHook = async () => {}, appDetailsHook = async () => {};
  let repositoryCalls = 0;
  const accounts = new Set<string>(), reviews = new Set<string>();
  const repository = { full_name: "repository-owner/private-app", html_url: "https://github.com/repository-owner/private-app", private: true, default_branch: "main", language: "TypeScript", archived: false };

  beforeAll(async () => {
    if (!dbUrl || !new URL(dbUrl).pathname.endsWith("/m8itwork_test")) throw new Error("Use the dedicated m8itwork_test database.");
    password = await hashPassword("correct fixture password");
    app = await buildApp({ env, prisma, logger: false, rateLimiting: false,
      accountEmailProvider: { enabled: true, send: async () => {} },
      googleProvider: { exchange: async () => googleIdentity },
      fetcher: async (url, options) => {
        const path = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname;
        if (path === "/apps/repositories-fixture") { await appDetailsHook(); return Response.json({ client_id: "repositories-client", permissions: { contents: "read", metadata: "read" } }); }
        if (path === "/login/oauth/access_token") { await exchangeHook(); return Response.json({ access_token: "repository-fixture-token", expires_in: 28800 }); }
        if (path === "/user") return Response.json(identity);
        if (path === "/user/installations" || path.startsWith("/repos/") || path.includes("/repositories")) {
          repositoryCalls++;
          if (new Headers(options?.headers).get("Authorization") !== "Bearer repository-fixture-token") return Response.json({}, { status: 404 });
          if (path === "/user/installations") return Response.json({ total_count: 1, installations: [{ id: 1 }] });
          if (path === "/user/installations/1/repositories") return Response.json({ total_count: 1, repositories: [repository] });
          if (path === "/repos/repository-owner/private-app") return Response.json(repository);
          if (path.includes("/branches/")) return Response.json({ commit: { sha: "a".repeat(40) } });
          if (path.includes("/git/trees/")) { await inspectHook(); return Response.json({ truncated: false, tree: [{ path: "src/private.ts", type: "blob", sha: "b".repeat(40), size: 10 }] }); }
        }
        throw new Error("Unexpected provider route");
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await prisma.reviewSession.deleteMany({ where: { id: { in: [...reviews] } } });
    await prisma.account.deleteMany({ where: { id: { in: [...accounts] } } });
    await prisma.$disconnect();
  });
  function mergeCookies(cookie: string, response: { cookies: { name: string; value: string }[] }) {
    const entries = new Map(cookie.split("; ").filter(Boolean).map(c => c.split("=", 2) as [string, string]));
    response.cookies.forEach(c => entries.set(c.name, c.value));
    const review = entries.get("m8_review_session");
    if (review) reviews.add(hash(review));
    return [...entries].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  function reviewId(cookie: string) { return hash(/m8_review_session=([^;]+)/.exec(cookie)![1]!); }
  function accountSessionId(cookie: string) { return hash(/m8_account_session=([^;]+)/.exec(cookie)![1]!); }
  function post(path: string, data: Record<string, unknown>, cookie: string) { return app.inject({ method: "POST", url: path, headers: { origin: env.FRONTEND_ORIGIN, cookie }, payload: data }); }
  async function emailAccount() {
    const account = await prisma.account.create({ data: { email: `${randomUUID()}@example.invalid`, emailVerifiedAt: new Date(), passwordHash: password, displayName: "Email Builder" } });
    accounts.add(account.id);
    const result = await post("/v1/auth/login", { email: account.email, password: "correct fixture password" }, "");
    expect(result.statusCode).toBe(200);
    return { account, cookie: mergeCookies("", result) };
  }
  async function start(cookie: string, flow = "repositories") {
    const response = await app.inject({ url: `/v1/github/connect?flow=${flow}`, headers: { cookie } });
    expect(response.statusCode).toBe(302);
    return { cookie: mergeCookies(cookie, response), state: new URL(response.headers.location!).searchParams.get("state")!, url: new URL(response.headers.location!) };
  }
  function callback(attempt: { cookie: string; state: string }) { return app.inject({ url: `/v1/github/callback?state=${attempt.state}&code=fixture`, headers: { cookie: attempt.cookie } }); }
  async function connect(cookie: string) {
    const attempt = await start(cookie), result = await callback(attempt);
    expect(result.headers.location).toBe(`${env.FRONTEND_ORIGIN}/dashboard?github=connected`);
    expect(result.cookies.find(c => c.name === "m8_account_session")).toBeUndefined();
    return attempt;
  }
  async function session(cookie: string) { return (await app.inject({ url: "/v1/auth/session", headers: { cookie } })).json<{ account: { id: string; githubLogin: string | null; isOperator: boolean; googleConnected: boolean } }>(); }

  it("requires an active account before starting repository OAuth", async () => {
    const response = await app.inject({ url: "/v1/github/connect?flow=repositories" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${env.FRONTEND_ORIGIN}/dashboard?github=signin-required`);
    expect(response.cookies).toHaveLength(0);
  });

  it("returns an expired account session to sign-in before authorizing GitHub", async () => {
    const customer = await emailAccount();
    await prisma.accountSession.update({ where: { id: accountSessionId(customer.cookie) }, data: { expiresAt: new Date(0) } });
    const result = await app.inject({ url: "/v1/github/connect?flow=repositories", headers: { cookie: customer.cookie } });
    expect(result.headers.location).toBe(`${env.FRONTEND_ORIGIN}/dashboard?github=signin-required`);
    expect((await prisma.reviewSession.findUniqueOrThrow({ where: { id: reviewId(customer.cookie) } })).oauthAttemptId).toBeNull();
  });

  it("returns to sign-in if logout occurs while checking GitHub App permissions", async () => {
    const customer = await emailAccount();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    appDetailsHook = async () => { enter(); await gate; };
    const connecting = app.inject({ url: "/v1/github/connect?flow=repositories", headers: { cookie: customer.cookie } });
    try {
      await entered; await post("/v1/auth/logout", {}, customer.cookie); release();
      expect((await connecting).headers.location).toBe(`${env.FRONTEND_ORIGIN}/dashboard?github=signin-required`);
      expect((await prisma.reviewSession.findUniqueOrThrow({ where: { id: reviewId(customer.cookie) } })).oauthAttemptId).toBeNull();
    } finally { release(); appDetailsHook = async () => {}; await connecting; }
  });

  it("authorizes a GitHub identity used by another account without merging identities, projects, or roles", async () => {
    identity = { id: 941666000, login: "repository-owner", name: "Repository Owner" };
    const original = await start("", "login"), signedIn = await callback(original);
    const originalCookie = mergeCookies(original.cookie, signedIn);
    const originalAccount = (await session(originalCookie)).account;
    accounts.add(originalAccount.id);
    expect(originalAccount.isOperator).toBe(true);
    const saved = await post("/v1/projects", { id: randomUUID(), name: "Original app", contactEmail: "original@example.invalid", platform: "Other", summary: "Keep the existing project history.", consent: true }, originalCookie);
    expect(saved.statusCode).toBe(201);
    const originalProject = saved.json<{ id: string }>().id;
    const customer = await emailAccount(), before = await prisma.account.findUniqueOrThrow({ where: { id: customer.account.id } });
    const attempt = await connect(customer.cookie);
    expect(attempt.url.searchParams.has("login")).toBe(false);
    expect(attempt.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(await prisma.account.findUniqueOrThrow({ where: { id: customer.account.id } })).toEqual(before);
    expect((await session(customer.cookie)).account).toMatchObject({ id: customer.account.id, githubLogin: null, isOperator: false });
    expect((await session(originalCookie)).account).toMatchObject({ id: originalAccount.id, githubLogin: "repository-owner", isOperator: true });
    expect((await app.inject({ url: `/v1/projects/${originalProject}`, headers: { cookie: customer.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/projects/${originalProject}`, headers: { cookie: originalCookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/operator/projects", headers: { cookie: customer.cookie } })).statusCode).toBe(403);
    const connection = (await app.inject({ url: "/v1/session", headers: { cookie: customer.cookie } })).json<{ connectionError: string | null }>();
    expect(connection).toMatchObject({ githubLogin: "repository-owner", connectionError: null, repositories: [{ name: repository.full_name, url: repository.html_url, private: true }] });
    expect(JSON.stringify(connection)).not.toMatch(/fixture-token|tokenEncrypted|accountSessionId/);
    const credential = await prisma.reviewSession.findUniqueOrThrow({ where: { id: reviewId(customer.cookie) } });
    expect(credential.accountSessionId).toBe(accountSessionId(customer.cookie));
    expect(credential.tokenEncrypted).not.toContain("repository-fixture-token");
    const inspected = await post("/v1/github/inspect", { repositoryUrl: repository.html_url }, customer.cookie);
    expect(inspected.statusCode).toBe(200);
    const created = await post("/v1/projects", { id: randomUUID(), inspectionId: inspected.json<{ id: string }>().id, summary: "Add custom exports to the app.", reviewConsent: "ai-review-v1", consent: true }, customer.cookie);
    expect(created.statusCode).toBe(201);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: created.json<{ id: string }>().id } })).toMatchObject({ accountId: customer.account.id, stage: "IN_REVIEW", repositoryUrl: repository.html_url });
    expect((await callback(attempt)).headers.location).toContain("github=error");
  });

  it("keeps a Google account and its existing different GitHub sign-in identity when sharing repositories", async () => {
    googleIdentity = { id: randomUUID(), email: `${randomUUID()}@example.invalid`, name: "Google Builder", mailboxAuthoritative: true };
    const begin = await app.inject({ url: "/v1/auth/google/connect?flow=login" });
    const cookie = mergeCookies("", begin), state = new URL(begin.headers.location!).searchParams.get("state")!;
    const signedIn = await app.inject({ url: `/v1/auth/google/callback?state=${state}&code=fixture`, headers: { cookie } });
    expect(signedIn.headers.location).toContain("google=connected");
    const googleCookie = mergeCookies(cookie, signedIn), account = (await session(googleCookie)).account;
    accounts.add(account.id);
    await prisma.account.update({ where: { id: account.id }, data: { githubId: "941666001", githubLogin: "different-sign-in" } });
    const before = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    await connect(googleCookie);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).toEqual(before);
    expect((await session(googleCookie)).account).toMatchObject({ id: account.id, googleConnected: true, githubLogin: "different-sign-in", isOperator: false });
    expect((await app.inject({ url: "/v1/session", headers: { cookie: googleCookie } })).json<{ githubLogin: string | null }>().githubLogin).toBe("repository-owner");
  });

  it("rejects switched, missing and expired account sessions without exposing repository credentials", async () => {
    const customer = await emailAccount(), other = await emailAccount();
    const attempt = await start(customer.cookie);
    const switched = customer.cookie.replace(/m8_account_session=[^;]+/, /m8_account_session=[^;]+/.exec(other.cookie)![0]);
    expect((await callback({ ...attempt, cookie: switched })).headers.location).toContain("github=signin-required");
    expect((await prisma.reviewSession.findUniqueOrThrow({ where: { id: reviewId(customer.cookie) } })).tokenEncrypted).toBeNull();
    await connect(customer.cookie);
    const beforeCalls = repositoryCalls;
    for (const mismatched of [switched, customer.cookie.replace(/;? ?m8_account_session=[^;]+/, "")]) {
      const connection = (await app.inject({ url: "/v1/session", headers: { cookie: mismatched } })).json<{ connectionError: string | null }>();
      expect(connection).toMatchObject({ githubLogin: null, repositories: [] });
      expect(connection.connectionError).toContain("Connect GitHub again");
      expect((await post("/v1/github/inspect", { repositoryUrl: repository.html_url }, mismatched)).statusCode).toBe(401);
    }
    await prisma.accountSession.update({ where: { id: accountSessionId(customer.cookie) }, data: { expiresAt: new Date(0) } });
    expect((await app.inject({ url: "/v1/session", headers: { cookie: customer.cookie } })).json()).toMatchObject({ githubLogin: null, repositories: [] });
    expect((await post("/v1/github/inspect", { repositoryUrl: repository.html_url }, customer.cookie)).statusCode).toBe(401);
    expect(repositoryCalls).toBe(beforeCalls);
  });

  it("rejects expired tokens with reconnect guidance while preserving the request's account", async () => {
    const customer = await emailAccount();
    await connect(customer.cookie);
    await prisma.reviewSession.update({ where: { id: reviewId(customer.cookie) }, data: { tokenExpiresAt: new Date(0) } });
    const connection = (await app.inject({ url: "/v1/session", headers: { cookie: customer.cookie } })).json<{ connectionError: string | null }>();
    expect(connection).toMatchObject({ githubLogin: null, repositories: [] });
    expect(connection.connectionError).toContain("Connect GitHub again");
    const inspected = await post("/v1/github/inspect", { repositoryUrl: repository.html_url }, customer.cookie);
    expect(inspected.json()).toMatchObject({ error: { code: "GITHUB_RECONNECT" } });
    expect((await session(customer.cookie)).account.id).toBe(customer.account.id);
  });

  it.each(["wrong-state", "expired", "superseded"])("rejects %s OAuth callbacks without committing credentials", async scenario => {
    const customer = await emailAccount(), attempt = await start(customer.cookie);
    if (scenario === "expired") await prisma.reviewSession.update({ where: { id: reviewId(customer.cookie) }, data: { oauthExpiresAt: new Date(0) } });
    const next = scenario === "superseded" ? await start(customer.cookie) : null;
    const result = await callback({ ...attempt, state: scenario === "wrong-state" ? "x".repeat(43) : attempt.state });
    expect(result.headers.location).toContain("github=error");
    expect((await prisma.reviewSession.findUniqueOrThrow({ where: { id: reviewId(customer.cookie) } })).tokenEncrypted).toBeNull();
    if (next) expect((await callback(next)).headers.location).toContain("github=connected");
    if (scenario === "wrong-state") expect((await callback(attempt)).headers.location).toContain("github=connected");
  });

  it("binds repository access when an existing account cookie has a fresh review session", async () => {
    const customer = await emailAccount(), cookie = /m8_account_session=[^;]+/.exec(customer.cookie)![0];
    const attempt = await connect(cookie);
    expect(reviewId(attempt.cookie)).not.toBe(reviewId(customer.cookie));
    expect((await app.inject({ url: "/v1/session", headers: { cookie: attempt.cookie } })).json()).toMatchObject({ githubLogin: "repository-owner", repositories: [{ name: repository.full_name }] });
    expect((await session(attempt.cookie)).account.id).toBe(customer.account.id);
  });

  it.each(["logout", "disconnect", "reset", "new-attempt", "account-switch"])("does not commit an in-flight repository connection after %s", async cancellation => {
    const customer = await emailAccount(), attempt = await start(customer.cookie);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    exchangeHook = async () => { enter(); await gate; };
    const connecting = callback(attempt);
    try {
      await entered;
      if (cancellation === "logout") await post("/v1/auth/logout", {}, customer.cookie);
      if (cancellation === "disconnect") await post("/v1/github/disconnect", {}, customer.cookie);
      if (cancellation === "reset") {
        const raw = "r".repeat(43);
        await prisma.accountToken.create({ data: { id: hash(raw), accountId: customer.account.id, purpose: "RESET_PASSWORD", expiresAt: new Date(Date.now() + 60000) } });
        expect((await post("/v1/auth/password-reset/confirm", { token: raw, password: "a different fixture password" }, customer.cookie)).statusCode).toBe(200);
      }
      if (cancellation === "new-attempt") await start(customer.cookie);
      if (cancellation === "account-switch") {
        const other = await emailAccount();
        expect((await post("/v1/auth/login", { email: other.account.email, password: "correct fixture password" }, customer.cookie)).statusCode).toBe(200);
      }
      release();
      const result = await connecting;
      expect(result.headers.location).toContain(["logout", "reset", "account-switch"].includes(cancellation) ? "github=signin-required" : "github=error");
      expect(result.cookies.find(c => c.name === "m8_account_session")).toBeUndefined();
      expect((await prisma.reviewSession.findUniqueOrThrow({ where: { id: reviewId(customer.cookie) } })).tokenEncrypted).toBeNull();
      expect((await prisma.account.findUniqueOrThrow({ where: { id: customer.account.id } })).githubId).toBeNull();
    } finally { release(); exchangeHook = async () => {}; await connecting; }
  });

  it("discards an inspection that completes after logout", async () => {
    const customer = await emailAccount();
    await connect(customer.cookie);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    inspectHook = async () => { enter(); await gate; };
    const inspecting = post("/v1/github/inspect", { repositoryUrl: repository.html_url }, customer.cookie);
    try {
      await entered; await post("/v1/auth/logout", {}, customer.cookie); release();
      expect((await inspecting).statusCode).toBe(409);
      expect(await prisma.inspection.count({ where: { accountId: customer.account.id } })).toBe(0);
    } finally { release(); inspectHook = async () => {}; await inspecting; }
  });
});
