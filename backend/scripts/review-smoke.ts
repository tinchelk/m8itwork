import { runReview } from "../src/worker/provider.js";
const provider = process.argv[2] === "claude" ? "claude" : "codex";
const binary = process.argv[3] ?? provider;
const result = await runReview(provider, binary, {
  source: { repository: "synthetic/login-demo", commit: "a".repeat(40), files: [
    { path: "src/auth.ts", content: "export function canAccess(user: {id: string} | null) { return true; }\n// Fixture only. This deliberately lacks an auth check." },
    { path: "package.json", content: '{"name":"synthetic-review-only","scripts":{},"dependencies":{}}' },
  ], coverage: { readFiles: 2, eligibleFiles: 2, omittedFiles: 0, truncatedFiles: 0, limitations: ["Synthetic fixture; no customer code.", "No code or tests executed."] } },
  request: { summary: "Protect access to my dashboard. Suggest a small verified scope and an effort range.", requests: [] },
});
console.log(JSON.stringify({ provider, validated: true, findings: result.findings.length, effort: result.effort, synthetic: true }));
