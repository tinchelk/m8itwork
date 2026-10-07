// Private, per-tab, account/project-scoped recovery. Account logout clears this
// prefix along with other drafts. No credentials or approval decisions belong here.
export interface ReviewQueueRequest { id: string; version: number; provider: string; instructions: string; parentJobId?: string }
export interface ReviewSession { provider: string; parentJobId: string | null; pending: ReviewQueueRequest | null }
export const reviewSessionKey = (accountId: string, projectId: string) => `m8-workspace-draft:${accountId}:review-session:${projectId}`;
export function readReviewSession(key: string): ReviewSession | null {
  try {
    const raw = sessionStorage.getItem(key); if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReviewSession> & { expires?: number };
    const provider = (p: unknown) => p === "codex" || p === "claude";
    const id = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 128;
    if (!value.expires || value.expires < Date.now() || !provider(value.provider) || !(value.parentJobId === null || id(value.parentJobId))) throw new Error("Invalid draft");
    const pending = value.pending;
    if (pending !== null && (!pending || !id(pending.id) || !Number.isInteger(pending.version) || pending.version < 1 || !provider(pending.provider) || typeof pending.instructions !== "string" || pending.instructions.length > 3000 || (pending.parentJobId !== undefined && !id(pending.parentJobId)))) throw new Error("Invalid request");
    return { provider: value.provider!, parentJobId: value.parentJobId!, pending: pending ?? null };
  } catch { try { sessionStorage.removeItem(key); } catch { /* Optional storage. */ } return null; }
}
export function writeReviewSession(key: string, value: ReviewSession) {
  try { sessionStorage.setItem(key, JSON.stringify({ ...value, expires: Date.now() + 60 * 60_000 })); } catch { /* Mounted form remains usable. */ }
}
