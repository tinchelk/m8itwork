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
    const results = await Promise.all([1, 2].map(() => workerPost(`/jobs/${id}/complete`, w.token, { attemptId, report }))); expect(results.map(r => r.statusCode), results.map(r => r.body).join("\n")).toEqual([200, 200]);
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
  it("reports provider readiness privately while idle and rejects revoked status reporters", async () => {
    const w = await pair();
    expect((await workerPost("/status", w.token, { providers: [{ provider: "codex", state: "NEEDS_LOGIN" }] })).statusCode).toBe(200);
    const view = await app.inject({ url: "/v1/operator/review-workers", headers: { cookie: operator.cookie } });
    const row = view.json<{ workers: { id: string; providerStatus: unknown; lastSeenAt: unknown }[] }>().workers.find(r => r.id === w.worker.id)!;
    expect(row.providerStatus).toEqual([{ provider: "codex", state: "NEEDS_LOGIN" }]); expect(row.lastSeenAt).toBeTruthy(); expect(view.body).not.toContain(w.token);
    expect((await app.inject({ url: "/v1/operator/review-workers", headers: { cookie: customer.cookie } })).statusCode).toBe(403);
    expect((await workerPost("/status", w.token, { providers: [{ provider: "codex", state: "READY", secret: "not accepted" }] })).statusCode).toBe(400);
    await post(`/v1/operator/review-workers/${w.worker.id}/revoke`, operator.cookie, {});
    expect((await workerPost("/status", w.token, { providers: [{ provider: "codex", state: "READY" }] })).statusCode).toBe(401);
  });
  it("fences and redacts private activity and bounds retained progress", async () => {
    const p = await project(), w = await pair(), id = await queue(p.id), attemptId = randomUUID();
    await workerPost("/claim", w.token, { attemptId, providers: ["codex"] });
    const event = { id: randomUUID(), kind: "MESSAGE", text: `Visible reply. Authorization: Bearer ${"x".repeat(43)}` };
    for (let i = 0; i < 2; i++) expect((await workerPost(`/jobs/${id}/events`, w.token, { attemptId, event })).statusCode).toBe(200);
    expect((await prisma.reviewJob.findUniqueOrThrow({ where: { id } })).activity).toHaveLength(1);
    const view = await app.inject({ url: `/v1/operator/projects/${p.id}/review-jobs`, headers: { cookie: operator.cookie } });
    expect(view.body).toContain("Visible reply"); expect(view.body).not.toContain("x".repeat(43));
    expect((await workerPost(`/jobs/${id}/events`, w.token, { attemptId: randomUUID(), event })).statusCode).toBe(409);
    const w2 = await pair(); expect((await workerPost(`/jobs/${id}/events`, w2.token, { attemptId, event })).statusCode).toBe(409);
    for (let i = 0; i < 61; i++) await workerPost(`/jobs/${id}/events`, w.token, { attemptId, event: { id: randomUUID(), kind: "MODEL", text: `Progress ${i}` } });
    const stored = await prisma.reviewJob.findUniqueOrThrow({ where: { id } }); expect(stored.activity).toHaveLength(60); expect(stored.activityOmitted).toBe(2);
    expect((await app.inject({ url: `/v1/projects/${p.id}`, headers: { cookie: customer.cookie } })).body).not.toContain("Progress 60");
    await prisma.reviewJob.update({ where: { id }, data: { status: "CANCELLED" } });
    expect((await workerPost(`/jobs/${id}/events`, w.token, { attemptId, event })).statusCode).toBe(409);
  });
  it("continues a grounded operator conversation idempotently and rejects stale or foreign replies", async () => {
    // The earlier disconnect fixture deliberately cleared this customer's connection.
    await prisma.reviewSession.update({ where: { id: connections[0]! }, data: { tokenEncrypted: encrypt("fixture-customer-access", env.TOKEN_ENCRYPTION_KEY) } });
    const p = await project(), w = await pair(), id = await queue(p.id), attemptId = randomUUID();
    await workerPost("/claim", w.token, { attemptId, providers: ["codex"] });
    await workerPost(`/jobs/${id}/context`, w.token, { attemptId }); await workerPost(`/jobs/${id}/complete`, w.token, { attemptId, report });
    const nextId = randomUUID(), body = { id: nextId, version: 2, provider: "claude", instructions: "Can we ship the session flow separately?", parentJobId: id };
    for (let i = 0; i < 2; i++) expect((await post(`/v1/operator/projects/${p.id}/review-jobs`, operator.cookie, body)).statusCode).toBe(200);
    expect(await prisma.reviewJob.count({ where: { id: nextId } })).toBe(1);
    expect((await post(`/v1/operator/projects/${p.id}/review-jobs`, operator.cookie, { ...body, instructions: "Changed instruction" })).statusCode).toBe(409);
    const nextAttempt = randomUUID(); await workerPost("/claim", w.token, { attemptId: nextAttempt, providers: ["claude"] });
    const context = await workerPost(`/jobs/${nextId}/context`, w.token, { attemptId: nextAttempt });
    expect((await prisma.reviewJob.findUniqueOrThrow({ where: { id: nextId } })).provider).toBe("claude");
    expect(context.json().discussion.instructions).toBe(body.instructions); expect(context.json().discussion.previous[0].summary).toBe(report.summary);
    expect((await app.inject({ url: `/v1/projects/${p.id}`, headers: { cookie: customer.cookie } })).body).not.toContain(body.instructions);
    await prisma.projectRequest.create({ data: { projectId: p.id, kind: "FEATURE", title: "New scope during execution", detail: "New request" } });
    expect((await workerPost(`/jobs/${nextId}/heartbeat`, w.token, { attemptId: nextAttempt })).statusCode).toBe(409);
    await prisma.reviewJob.update({ where: { id: nextId }, data: { status: "QUEUED", workerId: null, attemptId: null, leaseExpiresAt: null } });
    expect((await workerPost("/claim", w.token, { attemptId: randomUUID(), providers: ["claude"] })).json().job).toBeNull();
    expect((await prisma.reviewJob.findUniqueOrThrow({ where: { id: nextId } })).status).toBe("CANCELLED");
    const other = await project(); expect((await post(`/v1/operator/projects/${other.id}/review-jobs`, operator.cookie, { ...body, id: randomUUID(), version: 1 })).statusCode).toBe(409);
    await prisma.projectRequest.create({ data: { projectId: p.id, kind: "FEATURE", title: "Changed scope", detail: "Add another workflow" } });
    expect((await post(`/v1/operator/projects/${p.id}/review-jobs`, operator.cookie, { ...body, id: randomUUID(), version: 3 })).json().error.code).toBe("STALE_CONVERSATION");
  });
  it("pages all review turns without accepting another project's cursor", async () => {
    const p = await project(), another = await project();
    for (let i = 0; i < 12; i++) await prisma.reviewJob.create({ data: { id: randomUUID(), projectId: p.id, provider: "codex", status: "CANCELLED", commit: "a".repeat(40), repositoryUrl: p.repositoryUrl!, inputDigest: "fixture", requestSnapshot: { summary: p.summary, requests: [] }, instructions: `Question ${i}` } });
    const first = await app.inject({ url: `/v1/operator/projects/${p.id}/review-jobs`, headers: { cookie: operator.cookie } }); expect(first.json().jobs).toHaveLength(10);
    const savedId = first.json<{ jobs: { id: string }[] }>().jobs[0]!.id;
    expect((await app.inject({ url: `/v1/operator/projects/${p.id}/review-jobs/${savedId}`, headers: { cookie: customer.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: `/v1/operator/projects/${another.id}/review-jobs/${savedId}`, headers: { cookie: operator.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/operator/projects/${p.id}/review-jobs/${savedId}`, headers: { cookie: operator.cookie } })).statusCode).toBe(200);
    const second = await app.inject({ url: `/v1/operator/projects/${p.id}/review-jobs?cursor=${first.json().nextCursor}`, headers: { cookie: operator.cookie } }); expect(second.json().jobs).toHaveLength(2); expect(second.json().nextCursor).toBeNull();
    expect(new Set([...first.json().jobs, ...second.json().jobs].map((j: { id: string }) => j.id)).size).toBe(12);
    expect((await app.inject({ url: `/v1/operator/projects/${another.id}/review-jobs?cursor=${first.json().nextCursor}`, headers: { cookie: operator.cookie } })).statusCode).toBe(404);
  });
  it("reconnect is operator-only, capability checked, idempotent and excludes concurrent reviews", async () => {
    const w = await pair(), requestId = randomUUID(), route = `/v1/operator/review-workers/${w.worker.id}/login`;
    expect((await post(route, customer.cookie, { requestId })).statusCode).toBe(403);
    expect((await post(route, operator.cookie, { requestId })).json().error.code).toBe("WORKER_UPGRADE");
    await workerPost("/status", w.token, { remoteLogin: true, providers: [{ provider: "codex", state: "NEEDS_LOGIN" }] });
    const starts = await Promise.all([1, 2].map(() => post(route, operator.cookie, { requestId })));
    expect(starts.map(r => r.json<{ login: { id: string } }>().login.id)).toEqual([requestId, requestId]);
    expect((await post(route, operator.cookie, { requestId: randomUUID() })).json().login.id).toBe(requestId);
    expect((await workerPost("/claim", w.token, { attemptId: randomUUID(), providers: ["codex"] })).json().job).toBeNull();
    const attemptId = randomUUID();
    expect((await workerPost("/login/claim", w.token, { attemptId })).json().login.id).toBe(requestId);
    expect((await workerPost("/login/claim", w.token, { attemptId })).json().login.id).toBe(requestId);
    expect((await workerPost("/login/claim", w.token, { attemptId: randomUUID() })).json().login).toBeNull();
    const update = `/login/${requestId}/update`;
    expect((await workerPost(update, w.token, { attemptId, status: "WAITING", url: "https://evil.invalid/", code: "ABCD-EF123" })).statusCode).toBe(400);
    expect((await workerPost(update, w.token, { attemptId, status: "WAITING", url: "https://auth.openai.com/codex/device", code: "ABCD-EF123", token: "forbidden" })).statusCode).toBe(400);
    expect((await workerPost(update, w.token, { attemptId, status: "WAITING", url: "https://auth.openai.com/codex/device", code: "ABCD-EF123" })).statusCode).toBe(200);
    await workerPost(update, w.token, { attemptId, status: "PREPARING" });
    const operatorView = await app.inject({ url: "/v1/operator/review-workers", headers: { cookie: operator.cookie } });
    expect(operatorView.body).toContain("ABCD-EF123"); expect(operatorView.body).not.toContain(attemptId);
    expect((await app.inject({ url: "/v1/operator/review-workers", headers: { cookie: customer.cookie } })).statusCode).toBe(403);
    expect((await workerPost(update, w.token, { attemptId, status: "SUCCEEDED" })).statusCode).toBe(200);
    expect((await workerPost(update, w.token, { attemptId, status: "SUCCEEDED" })).statusCode).toBe(200);
    expect(JSON.stringify((await prisma.reviewWorker.findUniqueOrThrow({ where: { id: w.worker.id } })).loginRequest)).not.toContain("ABCD-EF123");
  });
  it("login cancellation, expiry, foreign workers and revocation fence the prompt", async () => {
    const w = await pair(), other = await pair(), route = `/v1/operator/review-workers/${w.worker.id}/login`;
    await workerPost("/status", w.token, { remoteLogin: true, providers: [{ provider: "codex", state: "READY" }] });
    for (const end of ["cancel", "expire", "revoke"]) {
      const requestId = randomUUID(), attemptId = randomUUID();
      await post(route, operator.cookie, { requestId }); await workerPost("/login/claim", w.token, { attemptId });
      const body = { attemptId, status: "WAITING", url: "https://auth.openai.com/codex/device", code: "ABCD-EF123" };
      expect((await workerPost(`/login/${requestId}/update`, other.token, body)).statusCode).toBe(409);
      await workerPost(`/login/${requestId}/update`, w.token, body);
      if (end === "cancel") await post(`${route}/cancel`, operator.cookie, { requestId });
      if (end === "expire") {
        const record = await prisma.reviewWorker.findUniqueOrThrow({ where: { id: w.worker.id } });
        await prisma.reviewWorker.update({ where: { id: w.worker.id }, data: { loginRequest: { ...(record.loginRequest as object), expiresAt: new Date(Date.now() - 1000).toISOString() } } });
        const view = await app.inject({ url: "/v1/operator/review-workers", headers: { cookie: operator.cookie } });
        expect(view.body).not.toContain("ABCD-EF123");
      }
      if (end === "revoke") await post(`/v1/operator/review-workers/${w.worker.id}/revoke`, operator.cookie, {});
      expect((await workerPost(`/login/${requestId}/update`, w.token, body)).statusCode).toBe(end === "revoke" ? 401 : 409);
      expect(JSON.stringify((await prisma.reviewWorker.findUniqueOrThrow({ where: { id: w.worker.id } })).loginRequest)).not.toContain("ABCD-EF123");
    }
  });
  it("offline workers cannot start login and an active review wins the shared lock", async () => {
    const w = await pair(), route = `/v1/operator/review-workers/${w.worker.id}/login`;
    await workerPost("/status", w.token, { remoteLogin: true, providers: [{ provider: "codex", state: "READY" }] });
    await prisma.reviewWorker.update({ where: { id: w.worker.id }, data: { lastSeenAt: new Date(Date.now() - 90_000) } });
    expect((await post(route, operator.cookie, { requestId: randomUUID() })).json().error.code).toBe("WORKER_OFFLINE");
    await workerPost("/status", w.token, { remoteLogin: true, providers: [{ provider: "codex", state: "READY" }] });
    const p = await project(), id = await queue(p.id), attemptId = randomUUID();
    // Isolate claim ordering from other tests' intentionally unfinished queue entries.
    await prisma.reviewJob.updateMany({ where: { status: "QUEUED", id: { not: id } }, data: { status: "CANCELLED" } });
    await workerPost("/claim", w.token, { attemptId, providers: ["codex"] });
    expect((await post(route, operator.cookie, { requestId: randomUUID() })).json().error.code).toBe("WORKER_BUSY");
    await workerPost(`/jobs/${id}/fail`, w.token, { attemptId, code: "AUTH" });
  });

  it("old-format status cancels remote login on rollback and restores the upgrade guidance", async () => {
    const w = await pair(), requestId = randomUUID(), route = `/v1/operator/review-workers/${w.worker.id}/login`;
    await workerPost("/status", w.token, { remoteLogin: true, providers: [{ provider: "codex", state: "READY" }] });
    await post(route, operator.cookie, { requestId });
    await workerPost("/status", w.token, { providers: [{ provider: "codex", state: "READY" }] });
    const record = await prisma.reviewWorker.findUniqueOrThrow({ where: { id: w.worker.id } });
    expect(record.remoteLogin).toBe(false); expect((record.loginRequest as { status: string }).status).toBe("CANCELLED");
    expect((await post(route, operator.cookie, { requestId: randomUUID() })).json().error.code).toBe("WORKER_UPGRADE");
  });

  it("queues an atomic independent pair, retries once, scopes history and cancels only unfinished work", async () => {
    const p = await project(), other = await project(), comparisonId = randomUUID();
    const url = `/v1/operator/projects/${p.id}/review-comparisons`;
    const body = { id: comparisonId, version: 1, provider: "both", instructions: "Compare the smallest launch scope." };
    expect((await post(url, customer.cookie, body)).statusCode).toBe(403);
    const results = await Promise.all([1, 2].map(() => post(url, operator.cookie, body)));
    expect(results.map(r => r.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    const jobs = await prisma.reviewJob.findMany({ where: { comparisonId }, orderBy: { provider: "asc" } });
    expect(jobs.map(j => j.provider)).toEqual(["claude", "codex"]);
    expect(jobs.every(j => j.commit === "a".repeat(40) && j.parentJobId === null && JSON.stringify(j.previousTurns) === "[]")).toBe(true);
    expect(jobs[0]!.inputDigest).toBe(jobs[1]!.inputDigest); expect(jobs[0]!.requestSnapshot).toEqual(jobs[1]!.requestSnapshot);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).version).toBe(2);
    expect((await post(url, operator.cookie, { ...body, instructions: "Different instructions" })).statusCode).toBe(409);
    expect((await post(`/v1/operator/projects/${other.id}/review-comparisons`, operator.cookie, body)).statusCode).toBe(409);
    expect((await post(url, operator.cookie, { ...body, id: randomUUID(), version: 2 })).json().error.code).toBe("REVIEW_ACTIVE");
    expect((await post(`/v1/operator/projects/${p.id}/review-jobs`, operator.cookie, { id: randomUUID(), version: 2, provider: "codex" })).json().error.code).toBe("REVIEW_ACTIVE");
    const get = (path: string, cookie = operator.cookie) => app.inject({ url: path, headers: { cookie } });
    expect((await get(`${url}/${comparisonId}`, customer.cookie)).statusCode).toBe(403);
    expect((await get(`/v1/operator/projects/${other.id}/review-comparisons/${comparisonId}`)).statusCode).toBe(404);
    expect((await post(`/v1/operator/projects/${other.id}/review-comparisons/${comparisonId}/cancel`, operator.cookie, {})).statusCode).toBe(404);
    await prisma.reviewJob.createMany({ data: Array.from({ length: 12 }, () => ({ id: randomUUID(), projectId: p.id, provider: "codex", status: "FAILED" as const, commit: jobs[0]!.commit, repositoryUrl: p.repositoryUrl!, inputDigest: jobs[0]!.inputDigest, requestSnapshot: {} })) });
    expect((await get(`${url}/${comparisonId}`)).json().jobs).toHaveLength(2);
    const codex = jobs.find(j => j.provider === "codex")!;
    await prisma.reviewJob.update({ where: { id: codex.id }, data: { status: "SUCCEEDED", result: report } });
    await post(`${url}/${comparisonId}/cancel`, operator.cookie, {});
    const cancelled = (await get(`${url}/${comparisonId}`)).json<{ jobs: { provider: string; status: string; result: unknown }[] }>().jobs;
    expect(cancelled.find(j => j.provider === "claude")!.status).toBe("CANCELLED");
    expect(cancelled.find(j => j.provider === "codex")!.result).toEqual(report);
    const publicView = await get(`/v1/projects/${p.id}`, customer.cookie);
    expect(publicView.body).not.toContain(comparisonId); expect(publicView.body).not.toContain(report.scope);
    await prisma.projectRequest.create({ data: { projectId: p.id, kind: "FEATURE", title: "Extra scope", detail: "Add payment support." } });
    expect((await get(`${url}/${comparisonId}`)).json<{ jobs: { stale: boolean }[] }>().jobs.every(j => j.stale)).toBe(true);
  });
  it("keeps pair contexts independent and allows both validated handoff directions with the unchanged worker protocol", async () => {
    const p = await project(), w = await pair(), comparisonId = randomUUID();
    await prisma.reviewSession.update({ where: { id: connections[0]! }, data: { tokenEncrypted: encrypt("fixture-customer-access", env.TOKEN_ENCRYPTION_KEY) } });
    await prisma.reviewJob.updateMany({ where: { project: { accountId: customer.id }, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", leaseExpiresAt: null } });
    expect((await post(`/v1/operator/projects/${p.id}/review-comparisons`, operator.cookie, { id: comparisonId, version: 1, provider: "both", instructions: "Inspect identity and estimate scope." })).statusCode).toBe(200);
    const contexts: unknown[] = [];
    const completed: Record<string, string> = {};
    for (const provider of ["codex", "claude"]) {
      const attemptId = randomUUID();
      const claim = await workerPost("/claim", w.token, { attemptId, providers: [provider] });
      const id = claim.json().job.id; completed[provider] = id;
      const context = await workerPost(`/jobs/${id}/context`, w.token, { attemptId });
      expect(context.statusCode).toBe(200); expect(context.json().discussion.previous).toEqual([]); contexts.push(context.json());
      expect((await workerPost(`/jobs/${id}/complete`, w.token, { attemptId, report: { ...report, summary: `${provider} independent proposal.` } })).statusCode).toBe(200);
    }
    expect(contexts[0]).toEqual(contexts[1]);
    let version = 2;
    for (const [source, destination] of [["codex", "claude"], ["claude", "codex"]] as const) {
      const id = randomUUID();
      expect((await post(`/v1/operator/projects/${p.id}/review-jobs`, operator.cookie, { id, version: version++, provider: destination, parentJobId: completed[source], instructions: "Challenge this proposal's assumptions." })).statusCode).toBe(200);
      const attemptId = randomUUID();
      expect((await workerPost("/claim", w.token, { attemptId, providers: [destination] })).json().job.id).toBe(id);
      const context = await workerPost(`/jobs/${id}/context`, w.token, { attemptId });
      expect(context.json().discussion.previous[0].summary).toBe(`${source} independent proposal.`);
      expect((await workerPost(`/jobs/${id}/complete`, w.token, { attemptId, report })).statusCode).toBe(200);
    }
    const foreign = await project();
    expect((await post(`/v1/operator/projects/${foreign.id}/review-jobs`, operator.cookie, { id: randomUUID(), version: 1, provider: "claude", parentJobId: completed.codex })).json().error.code).toBe("STALE_CONVERSATION");
  });
  it("fences changed inputs and withdrawn consent for every comparison member", async () => {
    const p = await project(), w = await pair(), comparisonId = randomUUID();
    const url = `/v1/operator/projects/${p.id}/review-comparisons`;
    await post(url, operator.cookie, { id: comparisonId, version: 1, provider: "both" });
    const attemptId = randomUUID(), claim = await workerPost("/claim", w.token, { attemptId, providers: ["codex"] }), id = claim.json().job.id;
    expect((await workerPost(`/jobs/${id}/context`, w.token, { attemptId })).statusCode).toBe(200);
    await prisma.projectRequest.create({ data: { projectId: p.id, kind: "FEATURE", title: "Changed", detail: "More scope." } });
    expect((await workerPost(`/jobs/${id}/heartbeat`, w.token, { attemptId })).statusCode).toBe(409);
    expect((await workerPost(`/jobs/${id}/complete`, w.token, { attemptId, report })).statusCode).toBe(409);
    expect((await workerPost("/claim", (await pair()).token, { attemptId: randomUUID(), providers: ["claude"] })).json().job).toBeNull();
    expect((await post(`/v1/projects/${p.id}/ai-review-consent`, customer.cookie, { version: 2, policy: "ai-review-v1", consent: false })).statusCode).toBe(200);
    expect((await prisma.reviewJob.findMany({ where: { comparisonId } })).every(j => j.status === "CANCELLED")).toBe(true);
    const noConsent = await project(false);
    expect((await post(`/v1/operator/projects/${noConsent.id}/review-comparisons`, operator.cookie, { id: randomUUID(), version: 1, provider: "both" })).json().error.code).toBe("AI_CONSENT_REQUIRED");
    const stale = await project();
    expect((await post(`/v1/operator/projects/${stale.id}/review-comparisons`, operator.cookie, { id: randomUUID(), version: 9, provider: "both" })).statusCode).toBe(409);
    expect(await prisma.reviewJob.count({ where: { projectId: stale.id } })).toBe(0);
  });

});
