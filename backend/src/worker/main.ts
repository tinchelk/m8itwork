import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile, chmod, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { requestSnapshotSchema, providers, type SourceSnapshot, type ReviewProvider } from "../reviews/types.js";
import { ProviderFailure, runReview, subscriptionReady } from "./provider.js";
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
  let attemptId = randomUUID();
  console.log("Review worker running. One review at a time; subscription only. Ctrl+C to stop.");
  try {
    while (!stopping) {
      const available = config.providers.filter(p => (paused.get(p) ?? 0) <= Date.now());
      if (!available.length) { await delay(20_000); continue; }
      try {
        const { job } = z.object({ job: z.object({ id: z.uuid(), attemptId: z.uuid(), provider: providers }).nullable() }).parse(await api("/claim", { attemptId, providers: available }));
        if (stopping) break;
        attemptId = randomUUID();
        if (!job) { if (mode === "once") break; await delay(20_000); continue; }
        current = new AbortController();
        const controller = current;
        const body = { attemptId: job.attemptId }, base = `/jobs/${job.id}`;
        let heartbeatBusy = false, heartbeatFailures = 0;
        const heartbeat = setInterval(() => {
          if (heartbeatBusy) return;
          heartbeatBusy = true;
          void api(`${base}/heartbeat`, body).then(() => { heartbeatFailures = 0; }).catch((error: unknown) => {
            heartbeatFailures++;
            if ((error instanceof WorkerApiError && [401, 409].includes(error.status)) || heartbeatFailures >= 3) controller.abort();
          }).finally(() => { heartbeatBusy = false; });
        }, 20_000);
        console.log(`Review ${job.id}: running with ${job.provider}.`);
        try {
          const raw = z.object({ source: z.object({ repository: z.string(), commit: z.string(), files: z.array(z.object({ path: z.string(), content: z.string() })), coverage: z.object({ readFiles: z.number(), eligibleFiles: z.number(), omittedFiles: z.number(), truncatedFiles: z.number(), limitations: z.array(z.string()) }) }), request: requestSnapshotSchema }).parse(await api(`${base}/context`, body));
          const source: SourceSnapshot = raw.source;
          if (stopping || controller.signal.aborted) break;
          const report = await runReview(job.provider, binary(job.provider), { source, request: raw.request }, controller.signal);
          // A lost upload response retries the SAME attempt. The server accepts one result.
          for (let retry = 0; ; retry++) {
            try { await api(`${base}/complete`, { ...body, report }); break; }
            catch (e) { if (controller.signal.aborted || retry >= 2 || (e instanceof WorkerApiError && e.status < 500)) throw e; await delay(2000); }
          }
          console.log(`Review ${job.id}: private draft ready in backoffice.`);
        } catch (error) {
          const code = error instanceof ProviderFailure ? error.code : error instanceof WorkerApiError && /NO_REVIEW_SOURCE|REPOSITORY_MOVED|EMPTY_REPOSITORY/.test(error.code) ? "SOURCE" : error instanceof WorkerApiError && /GITHUB|REPOSITORY/.test(error.code) ? "CONNECTION" : "NETWORK";
          if (code === "AUTH" || code === "QUOTA") { paused.set(job.provider, Date.now() + 30 * 60_000); console.log(`${job.provider}: paused for 30 minutes (${code}). No API fallback.`); }
          if (!controller.signal.aborted) await api(`${base}/fail`, { ...body, code }).catch(() => { /* lease recovery handles a lost failure upload */ });
          console.log(`Review ${job.id}: stopped (${controller.signal.aborted ? "lease cancelled or worker stopped" : code}).`);
        } finally { clearInterval(heartbeat); current = null; }
        if (mode === "once") break;
      } catch (error) {
        if (stopping) break;
        if (error instanceof WorkerApiError && error.status === 401) { console.log("Worker access revoked. Pair again in backoffice."); break; }
        console.log("Service unavailable; retrying without starting another review.");
        if (mode === "once") throw new Error("Worker could not reach its queue.");
        await delay(20_000);
      }
    }
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); await unlink(lockFile).catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main().catch(() => { console.error("Worker stopped. Check pairing, subscription login and private configuration; no customer data was logged."); process.exitCode = 1; });
