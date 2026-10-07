import { describe, expect, it } from "vitest";
import { eligibleSource, redactSource } from "../src/reviews/source.js";
import { claudeArguments, codexArguments, subscriptionEnvironment } from "../src/worker/provider.js";
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
});
