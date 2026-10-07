import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subscriptionEnvironment, subscriptionReady } from "./provider.js";
const verificationUrl = "https://auth.openai.com/codex/device";
export function devicePrompt(output: string): { url: typeof verificationUrl; code: string } | null {
  // Strip terminal styling before extracting only the fixed device prompt.
  // eslint-disable-next-line no-control-regex -- ANSI escape sequences from the official CLI
  const text = output.replace(new RegExp("\\x1b\\[[0-9;]*m", "g"), "");
  if (!text.includes(`${verificationUrl}\n`) && !text.includes(`${verificationUrl}\r\n`)) return null;
  const code = /2\. Enter this one-time code[^\n]*\r?\n\s*([A-Z0-9]{4}-[A-Z0-9]{5})(?:\s|$)/.exec(text)?.[1];
  return code ? { url: verificationUrl, code } : null;
}
export async function deviceLogin(binary: string, signal: AbortSignal, onCode: (value: { url: string; code: string }) => Promise<void>) {
  if (signal.aborted) throw new Error("Sign-in cancelled.");
  const dir = await mkdtemp(join(tmpdir(), "m8-device-login-"));
  try {
    if (signal.aborted) throw new Error("Sign-in cancelled.");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ["-c", 'cli_auth_credentials_store="file"', "-c", `log_dir=${JSON.stringify(dir)}`, "login", "--device-auth"], { cwd: dir, env: subscriptionEnvironment(), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
      let output = "", prompted = false, settled = false;
      let delivery = Promise.resolve();
      const stop = () => { try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* exited */ } };
      const finish = (ok: boolean) => { if (settled) return; settled = true; signal.removeEventListener("abort", cancel); if (ok) resolve(); else reject(new Error("Device sign-in did not complete.")); };
      const cancel = () => { stop(); finish(false); };
      signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
      child.on("error", () => finish(false));
      for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => {
        if (settled || prompted) return;
        output += chunk.toString();
        if (output.length > 16_000) { cancel(); return; }
        const prompt = devicePrompt(output);
        if (prompt) { prompted = true; output = ""; delivery = onCode(prompt).catch(() => { cancel(); }); }
      });
      child.on("close", code => { void delivery.then(() => finish(code === 0 && prompted && !signal.aborted)); });
    });
    await subscriptionReady("codex", binary, signal);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
