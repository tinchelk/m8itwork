import { describe, expect, it } from "vitest";
import { encrypt, decrypt } from "../src/crypto.js";
import {
  GitHubClient,
  makeReport,
  parseRepositoryUrl,
} from "../src/github/client.js";

const commit = "a".repeat(40);
const metadata = {
  full_name: "builder/app",
  html_url: "https://github.com/builder/app",
  private: false,
  default_branch: "main",
  language: "TypeScript",
  archived: false,
};
describe("repository inspection", () => {
  it.each([
    "http://github.com/a/b",
    "https://github.com.evil.test/a/b",
    "https://github.com/a/b/tree/main",
    "https://user:token@github.com/a/b",
    "https://github.com/a/b?token=secret",
    "https://github.com/a/..",
    "file:///etc/passwd",
    "https://127.0.0.1/a/b",
  ])("rejects unsupported repository URL %s", (url) => {
    expect(() => parseRepositoryUrl(url)).toThrow();
  });
  it("accepts a clone URL and normalizes its repo name", () => {
    expect(parseRepositoryUrl("https://github.com/builder/app.git")).toEqual({
      owner: "builder",
      repo: "app",
    });
  });
  it("pins file contents to one commit, fetches only bounded manifests, and retains no secrets", async () => {
    const calls: string[] = [];
    const client = new GitHubClient(async (url, options) => {
      const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      calls.push(target);
      expect(options?.method ?? "GET").toBe("GET");
      const path = new URL(target).pathname;
      let data: unknown;
      if (path.endsWith("/branches/main")) data = { commit: { sha: commit } };
      else if (path.includes("/git/trees/"))
        data = {
          truncated: false,
          tree: [
            {
              path: "package.json",
              type: "blob",
              sha: "b".repeat(40),
              size: 90,
            },
            { path: ".env", type: "blob", sha: "c".repeat(40), size: 10 },
            {
              path: "src/checkout.test.ts",
              type: "blob",
              sha: "d".repeat(40),
              size: 80,
            },
          ],
        };
      else if (path.includes("/git/blobs/"))
        data = {
          encoding: "base64",
          content: Buffer.from(
            JSON.stringify({
              dependencies: { next: "16", stripe: "22" },
              scripts: { test: "echo SUPER_SECRET" },
            }),
          ).toString("base64"),
        };
      else data = metadata;
      return Response.json(data);
    });
    const report = await client.inspect(metadata.html_url);
    expect(calls).toHaveLength(4);
    expect(calls[2]).toContain(commit);
    expect(calls.some((url) => url.includes("c".repeat(40)))).toBe(false);
    expect(report.stack).toContain("Next.js");
    expect(
      report.evidence.find((item) => item.title === "Payments and integrations")
        ?.detail,
    ).toContain("still need testing");
    expect(JSON.stringify(report)).not.toContain("SUPER_SECRET");
    expect(report.repairEstimate).toBeNull();
  });
  it("reports partial evidence without claiming that a workflow is broken", () => {
    const report = makeReport({
      metadata,
      commit,
      paths: ["README.md"],
      complete: false,
      packages: [],
      manifestsLimited: false,
    });
    expect(report.limitations[0]).toContain("truncated");
    expect(report.evidence.every((item) => item.kind === "verify")).toBe(true);
    expect(report.assessmentEffort.confidence).toBe("low");
    expect(report.repairEstimate).toBeNull();
  });
  it("makes empty repos and rate limits actionable", async () => {
    await expect(
      new GitHubClient(async () => new Response(null, { status: 409 })).inspect(
        metadata.html_url,
      ),
    ).rejects.toMatchObject({ code: "EMPTY_REPOSITORY" });
    await expect(
      new GitHubClient(async () => new Response(null, { status: 403 })).inspect(
        metadata.html_url,
      ),
    ).rejects.toMatchObject({ code: "GITHUB_LIMIT" });
  });
  it("encrypts tokens and detects tampering", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const stored = encrypt("private-access-token", key);
    expect(stored).not.toContain("private-access-token");
    expect(decrypt(stored, key)).toBe("private-access-token");
    const altered = Buffer.from(stored, "base64");
    altered[20] = altered[20]! ^ 1;
    expect(() => decrypt(altered.toString("base64"), key)).toThrow();
  });
});
