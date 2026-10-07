import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { encrypt, hash, secret } from "../src/crypto.js";
import { pairWorker } from "../src/reviews/routes.js";
import { main } from "../src/worker/main.js";
const dbUrl = process.env.TEST_DATABASE_URL;
if (!dbUrl || !new URL(dbUrl).pathname.endsWith("/m8itwork_test")) throw new Error("Dedicated test DB required.");
const prisma = new PrismaClient({ datasourceUrl: dbUrl });
const githubId = String(8_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: dbUrl, OPERATOR_GITHUB_IDS: githubId, TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString("base64") });
const dir = await mkdtemp(join(tmpdir(), "m8-pipeline-"));
const account = await prisma.account.create({ data: { githubId } });
const loginRaw = secret(), loginId = hash(loginRaw), connectionId = hash(secret());
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  await prisma.accountSession.create({ data: { id: loginId, accountId: account.id, expiresAt: new Date(Date.now() + 600_000) } });
  await prisma.reviewSession.create({ data: { id: connectionId, accountSessionId: loginId, expiresAt: new Date(Date.now() + 600_000), tokenExpiresAt: new Date(Date.now() + 600_000), tokenEncrypted: encrypt("synthetic-only-access", env.TOKEN_ENCRYPTION_KEY) } });
  const project = await prisma.project.create({ data: { accountId: account.id, name: "Synthetic smoke", contactEmail: "fixture@example.invalid", platform: "GitHub", summary: "Protect dashboard access with a verified session flow.", repositoryUrl: "https://github.com/synthetic/app", inspectionReport: { commit: "a".repeat(40) }, aiReviewConsentAt: new Date(), aiReviewConsentVersion: "ai-review-v1", stage: "IN_REVIEW" } });
  app = await buildApp({ env, prisma, logger: false, rateLimiting: false, fetcher: async url => {
    const path = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname;
    if (path.endsWith("/app")) return Response.json({ full_name: "synthetic/app", html_url: "https://github.com/synthetic/app" });
    if (path.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ path: "src/auth.ts", type: "blob", sha: "b".repeat(40), size: 100 }] });
    if (path.includes("/git/blobs/")) return Response.json({ encoding: "base64", content: Buffer.from("export function allow(user: unknown) { return true; } // Synthetic fixture, deliberately missing access checks.").toString("base64") });
    throw new Error("Unexpected fixture source call.");
  } });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const paired = await pairWorker(prisma, env, githubId, "Synthetic smoke");
  const id = randomUUID();
  const queued = await app.inject({ method: "POST", url: `/v1/operator/projects/${project.id}/review-jobs`, headers: { cookie: `m8_account_session=${loginRaw}`, origin: env.ADMIN_ORIGIN }, payload: { id, version: 1, provider: "codex" } });
  if (queued.statusCode !== 200) throw new Error("Synthetic queue failed.");
  const path = join(dir, "worker.json"); await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify({ apiUrl: `${address}/`, token: paired.token, providers: ["codex"], codexPath: process.argv[2] ?? "codex" }), { mode: 0o600 });
  await main(["once"], path);
  const result = await prisma.reviewJob.findUniqueOrThrow({ where: { id } });
  if (result.status !== "SUCCEEDED" || !result.result) throw new Error(`Pipeline failed: ${result.errorCode ?? result.status}`);
  console.log("Synthetic end-to-end queue → local subscription → private draft passed. Nothing published.");
} finally {
  await prisma.reviewSession.deleteMany({ where: { id: connectionId } });
  await prisma.account.delete({ where: { id: account.id } });
  if (app) await app.close(); else await prisma.$disconnect();
  await rm(dir, { recursive: true, force: true });
}
