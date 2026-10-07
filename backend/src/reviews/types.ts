import { z } from "zod";
import { hash } from "../crypto.js";

export const REVIEW_POLICY = "ai-review-v1";
export const providers = z.enum(["codex", "claude"]);
export type ReviewProvider = z.infer<typeof providers>;
const text = (max: number) => z.string().trim().min(1).max(max);
export const reportSchema = z.object({
  summary: text(3000),
  findings: z.array(z.object({
    severity: z.enum(["high", "medium", "low", "info"]),
    detail: text(1000),
    evidence: z.array(text(300)).max(5),
  }).strict()).max(12),
  scope: text(4000),
  acceptance: text(2500),
  assumptions: text(1800),
  questions: z.array(text(500)).max(8),
  effort: z.object({
    minHours: z.number().int().min(1).max(2000),
    maxHours: z.number().int().min(1).max(2000),
    confidence: z.enum(["low", "medium", "high"]),
  }).strict(),
}).strict().refine(r => r.effort.maxHours >= r.effort.minHours, "Invalid effort range");
export type ReviewReport = z.infer<typeof reportSchema>;
export const requestSnapshotSchema = z.object({
  summary: text(5000),
  requests: z.array(z.object({
    id: z.uuid(), kind: text(30), title: text(160), detail: text(20_000),
  })).max(100),
});
export type RequestSnapshot = z.infer<typeof requestSnapshotSchema>;
export const inputDigest = (input: RequestSnapshot, repositoryUrl: string | null, commit: string | null) => hash(JSON.stringify([input, repositoryUrl, commit]));
export const failureCodes = z.enum(["QUOTA", "AUTH", "PROVIDER", "INVALID_REPORT", "CONNECTION", "SOURCE", "NETWORK", "TIMEOUT"]);
export const failureMessages: Record<z.infer<typeof failureCodes>, string> = {
  QUOTA: "Subscription usage limit reached. Retry after the provider allowance resets.",
  AUTH: "The worker needs to sign in to its coding-agent subscription again.",
  PROVIDER: "The coding agent could not complete this review. Check the local worker, then retry.",
  INVALID_REPORT: "The result did not pass validation. Retry or review this project manually.",
  CONNECTION: "The customer needs to reconnect GitHub before source can be reviewed.",
  SOURCE: "No eligible source is available. Review manually or arrange a fresh repository submission.",
  NETWORK: "The worker could not reach the service. Retry when the connection returns.",
  TIMEOUT: "The review exceeded its time limit. Retry or narrow the review scope.",
};
export interface SourceSnapshot {
  repository: string;
  commit: string;
  files: { path: string; content: string }[];
  coverage: { readFiles: number; eligibleFiles: number; omittedFiles: number; truncatedFiles: number; limitations: string[] };
}
