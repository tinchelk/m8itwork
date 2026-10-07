import { describe, expect, it } from "vitest";
import { eligibleSource, redactSource } from "../src/reviews/source.js";
import { claudeArguments, codexArguments, subscriptionEnvironment, visibleMessage } from "../src/worker/provider.js";
import { devicePrompt } from "../src/worker/device-login.js";
describe("subscription review boundaries", () => {
  it("excludes secrets, instructions, artifacts and traversal paths", () => {
    for (const path of [".env", ".github/workflows/build.yml", "AGENTS.md", "CLAUDE.md", "src/credentials.json", "node_modules/x.ts", "data/customers.json", "../auth.ts", "/absolute.ts", "package-lock.json", "config/production.json", "appsettings.Production.json", "src/environments/environment.prod.ts"]) expect(eligibleSource(path), path).toBe(false);
    for (const path of ["src/auth.ts", "package.json", "prisma/schema.prisma", "tests/login.test.ts"]) expect(eligibleSource(path), path).toBe(true);
    const secret = "ghp_" + "A".repeat(30); expect(redactSource(secret)).not.toContain(secret);
    expect(redactSource('{"password":"synthetic-password-123","api_key":"re_synthetic_example123"}')).not.toContain("synthetic");
    expect(redactSource('const db = "postgresql://user:synthetic-password@host/db"')).not.toContain("synthetic-password");
    expect(redactSource("password: synthetic-password-123")).not.toContain("synthetic-password");
    expect(redactSource("-----BEGIN PRIVATE KEY-----\nabc\n")).not.toContain("abc");
  });
  it("does not inherit billing, routing, worker, repo or injected runtime credentials", () => {
    const env = subscriptionEnvironment({ HOME: "/fixture", PATH: "/usr/bin", OPENAI_API_KEY: "no", ANTHROPIC_API_KEY: "no", M8_WORKER_TOKEN: "no", GITHUB_TOKEN: "no", ANTHROPIC_BASE_URL: "no", NODE_OPTIONS: "no", CLAUDE_CODE_USE_BEDROCK: "1" });
    expect(env).toEqual({ HOME: "/fixture", PATH: "/usr/bin" });
  });
  it("disables tools/customizations and requires subscription authentication", () => {
    const codex = codexArguments("/tmp/fixture"); expect(codex).toContain("forced_login_method=\"chatgpt\""); expect(codex).toContain("--ignore-user-config"); expect(codex).toContain("--ephemeral"); expect(codex).toContain("shell_tool"); expect(codex).toContain("plugins"); expect(codex).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    const claude = claudeArguments("{}"); expect(claude).toContain("--safe-mode"); expect(claude[claude.indexOf("--tools") + 1]).toBe(""); expect(claude).not.toContain("--bare"); expect(claude).toContain("--no-session-persistence");
  });
  it("reports only visible agent messages and redacts recognizable credentials", () => {
    expect(visibleMessage(JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "private analysis" } }))).toBeNull();
    expect(visibleMessage(JSON.stringify({ type: "item.completed", item: { type: "command_execution", text: "secret command" } }))).toBeNull();
    const text = visibleMessage(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: `Ready. Authorization: Bearer ${"x".repeat(43)}` } }));
    expect(text).toContain("Ready."); expect(text).not.toContain("x".repeat(43));
    expect(visibleMessage("malformed transcript")).toBeNull();
  });
  it("extracts only an official device prompt, never generic URLs or credentials", () => {
    const prompt = "1. Open this link\n   https://auth.openai.com/codex/device\n2. Enter this one-time code (expires in 15 minutes)\n   ABCD-EF123\n";
    expect(devicePrompt(prompt)).toEqual({ url: "https://auth.openai.com/codex/device", code: "ABCD-EF123" });
    expect(devicePrompt(prompt.replace("https://auth.openai.com/codex/device", "https://auth.openai.com/codex/device/evil"))).toBeNull();
    expect(devicePrompt(prompt.replace("ABCD-EF123", "access-token-secret"))).toBeNull();
    expect(devicePrompt("https://auth.openai.com/codex/device\nAuthorization: Bearer ABCD-EF123")).toBeNull();
  });

});
