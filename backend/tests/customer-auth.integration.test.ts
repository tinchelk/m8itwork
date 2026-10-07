import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { hash } from "../src/crypto.js";
import { hashPassword } from "../src/passwords.js";
import type { AccountEmail } from "../src/account-email.js";

const dbUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!dbUrl)("email/Google customer accounts", () => {
  const prisma = new PrismaClient({ datasourceUrl: dbUrl! });
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: dbUrl, GITHUB_CLIENT_ID: "auth-gh", GITHUB_CLIENT_SECRET: "fixture", GITHUB_APP_SLUG: "auth-fixture", GOOGLE_CLIENT_ID: "auth-google", GOOGLE_CLIENT_SECRET: "fixture", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString("base64"), OPERATOR_GITHUB_IDS: "42" });
  let app: Awaited<ReturnType<typeof buildApp>>, storedPassword: string;
  const accountIds: string[] = [], reviews: string[] = [], mail: AccountEmail[] = [];
  let googleIdentity = { id: "fixture-google", email: "fixture@example.invalid", name: "Email Builder", mailboxAuthoritative: true };
  let githubIdentity = { id: 940000001, login: "email-builder", name: "Email Builder" };
  let googleExchangeHook = async () => {};
  beforeAll(async () => {
    if (!dbUrl || !new URL(dbUrl).pathname.endsWith("/m8itwork_test")) throw new Error("Use the dedicated m8itwork_test database.");
    storedPassword = await hashPassword("correct fixture password");
    app = await buildApp({ env, prisma, logger: false, rateLimiting: false,
      accountEmailProvider: { enabled: true, send: async email => { mail.push(email); } },
      googleProvider: { exchange: async () => { await googleExchangeHook(); return googleIdentity; } },
      fetcher: async url => {
        const target = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
        if (target.pathname === "/apps/auth-fixture") return Response.json({ client_id: "auth-gh", permissions: { contents: "read", metadata: "read" } });
        if (target.pathname === "/login/oauth/access_token") return Response.json({ access_token: "fixture-token", expires_in: 28800 });
        if (target.pathname === "/user") return Response.json(githubIdentity);
        if (target.pathname === "/user/installations") return Response.json({ installations: [], total_count: 0 });
        throw new Error("Unexpected provider route");
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    if (reviews.length) await prisma.reviewSession.deleteMany({ where: { id: { in: reviews } } });
    await prisma.$disconnect();
  });
  function cookies(response: { cookies: { name: string; value: string }[] }) { return response.cookies.map(c => `${c.name}=${c.value}`).join("; "); }
  function post(path: string, data: Record<string, unknown>, cookie = "") { return app.inject({ method: "POST", url: path, headers: { origin: env.FRONTEND_ORIGIN, cookie }, payload: data }); }
  function token(email: AccountEmail) { return new URLSearchParams(new URL(email.actionUrl).hash.slice(1)).get("token")!; }
  async function account(verified = true) {
    const created = await prisma.account.create({ data: { email: `${randomUUID()}@example.invalid`, displayName: "Email Builder", passwordHash: storedPassword, emailVerifiedAt: verified ? new Date() : null } });
    accountIds.push(created.id); return created;
  }
  async function login(email: string) {
    const response = await post("/v1/auth/login", { email, password: "correct fixture password" });
    const review = response.cookies.find(c => c.name === "m8_review_session");
    if (review) reviews.push(hash(review.value));
    expect(response.statusCode).toBe(200); return cookies(response);
  }
  async function googleStart(cookie = "", flow = "login") {
    const response = await app.inject({ url: `/v1/auth/google/connect?flow=${flow}`, headers: { cookie } });
    const review = response.cookies.find(c => c.name === "m8_review_session");
    if (review) reviews.push(hash(review.value));
    return { response, url: new URL(response.headers.location!), cookie: [cookie, cookies(response)].filter(Boolean).join("; ") };
  }
  it("creates a hashed email account, verifies once, and opens owned projects without GitHub", async () => {
    const email = `${randomUUID()}@example.invalid`;
    const registered = await post("/v1/auth/register", { email: ` ${email.toUpperCase()} `, password: "correct fixture password", displayName: "Email Builder", consent: true });
    expect(registered.statusCode).toBe(202); expect(registered.cookies.find(c => c.name === "m8_account_session")).toBeUndefined();
    const stored = await prisma.account.findUniqueOrThrow({ where: { email } }); accountIds.push(stored.id);
    expect(stored.githubId).toBeNull(); expect(stored.passwordHash).toBeNull();
    const pending = await prisma.accountToken.findFirstOrThrow({ where: { accountId: stored.id, purpose: "VERIFY_EMAIL" } });
    expect(pending.pendingPasswordHash).toMatch(/^scrypt\$/); expect(pending.pendingPasswordHash).not.toContain("correct fixture password");
    expect((await post("/v1/auth/login", { email, password: "correct fixture password" })).statusCode).toBe(403);
    const verification = mail.at(-1)!;
    expect(new URL(verification.actionUrl).pathname).toBe("/verify-email"); expect(new URL(verification.actionUrl).search).toBe("");
    expect(await prisma.accountToken.findUnique({ where: { id: token(verification) } })).toBeNull();
    const results = await Promise.all([post("/v1/auth/email-verification/confirm", { token: token(verification) }), post("/v1/auth/email-verification/confirm", { token: token(verification) })]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 400]);
    const cookie = await login(email);
    const session = (await app.inject({ url: "/v1/auth/session", headers: { cookie } })).json();
    expect(session.account).toMatchObject({ id: stored.id, email, isOperator: false, githubLogin: null });
    expect(JSON.stringify(session)).not.toMatch(/passwordHash|googleId|githubId/);
    expect((await app.inject({ url: "/v1/projects", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/operator/projects", headers: { cookie } })).statusCode).toBe(403);
    const created = await post("/v1/projects", { id: randomUUID(), name: "Email-only project", contactEmail: email, platform: "Lovable", summary: "Please review the demo and help add an export workflow.", demoUrl: "https://example.invalid/demo", consent: true }, cookie);
    expect(created.statusCode).toBe(201);
    const projectId = created.json().id as string;
    expect((await post(`/v1/projects/${projectId}/submit`, { version: 1 }, cookie)).statusCode).toBe(200);
    const another = await account(), anotherCookie = await login(another.email!);
    expect((await app.inject({ url: `/v1/projects/${projectId}`, headers: { cookie: anotherCookie } })).statusCode).toBe(404);
  });
  it("binds verification to the latest signup password and prevents attacker preregistration takeover", async () => {
    const email = `${randomUUID()}@example.invalid`;
    await post("/v1/auth/register", { email, password: "attacker fixture password", displayName: "Attacker", consent: true });
    const oldLink = token(mail.at(-1)!);
    const stored = await prisma.account.findUniqueOrThrow({ where: { email } }); accountIds.push(stored.id);
    await post("/v1/auth/register", { email, password: "owner fixture password", displayName: "Owner", consent: true });
    const ownerLink = token(mail.at(-1)!);
    expect((await post("/v1/auth/email-verification/confirm", { token: oldLink })).statusCode).toBe(400);
    const before = mail.length;
    expect((await post("/v1/auth/email-verification/request", { email, password: "attacker fixture password" })).statusCode).toBe(202);
    expect(mail).toHaveLength(before);
    expect((await post("/v1/auth/email-verification/confirm", { token: ownerLink })).statusCode).toBe(200);
    expect((await post("/v1/auth/login", { email, password: "attacker fixture password" })).statusCode).toBe(401);
    const good = await post("/v1/auth/login", { email, password: "owner fixture password" });
    expect(good.statusCode).toBe(200);
    reviews.push(hash(good.cookies.find(c => c.name === "m8_review_session")!.value));
    expect((await prisma.account.findUniqueOrThrow({ where: { id: stored.id } })).displayName).toBe("Owner");
  });
  it("resends only the current verification challenge and rejects expired links", async () => {
    const email = `${randomUUID()}@example.invalid`;
    await post("/v1/auth/register", { email, password: "correct fixture password", displayName: "Builder", consent: true });
    const stored = await prisma.account.findUniqueOrThrow({ where: { email } }); accountIds.push(stored.id);
    const old = token(mail.at(-1)!);
    await post("/v1/auth/email-verification/request", { email, password: "correct fixture password" });
    const latest = token(mail.at(-1)!);
    expect(latest).not.toBe(old);
    expect((await post("/v1/auth/email-verification/confirm", { token: old })).statusCode).toBe(400);
    await prisma.accountToken.update({ where: { id: hash(latest) }, data: { expiresAt: new Date(1) } });
    expect((await post("/v1/auth/email-verification/confirm", { token: latest })).statusCode).toBe(400);
  });
  it("does not overwrite existing credentials or grant a role on duplicate signup", async () => {
    const existing = await account();
    const response = await post("/v1/auth/register", { email: existing.email, password: "a different fixture password", displayName: "Operator", consent: true });
    expect(response.statusCode).toBe(202);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: existing.id } })).passwordHash).toBe(storedPassword);
    expect((await post("/v1/auth/login", { email: existing.email, password: "a different fixture password" })).statusCode).toBe(401);
  });
  it("revokes the latest browser session when overlapping logins captured an older binding", async () => {
    const first = await account(), second = await account();
    let release!: () => void, enter!: () => void, read!: () => void, startingB = false, paused = false;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const bRead = new Promise<void>(resolve => { read = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const extended = prisma.$extends({ query: {
      accountSession: { async create({ args, query }) { if (!paused) { paused = true; enter(); await gate; } return query(args); } },
      reviewSession: { async findUnique({ args, query }) { const result = await query(args); if (startingB && result?.accountSessionId === null) read(); return result; } },
    } });
    const raced = await buildApp({ env, prisma: extended as unknown as PrismaClient, logger: false, rateLimiting: false });
    try {
      const seed = await raced.inject({ url: "/v1/session" });
      const sharedCookie = cookies(seed); reviews.push(hash(seed.cookies.find(c => c.name === "m8_review_session")!.value));
      const request = (address: string) => raced.inject({ method: "POST", url: "/v1/auth/login", headers: { origin: env.FRONTEND_ORIGIN, cookie: sharedCookie }, payload: { email: address, password: "correct fixture password" } });
      const a = request(first.email!); await entered;
      startingB = true; const b = request(second.email!); await bRead; release();
      const [aResult, bResult] = await Promise.all([a, b]);
      expect([aResult.statusCode, bResult.statusCode]).toEqual([200, 200]);
      const aCookie = [sharedCookie, cookies(aResult)].join("; "), bCookie = [sharedCookie, cookies(bResult)].join("; ");
      expect((await raced.inject({ url: "/v1/auth/session", headers: { cookie: aCookie } })).json().account).toBeNull();
      expect((await raced.inject({ url: "/v1/auth/session", headers: { cookie: bCookie } })).json().account.id).toBe(second.id);
      expect(await prisma.accountSession.count({ where: { accountId: { in: [first.id, second.id] } } })).toBe(1);
      await raced.inject({ method: "POST", url: "/v1/auth/logout", headers: { origin: env.FRONTEND_ORIGIN, cookie: bCookie }, payload: {} });
      expect((await raced.inject({ url: "/v1/auth/session", headers: { cookie: bCookie } })).json().account).toBeNull();
    } finally { release(); await raced.close(); }
  });
  it("persists login throttles across API instances", async () => {
    const address = `${randomUUID()}@example.invalid`;
    const rateEnv = { ...env, TRUST_PROXY_HOPS: 1 };
    const networks = Array.from({ length: 10 }, (_, i) => `198.51.100.${230 + i}`);
    const throttled = await buildApp({ env: rateEnv, prisma, logger: false, rateLimiting: true });
    try {
      const attempt = (network: string) => throttled.inject({ method: "POST", url: "/v1/auth/login", headers: { origin: env.FRONTEND_ORIGIN, "x-real-ip": network }, payload: { email: address, password: "incorrect fixture password" } });
      for (let i = 0; i < 8; i++) {
        const response = await attempt(networks[i]!);
        expect(response.statusCode).toBe(401);
        const review = response.cookies.find(c => c.name === "m8_review_session"); if (review) reviews.push(hash(review.value));
      }
      expect((await attempt(networks[8]!)).statusCode).toBe(429);
      const restarted = await buildApp({ env: rateEnv, prisma, logger: false, rateLimiting: true });
      try { expect((await restarted.inject({ method: "POST", url: "/v1/auth/login", headers: { origin: env.FRONTEND_ORIGIN, "x-real-ip": networks[9]! }, payload: { email: address, password: "incorrect fixture password" } })).statusCode).toBe(429); } finally { await restarted.close(); }
    } finally { await throttled.close(); await prisma.authThrottle.deleteMany({ where: { id: { in: [hash(`auth:login:identity:${address}`), ...networks.map(network => hash(`auth:login:network:${network}`))] } } }); }
  });
  it("uses generic recovery responses and reset revokes sessions, tokens and private connections", async () => {
    const existing = await account(), cookie = await login(existing.email!);
    const again = await login(existing.email!);
    const reviewCookie = again.split("; ").find(c => c.startsWith("m8_review_session="))!;
    const reviewId = hash(reviewCookie.split("=")[1]!);
    await prisma.reviewSession.update({ where: { id: reviewId }, data: { tokenEncrypted: "encrypted-fixture", tokenExpiresAt: new Date(Date.now() + 3600_000), githubLogin: "fixture", oauthAccountId: existing.id, oauthAttemptId: "fixture" } });
    const known = await post("/v1/auth/password-reset/request", { email: existing.email });
    const unknown = await post("/v1/auth/password-reset/request", { email: `${randomUUID()}@example.invalid` });
    expect(known.statusCode).toBe(202); expect(known.json()).toEqual(unknown.json());
    const reset = mail.at(-1)!;
    expect((await post("/v1/auth/password-reset/confirm", { token: token(reset), password: "replacement fixture password" })).statusCode).toBe(200);
    expect((await post("/v1/auth/password-reset/confirm", { token: token(reset), password: "replacement fixture password" })).statusCode).toBe(400);
    for (const current of [cookie, again]) expect((await app.inject({ url: "/v1/auth/session", headers: { cookie: current } })).json().account).toBeNull();
    expect((await prisma.reviewSession.findUniqueOrThrow({ where: { id: reviewId } })).tokenEncrypted).toBeNull();
    expect((await post("/v1/auth/login", { email: existing.email, password: "correct fixture password" })).statusCode).toBe(401);
    const final = await post("/v1/auth/login", { email: existing.email, password: "replacement fixture password" });
    expect(final.statusCode).toBe(200);
    const finalReview = final.cookies.find(c => c.name === "m8_review_session"); if (finalReview) reviews.push(hash(finalReview.value));
  });
  it("creates a Google customer with state/PKCE, and never merges by matching email", async () => {
    googleIdentity = { id: randomUUID(), email: `${randomUUID()}@example.invalid`, name: "Google Builder", mailboxAuthoritative: true };
    const start = await googleStart();
    expect(start.url.origin).toBe("https://accounts.google.com"); expect(start.url.searchParams.get("scope")).toBe("openid email profile");
    expect(start.url.searchParams.get("code_challenge_method")).toBe("S256"); expect(start.url.searchParams.get("nonce")).toHaveLength(43);
    const callback = await app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
    expect(callback.headers.location).toContain("/dashboard?google=connected");
    const saved = await prisma.account.findUniqueOrThrow({ where: { googleId: googleIdentity.id } }); accountIds.push(saved.id);
    const replay = await app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
    expect(replay.headers.location).toContain("google=error");
    const existing = await account(); googleIdentity = { id: randomUUID(), email: existing.email!, name: "Collision", mailboxAuthoritative: true };
    const collision = await googleStart();
    const denied = await app.inject({ url: `/v1/auth/google/callback?state=${collision.url.searchParams.get("state")}&code=fixture`, headers: { cookie: collision.cookie } });
    expect(denied.headers.location).toContain("google=link"); expect(denied.cookies.find(c => c.name === "m8_account_session")).toBeUndefined();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: existing.id } })).googleId).toBeNull();
  });
  it("links Google only to the current account and keeps its project ownership", async () => {
    const existing = await account(), cookie = await login(existing.email!);
    googleIdentity = { id: randomUUID(), email: existing.email!, name: "Linked", mailboxAuthoritative: false };
    const start = await googleStart(cookie, "link");
    const linked = await app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
    expect(linked.headers.location).toContain("/account?google=connected");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: existing.id } })).googleId).toBe(googleIdentity.id);
  });
  it("requires a mailbox challenge before bootstrapping a non-Google-hosted email", async () => {
    googleIdentity = { id: randomUUID(), email: `${randomUUID()}@example.invalid`, name: "External", mailboxAuthoritative: false };
    const start = await googleStart();
    const denied = await app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
    expect(denied.headers.location).toContain("/dashboard?google=verify-email");
    expect(denied.cookies.find(c => c.name === "m8_account_session")).toBeUndefined();
    expect(await prisma.account.findUnique({ where: { googleId: googleIdentity.id } })).toBeNull();
  });
  it.each(["available", "collision", "external"] as const)("retires stale Google recovery mail safely when the new address is %s", async kind => {
    const existing = await account();
    const subject = randomUUID();
    await prisma.account.update({ where: { id: existing.id }, data: { googleId: subject } });
    const cookie = await login(existing.email!);
    const project = await post("/v1/projects", { id: randomUUID(), name: "Owned before rename", contactEmail: existing.email, platform: "Lovable", summary: "Keep my customer work and its existing ownership.", consent: true }, cookie);
    expect(project.statusCode).toBe(201);
    await post("/v1/auth/password-reset/request", { email: existing.email });
    const oldReset = token(mail.at(-1)!);
    const other = kind === "collision" ? await account() : null;
    const newAddress = other?.email ?? `${randomUUID()}@example.invalid`;
    googleIdentity = { id: subject, email: newAddress, name: "Renamed", mailboxAuthoritative: kind !== "external" };
    const start = await googleStart(cookie);
    const renamed = await app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
    expect(renamed.headers.location).toContain(kind === "available" ? "/dashboard?google=connected" : "/account?google=recovery-conflict");
    const latest = await prisma.account.findUniqueOrThrow({ where: { id: existing.id } });
    expect(latest.email).toBe(kind === "available" ? newAddress : null);
    expect(latest.googleId).toBe(subject);
    expect(latest.passwordHash).toBeNull();
    expect((await app.inject({ url: "/v1/auth/session", headers: { cookie } })).json().account).toBeNull();
    if (other) expect((await prisma.account.findUniqueOrThrow({ where: { id: other.id } })).googleId).toBeNull();
    expect((await post("/v1/auth/password-reset/confirm", { token: oldReset, password: "new fixture password" })).statusCode).toBe(400);
    const signedInCookie = [cookies(renamed), start.cookie.split("; ").filter(c => !c.startsWith("m8_account_session=")).join("; ")].join("; ");
    const session = await app.inject({ url: "/v1/auth/session", headers: { cookie: signedInCookie } });
    expect(session.json().account.id).toBe(existing.id);
    const retained = await app.inject({ url: `/v1/projects/${project.json().id}`, headers: { cookie: signedInCookie } });
    expect(retained.statusCode).toBe(200);
    expect(retained.json().name).toBe("Owned before rename");
    const sent = mail.length;
    expect((await post("/v1/auth/password-reset/request", { email: existing.email })).statusCode).toBe(202);
    expect(mail.length).toBe(sent);
    if (kind === "available") {
      expect((await post("/v1/auth/password-reset/request", { email: newAddress })).statusCode).toBe(202);
      expect(mail.at(-1)!.to).toBe(newAddress);
    }
  });
  it("does not issue recovery to an email retired between lookup and account lock", async () => {
    const existing = await account(), subject = randomUUID();
    await prisma.account.update({ where: { id: existing.id }, data: { googleId: subject } });
    let enter!: () => void, release!: () => void, paused = false;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const extended = prisma.$extends({ query: { account: { async findUnique({ args, query }) {
      const result = await query(args);
      if (!paused && args.where.email === existing.email) { paused = true; enter(); await gate; }
      return result;
    } } } });
    const raced = await buildApp({ env, prisma: extended as unknown as PrismaClient, logger: false, rateLimiting: false,
      accountEmailProvider: { enabled: true, send: async email => { mail.push(email); } },
    });
    try {
      const before = mail.length;
      const reset = raced.inject({ method: "POST", url: "/v1/auth/password-reset/request", headers: { origin: env.FRONTEND_ORIGIN }, payload: { email: existing.email } });
      await entered;
      googleIdentity = { id: subject, email: `${randomUUID()}@example.invalid`, name: "Renamed", mailboxAuthoritative: true };
      const start = await googleStart();
      const renamed = await app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
      expect(renamed.headers.location).toContain("google=connected");
      release();
      expect((await reset).statusCode).toBe(202);
      expect(mail.length).toBe(before);
      expect(await prisma.accountToken.count({ where: { accountId: existing.id } })).toBe(0);
    } finally { release(); await raced.close(); }
  });
  it("returns an actionable Google email mismatch to Account settings without switching ownership", async () => {
    const existing = await account(), cookie = await login(existing.email!);
    googleIdentity = { id: randomUUID(), email: `${randomUUID()}@example.invalid`, name: "Different", mailboxAuthoritative: true };
    const start = await googleStart(cookie, "link");
    const result = await app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
    expect(result.headers.location).toContain("/account?google=link-mismatch");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: existing.id } })).googleId).toBeNull();
  });
  it("logout cancels an in-flight Google exchange", async () => {
    const existing = await account(), cookie = await login(existing.email!);
    googleIdentity = { id: randomUUID(), email: `${randomUUID()}@example.invalid`, name: "Cancelled", mailboxAuthoritative: true };
    const start = await googleStart(cookie);
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    googleExchangeHook = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); };
    const callback = app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
    await waiting; await post("/v1/auth/logout", {}, start.cookie); release();
    const result = await callback; googleExchangeHook = async () => {};
    expect(result.headers.location).toContain("google=error"); expect(result.cookies.find(c => c.name === "m8_account_session")).toBeUndefined();
    expect(await prisma.account.findUnique({ where: { googleId: googleIdentity.id } })).toBeNull();
  });
  it("connects GitHub to an email account but refuses an identity already linked elsewhere", async () => {
    const existing = await account(), cookie = await login(existing.email!);
    githubIdentity = { id: 940000001 + Math.floor(Math.random() * 100000), login: "email-builder", name: "Builder" };
    const start = await app.inject({ url: "/v1/github/connect?flow=workspace", headers: { cookie } });
    expect(new URL(start.headers.location!).searchParams.has("login")).toBe(false);
    const result = await app.inject({ url: `/v1/github/callback?state=${new URL(start.headers.location!).searchParams.get("state")}&code=fixture`, headers: { cookie } });
    expect(result.headers.location).toContain("github=connected");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: existing.id } })).githubId).toBe(String(githubIdentity.id));
    const other = await account(), otherCookie = await login(other.email!);
    const deniedStart = await app.inject({ url: "/v1/github/connect?flow=workspace", headers: { cookie: otherCookie } });
    const denied = await app.inject({ url: `/v1/github/callback?state=${new URL(deniedStart.headers.location!).searchParams.get("state")}&code=fixture`, headers: { cookie: otherCookie } });
    expect(denied.headers.location).toContain("github=identity");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: other.id } })).githubId).toBeNull();
  });
  it("does not reopen closed identities through signup, recovery, Google or GitHub", async () => {
    const owner = await account(), cookie = await login(owner.email!);
    googleIdentity = { id: randomUUID(), email: owner.email!, name: "Closed Builder", mailboxAuthoritative: true };
    githubIdentity = { id: 948000000 + Math.floor(Math.random() * 1000000), login: "closed-builder", name: "Closed Builder" };
    await prisma.account.update({ where: { id: owner.id }, data: { googleId: googleIdentity.id, githubId: String(githubIdentity.id) } });
    await post("/v1/auth/password-reset/request", { email: owner.email }); const oldReset = token(mail.at(-1)!);
    expect((await post("/v1/auth/account/close", { accountId: owner.id, requestId: randomUUID(), confirmation: "CLOSE" }, cookie)).statusCode).toBe(200);
    const before = mail.length;
    expect((await post("/v1/auth/register", { email: owner.email, password: "correct fixture password", displayName: "Builder", consent: true })).statusCode).toBe(202);
    expect((await post("/v1/auth/password-reset/request", { email: owner.email })).statusCode).toBe(202);
    expect(mail).toHaveLength(before);
    expect((await post("/v1/auth/password-reset/confirm", { token: oldReset, password: "new fixture password" })).statusCode).toBe(400);
    expect((await post("/v1/auth/login", { email: owner.email, password: "correct fixture password" })).statusCode).toBe(401);
    const start = await googleStart();
    const google = await app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
    expect(google.headers.location).toContain("google=account-closed");
    const ghStart = await app.inject({ url: "/v1/github/connect?flow=login" }); const ghCookies = cookies(ghStart);
    reviews.push(hash(ghStart.cookies.find(c => c.name === "m8_review_session")!.value));
    const github = await app.inject({ url: `/v1/github/callback?state=${new URL(ghStart.headers.location!).searchParams.get("state")}&code=fixture`, headers: { cookie: ghCookies } });
    expect(github.headers.location).toContain("github=account-closed");
    expect(await prisma.accountSession.count({ where: { accountId: owner.id } })).toBe(0);
    expect(await prisma.account.count({ where: { email: owner.email } })).toBe(1);
  });
  it("prevents an in-flight Google callback from signing in after closure", async () => {
    const owner = await account(), cookie = await login(owner.email!);
    googleIdentity = { id: randomUUID(), email: owner.email!, name: "Builder", mailboxAuthoritative: true };
    await prisma.account.update({ where: { id: owner.id }, data: { googleId: googleIdentity.id } });
    const start = await googleStart(); let release!: () => void, enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    googleExchangeHook = async () => { enter(); await gate; };
    try {
      const callback = app.inject({ url: `/v1/auth/google/callback?state=${start.url.searchParams.get("state")}&code=fixture`, headers: { cookie: start.cookie } });
      await entered;
      expect((await post("/v1/auth/account/close", { accountId: owner.id, requestId: randomUUID(), confirmation: "CLOSE" }, cookie)).statusCode).toBe(200);
      release(); expect((await callback).headers.location).toContain("google=account-closed");
      expect(await prisma.accountSession.count({ where: { accountId: owner.id } })).toBe(0);
    } finally { release(); googleExchangeHook = async () => {}; }
  });
  it("rejects weak passwords, missing acknowledgments, and foreign-origin auth writes", async () => {
    const body = { email: `${randomUUID()}@example.invalid`, password: "short", displayName: "Builder", consent: true };
    expect((await post("/v1/auth/register", body)).statusCode).toBe(400);
    expect((await post("/v1/auth/register", { ...body, password: "correct fixture password", consent: false })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin: "https://evil.example" }, payload: { email: body.email, password: "correct fixture password" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: body.email, password: "correct fixture password" } })).statusCode).toBe(403);
  });
});
