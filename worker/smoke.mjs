import { runReview } from "./dist/worker/provider.js";

const provider = process.argv[2] ?? "codex";
if (!["codex", "claude"].includes(provider)) {
  console.error("Choose codex or claude for the synthetic smoke.");
  process.exitCode = 64;
} else {
  try {
    const report = await runReview(provider, provider, {
      source: {
        repository: "synthetic/login-demo", commit: "a".repeat(40),
        files: [{ path: "src/auth.ts", content: "export function canAccess(user) { return true; } // Synthetic fixture: missing session check." }],
        coverage: { readFiles: 1, eligibleFiles: 1, omittedFiles: 0, truncatedFiles: 0, limitations: ["Synthetic fixture only. No code or tests executed."] },
      },
      request: { summary: "Protect access to my dashboard. Suggest a focused scope, checks and an effort range.", requests: [] },
    });
    console.log(JSON.stringify({ provider, synthetic: true, validated: true, findings: report.findings.length, effort: report.effort }));
  } catch {
    console.error("Synthetic review failed. Check subscription login, allowance and network access; no API fallback.");
    process.exitCode = 1;
  }
}
