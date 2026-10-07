import { z } from "zod";
export const deviceUrl = "https://auth.openai.com/codex/device";
export const loginStates = ["QUEUED", "PREPARING", "WAITING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"] as const;
export const loginSchema = z.object({
  id: z.uuid(), status: z.enum(loginStates), expiresAt: z.iso.datetime(),
  attemptId: z.uuid().optional(), url: z.literal(deviceUrl).optional(), code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{5}$/).optional(),
}).strict();
export function loginState(raw: unknown) {
  const value = loginSchema.safeParse(raw);
  if (!value.success) return null;
  if (loginActive(value.data.status) && Date.parse(value.data.expiresAt) <= Date.now()) return { id: value.data.id, status: "EXPIRED" as const, expiresAt: value.data.expiresAt };
  return value.data;
}
export function loginActive(status: string) { return ["QUEUED", "PREPARING", "WAITING"].includes(status); }
export function loginView(raw: unknown) {
  const value = loginState(raw); if (!value) return null;
  const { attemptId: _attempt, ...view } = value; void _attempt;
  return view;
}
