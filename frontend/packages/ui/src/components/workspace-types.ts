export interface Account {
  id: string;
  githubLogin: string | null;
  email?: string | null;
  emailVerified?: boolean;
  googleConnected?: boolean;
  displayName: string | null;
  isOperator: boolean;
}
export interface Auth {
  account: Account | null;
  connectEnabled: boolean;
  emailEnabled?: boolean;
  googleEnabled?: boolean;
}
export interface ProjectListItem {
  id: string;
  name: string;
  stage: string;
  updatedAt: string;
  repositoryUrl: string | null;
  account?: { githubLogin: string | null; displayName?: string | null };
  customerLastMessageAt?: string | null;
  teamLastMessageAt?: string | null;
  customerReadAt?: string | null;
  teamReadAt?: string | null;
  proposals?: Pick<Proposal, "id" | "amountCents" | "currency" | "approvedAt" | "milestones">[];
  currentProposalId?: string | null;
  billingMode?: "test" | "live" | "unconfigured";
}
export interface PaymentMilestone {
  id: string;
  position: number;
  label: string;
  amountCents: number;
  dueWhen: "BEFORE_BUILD" | "BEFORE_VERIFY" | "BEFORE_HANDOVER";
  releasedAt: string | null;
  paidAt: string | null;
  paidCents: number;
  refundedCents: number;
  disputed: boolean;
  attempts?: { mode: string; status: string }[];
}
export interface Message {
  id: string;
  authorRole: "TEAM" | "CUSTOMER";
  authorName: string;
  body: string;
  createdAt: string;
}
export interface WorkItem {
  id: string;
  title: string;
  detail: string;
  status: "TODO" | "DOING" | "BLOCKED" | "DONE";
  evidence: string | null;
  evidenceUrl: string | null;
}
export interface Proposal {
  id: string;
  version: number;
  scope: string;
  acceptance: string;
  amountCents: number;
  currency: string;
  deliveryDate: string;
  assumptions: string;
  approvedAt: string | null;
  milestones?: PaymentMilestone[];
}
export interface Inventory {
  id?: string;
  repository: string;
  url: string;
  commit: string;
  branch: string;
  stack: string[];
  fileCount: number;
  complete: boolean;
  limitations: string[];
}
export interface Project extends ProjectListItem {
  accountClosedAt?: string | null;
  aiReviewConsentAt?: string | null;
  aiReviewConsentVersion?: string | null;
  version: number;
  summary: string;
  platform: string;
  contactEmail: string;
  demoUrl: string | null;
  accessNote: string | null;
  reviewSummary: string | null;
  verificationSummary: string | null;
  inspectionReport: Inventory | null;
  currentProposalId: string | null;
  billing?: { enabled: boolean; mode: "test" | "live" | "unconfigured" };
  workItems?: WorkItem[];
  notes?: { id: string; body: string; authorName: string; createdAt: string }[];
  requests: {
    id: string;
    kind: string;
    title: string;
    detail: string;
    referenceUrl: string | null;
    createdAt: string;
  }[];
  proposals: Proposal[];
  updates: {
    id: string;
    author: string;
    title: string;
    detail: string;
    createdAt: string;
  }[];
}
export interface Connection {
  connectEnabled: boolean;
  githubLogin: string | null;
  installUrl: string | null;
  repositories: { name: string; url: string; private: boolean }[];
  connectionError: string | null;
  truncated: boolean;
}
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3121";
export const CUSTOMER_ORIGIN = process.env.NEXT_PUBLIC_CUSTOMER_ORIGIN ?? "http://localhost:3120";
export const ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_ORIGIN ?? "http://localhost:3123";
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new WorkspaceError(
      "We couldn't reach the workspace. Your input is still here; please try again.",
      0,
    );
  }
  const data = (await response.json()) as T & { error?: { message?: string; code?: string } };
  if (!response.ok)
    throw new WorkspaceError(
      data.error?.message ??
        "We couldn't complete this request. Please try again.",
      response.status,
      data.error?.code,
    );
  return data;
}
export const stageLabels: Record<string, string> = {
  DRAFT: "Getting started",
  IN_REVIEW: "In review",
  AWAITING_APPROVAL: "Proposal ready",
  APPROVED: "Scope approved",
  BUILDING: "Building",
  VERIFYING: "Verifying",
  COMPLETE: "Complete",
  CLOSED: "Closed",
};
export function displayDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
export function money(proposal: Pick<Proposal, "currency" | "amountCents">) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: proposal.currency,
  }).format(proposal.amountCents / 100);
}
