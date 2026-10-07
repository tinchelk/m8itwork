// Runs INSIDE the image against a fabricated localhost API; no customer data.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const mode = process.argv[2];
const home = process.env.HOME;
await mkdir(`${home}/.m8itwork`, { recursive: true, mode: 0o700 });
const jobId = randomUUID(), attemptId = randomUUID(), token = "x".repeat(43);
const report = { summary: "Synthetic reply: require a verified session.", findings: [{ severity: "high", detail: "The fixture always allows access.", evidence: ["src/auth.ts"] }], scope: "Protect the route.", acceptance: "Verify signed-in and signed-out access.", assumptions: "Synthetic sample only.", questions: [], effort: { minHours: 2, maxHours: 4, confidence: "low" } };
await writeFile(`${home}/fixture-codex`, `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv.includes('status')) { console.error('Logged in using ChatGPT'); process.exit(0); }
if (process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN || process.env.M8_WORKER_TOKEN) process.exit(1);
if (!process.argv.includes('forced_login_method="chatgpt"') || !process.argv.includes('--ignore-user-config') || !process.argv.includes('--sandbox')) process.exit(1);
let input=''; for await (const chunk of process.stdin) input+=chunk;
if (!input.includes('Synthetic operator question')) process.exit(1);
fs.writeFileSync(process.env.HOME+'/.model-pid',String(process.pid));
${mode === "long" ? "setInterval(()=>{},1000);" : mode === "quota" ? "console.error('Usage limit reached');process.exit(1);" : `console.log(JSON.stringify({type:'item.completed',item:{type:'reasoning',text:'hidden-fixture-reasoning'}}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Synthetic visible decision: verify a session.'}}));
fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],${JSON.stringify(JSON.stringify(report))});`}
`, { mode: 0o700 });
// This PID is alive in the container; startup must clear it under kernel locking.
await writeFile(`${home}/.m8itwork/worker.lock`, "2", { mode: 0o600 });
let uploaded = false, claimed = false, interrupted = false;
const messages = [], statuses = [];
const server = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, `Bearer ${token}`);
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  let reply = { saved: true };
  if (req.url.endsWith("/status")) statuses.push(...body.providers);
  else if (req.url.endsWith("/claim")) { claimed = true; console.log("Fixture worker ready."); reply = { job: mode === "empty" || mode === "idle" ? null : { id: jobId, attemptId, provider: "codex" } }; }
  else if (req.url.endsWith("/context")) reply = { source: { repository: "synthetic/app", commit: "a".repeat(40), files: [{ path: "src/auth.ts", content: "export const allow = () => true;" }], coverage: { readFiles: 1, eligibleFiles: 1, omittedFiles: 0, truncatedFiles: 0, limitations: ["Synthetic source only."] } }, request: { summary: "Protect the synthetic route.", requests: [] }, discussion: { instructions: "Synthetic operator question: how should we verify access?", previous: [] } };
  else if (req.url.endsWith("/events")) messages.push(body.event);
  else if (req.url.endsWith("/complete")) { assert.deepEqual(body.report, report); uploaded = true; }
  else if (!req.url.endsWith("/heartbeat") && !req.url.endsWith("/fail")) throw new Error("Unexpected fixture endpoint");
  res.setHeader("content-type", "application/json"); res.end(JSON.stringify(reply));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const config = { apiUrl: `http://127.0.0.1:${server.address().port}/`, token, providers: [mode === "unauth-claude" ? "claude" : "codex"], codexPath: mode === "unauth" ? "codex" : mode === "broken" ? "/missing-provider" : `${home}/fixture-codex` };
await writeFile(`${home}/.m8itwork/worker.json`, JSON.stringify(config), { mode: 0o600 });
const child = spawn("/app/entrypoint.sh", [mode === "idle" || mode === "long" ? "run" : "once"], { stdio: "inherit", env: { ...process.env, OPENAI_API_KEY: "synthetic-billing-key", GITHUB_TOKEN: "synthetic-github-key", M8_WORKER_TOKEN: token } });
process.on("SIGTERM", () => { interrupted = true; child.kill("SIGTERM"); });
const exit = await new Promise(resolve => child.on("exit", resolve));
await new Promise(resolve => server.close(resolve));
assert.equal(exit, 0);
if (mode === "review") { assert.equal(uploaded, true); assert.ok(messages.some(e => e.kind === "MESSAGE" && e.text.includes("Synthetic visible decision"))); assert.ok(!JSON.stringify(messages).includes("hidden-fixture-reasoning")); console.log("Synthetic queue, visible activity and validated private reply passed."); }
if (mode === "unauth" || mode === "unauth-claude") { assert.equal(claimed, false); assert.ok(statuses.some(s => s.state === "NEEDS_LOGIN")); console.log("Unauthenticated subscription reported without claiming a job."); }
if (mode === "long") { assert.equal(interrupted, true); const pid = Number(await readFile(`${home}/.model-pid`, "utf8")); assert.throws(() => process.kill(pid, 0)); console.log("Active provider process stopped cleanly."); }
if (mode === "empty") console.log("Stale PID recovery passed.");

if (mode === "broken") { assert.equal(claimed, false); assert.ok(statuses.some(s => s.state === "ERROR")); console.log("Provider error reported without claiming a job."); }
if (mode === "quota") { assert.equal(uploaded, false); assert.ok(statuses.some(s => s.state === "LIMITED" && s.retryAt)); assert.ok(JSON.parse(await readFile(`${home}/.m8itwork/provider-cooldown.json`, "utf8")).some(s => s.state === "LIMITED")); console.log("Quota cooldown recorded privately."); }
if (mode === "cooldown") { assert.equal(claimed, false); assert.ok(statuses.some(s => s.state === "LIMITED")); console.log("Quota cooldown survives container recreation."); }
