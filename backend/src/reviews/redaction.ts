export function redactText(content: string) {
  return content
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED CREDENTIAL]")
    .replace(/\bBearer\s+[A-Za-z0-9_.-]{16,}/gi, "Bearer [REDACTED]")
    .replace(/((?:[A-Za-z0-9_-]*(?:api[_-]?key|secret|password|token|authorization))["']?\s*[=:]\s*)["'`][^"'`\r\n]*["'`]/gi, '$1"[REDACTED]"')
    .replace(/((?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token|worker[_-]?token)\s*[:=]\s*)(?!["'`])[^\s,;}]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>/]+@[^\s"'`<>]+/g, "[REDACTED URL WITH CREDENTIALS]");
}
