import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { encrypt, hash, secret } from "../src/crypto.js";
const dbUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!dbUrl)("private local review queue", () => {
  const prisma = new PrismaClient({ datasourceUrl: dbUrl ?? "postgresql://unused@localhost/m8itwork_test" });
  const operatorGithubId = String(7_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: dbUrl, TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), OPERATOR_GITHUB_IDS: operatorGithubId });
  const accounts: string[] = [], connections: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let operator: { id: string; cookie: string }, customer: { id: string; cookie: string }, stranger: { id: string; cookie: string };
  let githubCalls = 0;
  async function account(githubId?: string) {
    const row = await prisma.account.create({ data: { ...(githubId ? { githubId } : {}), displayName: "Fixture" } });
    accounts.push(row.id); const raw = secret();
    await prisma.accountSession.create({ data: { id: hash(raw), accountId: row.id, expiresAt: new Date(Date.now() + 600_000) } });
    return { id: row.id, cookie: `m8_account_session=${raw}` };
  }
  beforeAll(async () => {
    if (!dbUrl || !new URL(dbUrl).pathname.endsWith("/m8itwork_test")) throw new Error("Dedicated test database required.");
    operator = await account(operatorGithubId); customer = await account(); stranger = await account();
    const conn = hash(secret()); connections.push(conn);
    await prisma.reviewSession.create({ data: { id: conn, accountSessionId: hash(customer.cookie.split("=")[1]!), expiresAt: new Date(Date.now() + 600_000), tokenExpiresAt: new Date(Date.now() + 600_000), tokenEncrypted: encrypt("fixture-customer-access", env.TOKEN_ENCRYPTION_KEY) } });
    app = await buildApp({ prisma, env, logger: false, rateLimiting: false, fetcher: async (url, init) => {
      githubCalls++;
      const path = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname;
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-customer-access");
      if (path.endsWith("/app")) return Response.json({ full_name: "fixture/app", html_url: "https://github.com/fixture/app" });
      if (path.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ path: "src/auth.ts", type: "blob", size: 100, sha: "b".repeat(40) }, { path: ".env", type: "blob", size: 50, sha: "c".repeat(40) }] });
      if (path.includes("/git/blobs/")) return Response.json({ encoding: "base64", content: Buffer.from("export const auth = () => false;").toString("base64") });
      throw new Error("Unexpected GitHub call");
    } });
  });
  afterAll(async () => {
    await prisma.reviewSession.deleteMany({ where: { id: { in: connections } } });
    await prisma.account.deleteMany({ where: { id: { in: accounts } } });
    await app?.close();
  });
  const post = (url: string, cookie: string, payload: unknown) => app.inject({ method: "POST", url, headers: { cookie, origin: env.ADMIN_ORIGIN, "content-type": "application/json" }, payload: JSON.stringify(payload) });
  const workerPost = (url: string, token: string, payload: unknown) => app.inject({ method: "POST", url: `/v1/review-worker${url}`, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, payload: JSON.stringify(payload) });
  async function project(consent = true) { return prisma.project.create({ data: { accountId: customer.id, name: "Fixture app", contactEmail: "fixture@example.invalid", platform: "GitHub", summary: "Add login and protected routes to the app.", repositoryUrl: "https://github.com/fixture/app", inspectionReport: { commit: "a".repeat(40) }, stage: "IN_REVIEW", ...(consent ? { aiReviewConsentAt: new Date(), aiReviewConsentVersion: "ai-review-v1" } : {}) } }); }
  async function pair() { const result = await post("/v1/operator/review-workers", operator.cookie, { name: "Fixture Mac" }); expect(result.statusCode).toBe(200); return result.json<{ token: string; worker: { id: string } }>(); }
  async function queue(projectId: string, version = 1) { const id = randomUUID(); const result = await post(`/v1/operator/projects/${projectId}/review-jobs`, operator.cookie, { id, version, provider: "codex" }); expect(result.statusCode).toBe(200); return id; }
  const report = { summary: "Login currently denies every request; add a verified session flow.", findings: [{ severity: "high", detail: "Authentication always returns false.", evidence: ["src/auth.ts"] }], scope: "Implement signed sessions and protected routes.", acceptance: "Test valid login, invalid login, logout, and protected access.", assumptions: "Static sample only; no workflows executed.", questions: ["Which identity provider should be used?"], effort: { minHours: 8, maxHours: 16, confidence: "low" } };
  it("rejects customers, unpaired workers, foreign origins and old projects without AI permission", async () => {
    const p = await project(false);
    expect((await post("/v1/operator/review-workers", customer.cookie, { name: "No" })).statusCode).toBe(403);
    expect((await workerPost("/claim", secret(), { attemptId: randomUUID(), providers: ["codex"] })).statusCode).toBe(401);
    expect((await post(`/v1/operator/projects/${p.id}/review-jobs`, operator.cookie, { id: randomUUID(), version: 1, provider: "codex" })).json().error.code).toBe("AI_CONSENT_REQUIRED");
    expect((await post(`/v1/projects/${p.id}/ai-review-consent`, stranger.cookie, { version: 1, policy: "ai-review-v1", consent: true })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/operator/review-workers", headers: { cookie: operator.cookie, origin: "https://foreign.invalid" }, payload: { name: "No" } })).statusCode).toBe(403);
  });
  it("claims once, pins source, validates evidence, keeps results private and accepts a duplicate upload", async () => {
    const p = await project(), w = await pair(), id = await queue(p.id), attemptId = randomUUID();
    const claims = await Promise.all([1, 2].map(() => workerPost("/claim", w.token, { attemptId, providers: ["codex"] })));
    expect(claims.map(c => c.json<{ job: { id: string } }>().job.id)).toEqual([id, id]);
    expect((await workerPost("/claim", w.token, { attemptId: randomUUID(), providers: ["codex"] })).json().job).toBeNull();
    const context = await workerPost(`/jobs/${id}/context`, w.token, { attemptId }); expect(context.statusCode).toBe(200); expect(context.body).not.toContain("fixture-customer-access"); expect(context.json().source.files).toHaveLength(1);
    expect((await workerPost(`/jobs/${id}/complete`, w.token, { attemptId, report: { ...report, findings: [{ ...report.findings[0], evidence: ["imaginary.ts"] }] } })).statusCode).toBe(400);
    const results = await Promise.all([1, 2].map(() => workerPost(`/jobs/${id}/complete`, w.token, { attemptId, report }))); expect(results.map(r => r.statusCode)).toEqual([200, 200]);
    const customerView = await app.inject({ url: `/v1/projects/${p.id}`, headers: { cookie: customer.cookie } }); expect(customerView.body).not.toContain("Authentication always returns false"); expect(customerView.body).not.toContain("reviewJobs");
    expect((await app.inject({ url: `/v1/operator/projects/${p.id}/review-jobs`, headers: { cookie: customer.cookie } })).statusCode).toBe(403);
    expect(await prisma.project.findUnique({ where: { id: p.id } }).then(r => r?.reviewSummary)).toBeNull();
  });
  it("fences expired leases and recovers with another worker", async () => {
    const p = await project(), w = await pair(), id = await queue(p.id), attemptId = randomUUID();
    await workerPost("/claim", w.token, { attemptId, providers: ["codex"] });
    await prisma.reviewJob.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const w2 = await pair(), newAttempt = randomUUID();
    expect((await workerPost("/claim", w2.token, { attemptId: newAttempt, providers: ["codex"] })).json().job.id).toBe(id);
    expect((await workerPost(`/jobs/${id}/heartbeat`, w.token, { attemptId })).statusCode).toBe(409);
    expect((await workerPost(`/jobs/${id}/complete`, w.token, { attemptId, report })).statusCode).toBe(409);
    await workerPost(`/jobs/${id}/fail`, w2.token, { attemptId: newAttempt, code: "QUOTA" });
    expect((await prisma.reviewJob.findUniqueOrThrow({ where: { id } })).errorCode).toBe("QUOTA");
  });
  it("withdrawal and worker revocation cancel jobs and block source", async () => {
    const p = await project(), w = await pair(), id = await queue(p.id), attemptId = randomUUID();
    await workerPost("/claim", w.token, { attemptId, providers: ["codex"] });
    expect((await post(`/v1/projects/${p.id}/ai-review-consent`, customer.cookie, { version: 2, policy: "ai-review-v1", consent: false })).statusCode).toBe(200);
    const before = githubCalls; expect((await workerPost(`/jobs/${id}/context`, w.token, { attemptId })).statusCode).toBe(409); expect(githubCalls).toBe(before);
    await post(`/v1/operator/review-workers/${w.worker.id}/revoke`, operator.cookie, {});
    expect((await workerPost("/claim", w.token, { attemptId: randomUUID(), providers: ["codex"] })).statusCode).toBe(401);
  });
  it("marks a draft stale when customer requests change", async () => {
    const p = await project(); await queue(p.id);
    await prisma.projectRequest.create({ data: { projectId: p.id, kind: "FEATURE", title: "New request", detail: "Add payments too, please." } });
    const response = await app.inject({ url: `/v1/operator/projects/${p.id}/review-jobs`, headers: { cookie: operator.cookie } }); expect(response.json().jobs[0].stale).toBe(true);
    await prisma.reviewJob.updateMany({ where: { projectId: p.id }, data: { status: "CANCELLED" } });
  });
  it("binds a job to its original repository and inspection commit", async () => {
    const p = await project(), w = await pair(), id = await queue(p.id), attemptId = randomUUID();
    await workerPost("/claim", w.token, { attemptId, providers: ["codex"] });
    await prisma.project.update({ where: { id: p.id }, data: { repositoryUrl: "https://github.com/fixture/fork", inspectionReport: { commit: "d".repeat(40) } } });
    const before = githubCalls;
    expect((await workerPost(`/jobs/${id}/context`, w.token, { attemptId })).statusCode).toBe(409);
    expect(githubCalls).toBe(before);
    const jobs = await app.inject({ url: `/v1/operator/projects/${p.id}/review-jobs`, headers: { cookie: operator.cookie } });
    expect(jobs.json().jobs[0].stale).toBe(true);
    await prisma.reviewJob.update({ where: { id }, data: { status: "CANCELLED" } });
  });
  it("stops recovering after three expired attempts", async () => {
    const p = await project(), w = await pair(), id = await queue(p.id), attemptId = randomUUID();
    await workerPost("/claim", w.token, { attemptId, providers: ["codex"] });
    await prisma.reviewJob.update({ where: { id }, data: { attempts: 3, leaseExpiresAt: new Date(Date.now() - 1000) } });
    expect((await workerPost("/claim", w.token, { attemptId: randomUUID(), providers: ["codex"] })).json().job).toBeNull();
    const failed = await prisma.reviewJob.findUniqueOrThrow({ where: { id } });
    expect(failed.status).toBe("FAILED"); expect(failed.errorCode).toBe("TIMEOUT");
  });
  it("cancels a source attempt when the customer's stored connection is disconnected", async () => {
    const p = await project(), w = await pair(), id = await queue(p.id), attemptId = randomUUID();
    await workerPost("/claim", w.token, { attemptId, providers: ["codex"] });
    expect((await workerPost(`/jobs/${id}/context`, w.token, { attemptId })).statusCode).toBe(200);
    await prisma.reviewSession.update({ where: { id: connections[0]! }, data: { tokenEncrypted: null } });
    expect((await workerPost(`/jobs/${id}/heartbeat`, w.token, { attemptId })).statusCode).toBe(409);
    expect((await workerPost(`/jobs/${id}/complete`, w.token, { attemptId, report })).statusCode).toBe(409);
    await prisma.reviewJob.update({ where: { id }, data: { status: "CANCELLED" } });
  });
});
