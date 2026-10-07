import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile, chmod, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { discussionSchema, providerStatusSchema, requestSnapshotSchema, providers, type SourceSnapshot, type ReviewProvider, type ProviderStatus } from "../reviews/types.js";
import { ProviderFailure, runReview, subscriptionReady } from "./provider.js";
import { deviceLogin } from "./device-login.js";
const configSchema = z.object({
  apiUrl: z.url().refine(s => { const u = new URL(s); return !u.username && !u.password && !u.search && !u.hash && u.pathname === "/" && (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))); }),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  providers: z.array(providers).min(1).max(2).default(["codex"]),
  codexPath: z.string().default("codex"), claudePath: z.string().default("claude"),
}).strict();
const defaultConfigFile = join(homedir(), ".m8itwork", "worker.json");
class WorkerApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
export async function main(args = process.argv.slice(2), configFile = defaultConfigFile) {
  const mode = args[0] ?? "run";
  if (mode === "configure") {
    let input = ""; for await (const chunk of process.stdin) input += String(chunk);
    const config = configSchema.parse(JSON.parse(input) as unknown);
    await mkdir(dirname(configFile), { recursive: true, mode: 0o700 });
    await writeFile(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
    await chmod(configFile, 0o600);
    console.log("Worker paired. Run worker:doctor, then worker:run. Configuration is private."); return;
  }
  if ((await stat(configFile)).mode & 0o077) throw new Error("Worker config must have permissions 600. Run chmod 600 ~/.m8itwork/worker.json.");
  const config = configSchema.parse(JSON.parse(await readFile(configFile, "utf8")) as unknown);
  const binary = (p: ReviewProvider) => p === "codex" ? config.codexPath : config.claudePath;
  if (mode === "doctor") {
    for (const provider of config.providers) { await subscriptionReady(provider, binary(provider)); console.log(`${provider}: subscription authentication available.`); }
    return;
  }
  const lockFile = join(dirname(configFile), "worker.lock");
  try {
    const lock = await open(lockFile, "wx", 0o600); await lock.writeFile(String(process.pid)); await lock.close();
  } catch {
    const pid = Number(await readFile(lockFile, "utf8"));
    try { process.kill(pid, 0); throw new Error("A review worker is already running."); } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "ESRCH")) throw e;
      await unlink(lockFile); return main(args, configFile);
    }
  }
  const shutdown = new AbortController();
  let stopping = false, current: AbortController | null = null;
  const stop = () => { stopping = true; shutdown.abort(); current?.abort(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const wait = (ms: number) => delay(ms, undefined, { signal: shutdown.signal }).catch(() => {});
  async function api(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${config.apiUrl.replace(/\/$/, "")}/v1/review-worker${path}`, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(path.endsWith("context") ? 180_000 : 15_000), ...(current ? [current.signal] : [])]) });
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(await response.json());
      throw new WorkerApiError(response.status, error.success ? error.data.error.code : "NETWORK");
    }
    const text = await response.text(); if (text.length > 600_000) throw new WorkerApiError(413, "INVALID_CONTEXT");
    return JSON.parse(text) as unknown;
  }
  const paused = new Map<ReviewProvider, number>();
  const readiness = new Map<ReviewProvider, ProviderStatus>();
  const cooldownFile = join(dirname(configFile), "provider-cooldown.json");
  try {
    const stored = z.array(providerStatusSchema).parse(JSON.parse(await readFile(cooldownFile, "utf8")) as unknown);
    for (const entry of stored) if (entry.state === "LIMITED" && entry.retryAt && config.providers.includes(entry.provider)) {
      const until = Math.min(new Date(entry.retryAt).getTime(), Date.now() + 30 * 60_000);
      if (until > Date.now()) { paused.set(entry.provider, until); readiness.set(entry.provider, { ...entry, retryAt: new Date(until).toISOString() }); }
    }
  } catch { /* no quota cooldown saved */ }
  let checkedAt = 0;
  async function status() {
    try { await api("/status", { remoteLogin: config.providers.includes("codex"), providers: config.providers.map(provider => readiness.get(provider) ?? { provider, state: "ERROR" }) }); }
    catch (error) { if (error instanceof WorkerApiError && error.status === 401) stop(); /* transient failure is reflected by last-seen expiry */ }
  }
  async function probe() {
    if (Date.now() - checkedAt < 5 * 60_000) return;
    checkedAt = Date.now();
    for (const provider of config.providers) {
      if ((paused.get(provider) ?? 0) > Date.now()) continue;
      try {
        await subscriptionReady(provider, binary(provider), AbortSignal.any([shutdown.signal, AbortSignal.timeout(15_000)]));
        readiness.set(provider, { provider, state: "READY" });
      } catch (error) { readiness.set(provider, { provider, state: error instanceof ProviderFailure && error.code === "AUTH" ? "NEEDS_LOGIN" : "ERROR" }); }
    }
  }
  let loginAttempt = randomUUID();
  async function reconnect() {
    if (!config.providers.includes("codex")) return false;
    const reply = z.object({ login: z.object({ id: z.uuid(), expiresAt: z.iso.datetime() }).nullable() }).parse(await api("/login/claim", { attemptId: loginAttempt }));
    if (!reply.login || stopping || shutdown.signal.aborted) return false;
    const login = reply.login, attemptId = loginAttempt;
    current = new AbortController(); const controller = current;
    const expiry = setTimeout(() => controller.abort(), Math.max(0, Date.parse(login.expiresAt) - Date.now()));
    const base = `/login/${login.id}/update`;
    let failures = 0, heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return; heartbeatBusy = true;
      void api(base, { attemptId, status: "PREPARING" }).then(async () => { failures = 0; await status(); }).catch((error: unknown) => {
        if ((error instanceof WorkerApiError && [401, 409].includes(error.status)) || ++failures >= 3) controller.abort();
      }).finally(() => { heartbeatBusy = false; });
    }, 10_000);
    readiness.set("codex", { provider: "codex", state: "NEEDS_LOGIN" }); await status();
    try {
      if (stopping || controller.signal.aborted || shutdown.signal.aborted) throw new Error("Worker stopped before sign-in.");
      await deviceLogin(binary("codex"), AbortSignal.any([controller.signal, shutdown.signal]), async prompt => {
        // Retry the exact safe prompt; never upload raw CLI output or credentials.
        for (let retry = 0; ; retry++) {
          try { await api(base, { attemptId, status: "WAITING", ...prompt }); break; }
          catch (e) { if (retry >= 2 || (e instanceof WorkerApiError && e.status < 500)) throw e; await wait(1000); }
        }
      });
      await api(base, { attemptId, status: "SUCCEEDED" });
      paused.delete("codex"); readiness.set("codex", { provider: "codex", state: "READY" });
      await writeFile(cooldownFile, JSON.stringify([...readiness.values()].filter(p => p.state === "LIMITED")), { mode: 0o600 });
      console.log("Codex subscription reconnected.");
    } catch {
      if (!controller.signal.aborted && !shutdown.signal.aborted) await api(base, { attemptId, status: "FAILED" }).catch(() => {});
      console.log("Codex reconnect stopped. Check backoffice for the next action.");
    } finally {
      clearTimeout(expiry); clearInterval(heartbeat); current = null; loginAttempt = randomUUID(); checkedAt = 0; await status();
    }
    return true;
  }
  let attemptId = randomUUID();
  console.log("Review worker running. One review at a time; subscription only. Ctrl+C to stop.");
  try {
    while (!stopping) {
      try { if (await reconnect()) { if (mode === "once") break; continue; } }
      catch (e) { if (e instanceof WorkerApiError && e.status === 401) break; if (stopping) break; await wait(20_000); continue; }
      await probe(); if (stopping) break;
      await status(); if (stopping) break;
      const available = config.providers.filter(p => (paused.get(p) ?? 0) <= Date.now() && readiness.get(p)?.state === "READY");
      if (!available.length) { if (mode === "once") break; await wait(20_000); continue; }
      try {
        const { job } = z.object({ job: z.object({ id: z.uuid(), attemptId: z.uuid(), provider: providers }).nullable() }).parse(await api("/claim", { attemptId, providers: available }));
        if (stopping) break;
        attemptId = randomUUID();
        if (!job) { if (mode === "once") break; await wait(20_000); continue; }
        current = new AbortController();
        const controller = current;
        const body = { attemptId: job.attemptId }, base = `/jobs/${job.id}`;
        readiness.set(job.provider, { provider: job.provider, state: "BUSY" });
        await status();
        let eventQueue = Promise.resolve();
        const event = (kind: "SOURCE" | "MODEL" | "MESSAGE" | "RESULT", text: string) => {
          const payload = { ...body, event: { id: randomUUID(), kind, text } };
          eventQueue = eventQueue.then(async () => {
            if (controller.signal.aborted) return;
            try { await api(`${base}/events`, payload); }
            catch (error) { if (error instanceof WorkerApiError && [401, 409].includes(error.status)) controller.abort(); }
          });
          return eventQueue;
        };
        let heartbeatBusy = false, heartbeatFailures = 0;
        const heartbeat = setInterval(() => {
          if (heartbeatBusy) return;
          heartbeatBusy = true;
          void api(`${base}/heartbeat`, body).then(async () => { heartbeatFailures = 0; await status(); }).catch((error: unknown) => {
            heartbeatFailures++;
            if ((error instanceof WorkerApiError && [401, 409].includes(error.status)) || heartbeatFailures >= 3) controller.abort();
          }).finally(() => { heartbeatBusy = false; });
        }, 20_000);
        console.log(`Review ${job.id}: running with ${job.provider}.`);
        try {
          await event("SOURCE", "Fetching a read-only sample of the saved repository commit.");
          const raw = z.object({ source: z.object({ repository: z.string(), commit: z.string(), files: z.array(z.object({ path: z.string(), content: z.string() })), coverage: z.object({ readFiles: z.number(), eligibleFiles: z.number(), omittedFiles: z.number(), truncatedFiles: z.number(), limitations: z.array(z.string()) }) }), request: requestSnapshotSchema, discussion: discussionSchema.optional() }).parse(await api(`${base}/context`, body));
          const source: SourceSnapshot = raw.source;
          if (stopping || controller.signal.aborted) break;
          await event("MODEL", `${source.files.length} files sampled. ${job.provider} is preparing a private reply and effort range.`);
          const report = await runReview(job.provider, binary(job.provider), { source, request: raw.request, ...(raw.discussion ? { discussion: raw.discussion } : {}) }, controller.signal, text => { void event("MESSAGE", text); });
          await eventQueue;
          await event("RESULT", "Reply validated. Uploading the private draft for operator review.");
          // A lost upload response retries the SAME attempt. The server accepts one result.
          for (let retry = 0; ; retry++) {
            try { await api(`${base}/complete`, { ...body, report }); break; }
            catch (e) { if (controller.signal.aborted || retry >= 2 || (e instanceof WorkerApiError && e.status < 500)) throw e; await wait(2000); }
          }
          console.log(`Review ${job.id}: private draft ready in backoffice.`);
        } catch (error) {
          const code = error instanceof ProviderFailure ? error.code : error instanceof WorkerApiError && /NO_REVIEW_SOURCE|REPOSITORY_MOVED|EMPTY_REPOSITORY/.test(error.code) ? "SOURCE" : error instanceof WorkerApiError && /GITHUB|REPOSITORY/.test(error.code) ? "CONNECTION" : "NETWORK";
          if (code === "AUTH" || code === "QUOTA") {
            const until = Date.now() + 30 * 60_000;
            paused.set(job.provider, until); readiness.set(job.provider, { provider: job.provider, state: code === "AUTH" ? "NEEDS_LOGIN" : "LIMITED", retryAt: new Date(until).toISOString() });
            await writeFile(cooldownFile, JSON.stringify([...readiness.values()].filter(p => p.state === "LIMITED")), { mode: 0o600 });
            console.log(`${job.provider}: paused for 30 minutes (${code}). No API fallback.`);
          } else if (["PROVIDER", "INVALID_REPORT", "TIMEOUT"].includes(code)) {
            const until = Date.now() + 5 * 60_000; paused.set(job.provider, until);
            readiness.set(job.provider, { provider: job.provider, state: "ERROR", retryAt: new Date(until).toISOString() });
          }
          if (!controller.signal.aborted) await api(`${base}/fail`, { ...body, code }).catch(() => { /* lease recovery handles a lost failure upload */ });
          console.log(`Review ${job.id}: stopped (${controller.signal.aborted ? "lease cancelled or worker stopped" : code}).`);
        } finally {
          clearInterval(heartbeat); await eventQueue; current = null;
          if (readiness.get(job.provider)?.state === "BUSY") readiness.set(job.provider, { provider: job.provider, state: "READY" });
          checkedAt = 0; await status();
        }
        if (mode === "once") break;
      } catch (error) {
        if (stopping) break;
        if (error instanceof WorkerApiError && error.status === 401) { console.log("Worker access revoked. Pair again in backoffice."); break; }
        console.log("Service unavailable; retrying without starting another review.");
        if (mode === "once") throw new Error("Worker could not reach its queue.");
        await wait(20_000);
      }
    }
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); await unlink(lockFile).catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main().catch(() => { console.error("Worker stopped. Check pairing, subscription login and private configuration; no customer data was logged."); process.exitCode = 1; });
