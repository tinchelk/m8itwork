import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/worker/provider.js", () => ({ runReview: vi.fn(), subscriptionReady: vi.fn(), ProviderFailure: class extends Error {} }));
vi.mock("../src/worker/device-login.js", () => ({ deviceLogin: vi.fn() }));
import { deviceLogin } from "../src/worker/device-login.js";
import { runReview } from "../src/worker/provider.js";
import { main } from "../src/worker/main.js";
describe("worker shutdown", () => {
  it("does not launch a provider when shutdown arrives during a delayed claim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m8-stop-"));
    try {
      const config = join(dir, "worker.json");
      await writeFile(config, JSON.stringify({ apiUrl: "http://127.0.0.1:3139/", token: "x".repeat(43), providers: ["codex"] }), { mode: 0o600 });
      const paths: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        paths.push(url);
        if (url.endsWith("/login/claim")) return Response.json({ login: null });
        if (url.endsWith("/status")) return Response.json({ saved: true });
        process.emit("SIGTERM");
        return Response.json({ job: { id: randomUUID(), attemptId: randomUUID(), provider: "codex" } });
      }));
      await main(["once"], config);
      expect(paths.filter(p => p.endsWith("/claim") && !p.endsWith("/login/claim"))).toHaveLength(1); expect(runReview).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); await rm(dir, { recursive: true, force: true }); }
  });
  it("does not launch device login when shutdown arrives during its claim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m8-login-stop-"));
    try {
      const config = join(dir, "worker.json");
      await writeFile(config, JSON.stringify({ apiUrl: "http://127.0.0.1:3139/", token: "x".repeat(43), providers: ["codex"] }), { mode: 0o600 });
      vi.stubGlobal("fetch", vi.fn(async () => { process.emit("SIGTERM"); return Response.json({ login: { id: randomUUID(), expiresAt: new Date(Date.now()+600_000).toISOString() } }); }));
      await main(["once"], config);
      expect(deviceLogin).not.toHaveBeenCalled(); expect(runReview).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); await rm(dir, { recursive: true, force: true }); }
  });

});
