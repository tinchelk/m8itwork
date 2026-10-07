import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { parseRepositoryUrl } from "../github/client.js";
import { AppError } from "../shared/errors.js";
import type { SourceSnapshot } from "./types.js";

export function eligibleSource(path: string) {
  return path.length <= 300 && !path.split("/").some(p => !p || p === "." || p === "..") &&
    !/(^|\/)(\.|node_modules|vendor|dist|build|coverage|fixtures|test-results|uploads|data|logs|config|configuration|environments|deploy|infra)/i.test(path) &&
    !/(^|\/)(agents|claude|gemini)\.md$/i.test(path) &&
    !/(^|\/)(?:appsettings|settings|environment|firebase|google-services|service-account|tsconfig|next\.config|vite\.config)(?:[._-]|$)/i.test(path) &&
    !/(secret|credential|private.?key|password|token|\.lock$|lock\.json$|lock\.ya?ml$|\.min\.)/i.test(path) &&
    /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|cs|php|rb|vue|svelte|sql|graphql|prisma|json|md|ya?ml|html|css)$/i.test(path);
}
export function redactSource(content: string) {
  return content
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED CREDENTIAL]")
    .replace(/((?:[A-Za-z0-9_-]*(?:api[_-]?key|secret|password|access[_-]?token))["']?\s*[=:]\s*)["'`][^"'`\r\n]*["'`]/gi, '$1"[REDACTED]"')
    .replace(/((?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*)(?!["'`])[^\s,;}]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>/]+@[^\s"'`<>]+/g, "[REDACTED URL WITH CREDENTIALS]");
}
export async function sourceSnapshot(github: GitHubClient, url: string, commit: string, token: string, validate?: () => Promise<unknown>): Promise<SourceSnapshot> {
  z.string().regex(/^[a-f0-9]{40}$/).parse(commit);
  const { owner, repo } = parseRepositoryUrl(url);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  await validate?.();
  const metadata = z.object({ full_name: z.string(), html_url: z.url() }).parse(await github.api(base, token));
  if (metadata.full_name.toLowerCase() !== `${owner}/${repo}`.toLowerCase())
    throw new AppError(409, "REPOSITORY_MOVED", "The repository changed. Reconnect and start a fresh review.");
  await validate?.();
  const tree = z.object({ truncated: z.boolean(), tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string().regex(/^[a-f0-9]{40}$/), size: z.number().optional() })) })
    .parse(await github.api(`${base}/git/trees/${commit}?recursive=1`, token));
  const eligible = tree.tree.slice(0, 3000).filter(e => e.type === "blob" && eligibleSource(e.path) && (e.size ?? Infinity) <= 64_000);
  // Review a bounded sample of architecture, workflows and tests, not the entire repository.
  const ranked = [...eligible].sort((a, b) => {
    const score = (p: string) => /(^|\/)(package\.json|schema\.prisma|README\.md)$/i.test(p) ? 0 : /(auth|payment|route|api|test|spec)/i.test(p) ? 1 : 2;
    return score(a.path) - score(b.path) || a.path.localeCompare(b.path);
  }).slice(0, 40);
  const files: SourceSnapshot["files"] = [];
  let bytes = 0, truncatedFiles = 0;
  for (const entry of ranked) {
    if (bytes >= 180_000) break;
    await validate?.();
    const blob = z.object({ encoding: z.literal("base64"), content: z.string().max(100_000) }).parse(await github.api(`${base}/git/blobs/${entry.sha}`, token));
    const decoded = Buffer.from(blob.content.replace(/\n/g, ""), "base64");
    if (decoded.includes(0)) continue;
    const safe = Buffer.from(redactSource(decoded.toString("utf8")));
    const limited = safe.subarray(0, Math.min(12_000, 180_000 - bytes));
    if (limited.length < safe.length) truncatedFiles++;
    const content = redactSource(limited.toString("utf8"));
    bytes += limited.length;
    files.push({ path: entry.path, content });
  }
  if (!files.length) throw new AppError(422, "NO_REVIEW_SOURCE", "No eligible source was found. Review this project manually.");
  return { repository: metadata.full_name, commit, files, coverage: {
    readFiles: files.length, eligibleFiles: eligible.length, omittedFiles: Math.max(0, eligible.length - files.length), truncatedFiles,
    limitations: ["Static sample only. No code, dependencies, tests or demos were executed.", "Recognizable secrets and sensitive/instruction files are excluded; do not treat this as a complete security audit.",
      ...(tree.truncated || tree.tree.length > 3000 ? ["The repository tree is incomplete or exceeds the file limit."] : []),
      ...(eligible.length > files.length ? ["Additional source files were omitted from the bounded review sample."] : []),
      ...(truncatedFiles ? ["Some source files were shortened; findings may need more evidence."] : [])],
  } };
}
