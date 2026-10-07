import { expect, type Page } from "@playwright/test";
import type {
  Project,
  Auth,
  Connection,
  Message,
  PaymentMilestone,
} from "../../packages/ui/src/components/workspace-types";
const id = "8b3f8de8-5118-4a54-8506-78372585f401";
const proposalId = "8b3f8de8-5118-4a54-8506-78372585f402";
export function fixture(): Project {
  return {
    id,
    name: "Bloom bookings",
    stage: "DRAFT",
    version: 1,
    summary:
      "Add recurring bookings and make checkout work smoothly for customers.",
    platform: "Lovable",
    contactEmail: "builder@example.invalid",
    demoUrl: null,
    accessNote: null,
    repositoryUrl: null,
    inspectionReport: null,
    reviewSummary: null,
    verificationSummary: null,
    currentProposalId: null,
    requests: [],
    workItems: [],
    notes: [],
    billing: { enabled: true, mode: "test" },
    account: { githubLogin: "builder" },
    proposals: [],
    updatedAt: new Date().toISOString(),
    updates: [
      {
        id: "initial",
        author: "CUSTOMER",
        title: "Project started",
        detail: "Ready to share our next chapter.",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}
export async function mockWorkspace(
  page: Page,
  options: {
    operator?: boolean;
    signedOut?: boolean;
    configured?: boolean;
    empty?: boolean;
    emailOnly?: boolean;
  } = {},
) {
  const state = {
    project: fixture(),
    empty: options.empty ?? false,
    operator: options.operator ?? false,
    operatorRequests: 0,
    failList: false,
    messages: [] as Message[],
    failMessage: false,
    loseMessageResponse: false,
    readMessageIds: [] as string[],
    syncCalls: 0,
    failCheckout: false,
    failRequest: false,
    expireRequest: false,
    accountId: "customer",
    staleApproval: false,
    requestCalls: 0,
    signedOut: options.signedOut ?? false,
    connection: null as Connection | null,
    failInspection: false,
    expireInspection: false,
    failCreate: false,
    loseCreateResponse: false,
    creationCalls: 0,
    inspectionCalls: 0,
  };
  const auth: Auth = {
    connectEnabled: options.configured ?? true,
    account: {
      id: "customer",
      githubLogin: options.emailOnly ? null : "builder",
      email: options.emailOnly ? "builder@example.invalid" : null,
      displayName: "Builder",
      isOperator: options.operator ?? false,
    },
  };
  const connection: Connection = {
    connectEnabled: true,
    githubLogin: options.emailOnly ? null : "builder",
    installUrl: "https://github.com/apps/m8itwork-review/installations/new",
    repositories: [
      {
        name: "builder/private-app",
        url: "https://github.com/builder/private-app",
        private: true,
      },
    ],
    connectionError: null,
    truncated: false,
  };
  state.connection = connection;
  await page.route("http://localhost:3121/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.includes("/operator/")) state.operatorRequests++;
    const body =
      method === "POST"
        ? (route.request().postDataJSON() as Record<string, unknown>)
        : {};
    const send = (json: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", json });
    if (path === "/v1/auth/session")
      return send({
        ...auth,
        account: state.signedOut
          ? null
          : {
              ...auth.account,
              id: state.accountId,
              isOperator: state.operator,
            },
      });
    if (path === "/v1/auth/logout") {
      state.signedOut = true;
      return send({ signedOut: true });
    }
    if (path === "/v1/operator/operations") return send({ paymentEvents: [], emailEvents: [], workers: [], failedJobs: [], processing: "Retries run every minute." });
    if (path === "/v1/auth/notifications") return send({ enabled: true, email: "builder@example.invalid", verified: true, projectUpdates: true, operatorAlerts: state.operator ? true : null });
    if (path === "/v1/operator/review-workers") return send({ workers: [] });
    if (path.endsWith("/review-jobs")) return send({ jobs: [], onlineWorkers: 0 });
    if (path.endsWith("/ai-review-consent")) {
      state.project.aiReviewConsentAt = body.consent ? new Date().toISOString() : null;
      state.project.version++;
      return send({ saved: true });
    }
    if (path === "/v1/session") return send(state.connection);
    if (path.endsWith("/messages") && method === "GET") {
      const before = new URL(route.request().url()).searchParams.get("before");
      const end = before
        ? state.messages.findIndex((m) => m.id === before)
        : state.messages.length;
      const start = Math.max(0, end - 50);
      return send({
        messages: state.messages.slice(start, end),
        olderCursor: start > 0 ? state.messages[start]!.id : null,
      });
    }
    if (path.endsWith("/messages") && method === "POST") {
      if (state.failMessage) {
        state.failMessage = false;
        return send(
          { error: { message: "Message wasn’t saved. Please try again." } },
          500,
        );
      }
      const prior = state.messages.find((m) => m.id === body.id);
      if (prior)
        return prior.body === body.body
          ? send({ id: prior.id }, 201)
          : send(
              {
                error: {
                  message: "Message ID conflict. Refresh conversation.",
                },
              },
              409,
            );
      state.messages.push({
        id: body.id as string,
        body: body.body as string,
        authorRole: state.operator ? "TEAM" : "CUSTOMER",
        authorName: state.operator ? "team" : "builder",
        createdAt: new Date().toISOString(),
      });
      if (state.operator)
        state.project.teamLastMessageAt = new Date().toISOString();
      else state.project.customerLastMessageAt = new Date().toISOString();
      if (state.loseMessageResponse) {
        state.loseMessageResponse = false;
        return route.abort("connectionreset");
      }
      return send({ id: body.id }, 201);
    }
    if (path.endsWith("/messages/read")) {
      state.readMessageIds.push(body.messageId as string);
      if (state.operator) state.project.teamReadAt = new Date().toISOString();
      else state.project.customerReadAt = new Date().toISOString();
      return send({ read: true });
    }
    if (path === "/v1/github/inspect") {
      state.inspectionCalls++;
      if (state.expireInspection) {
        state.expireInspection = false;
        return send({ error: { code: "GITHUB_RECONNECT", message: "Your GitHub connection expired. Please reconnect." } }, 401);
      }
      if (state.failInspection) {
        state.failInspection = false;
        return send({ error: { message: "Repository couldn't be checked. Please reconnect GitHub and try again." } }, 502);
      }
      return send({
        id: "8b3f8de8-5118-4a54-8506-78372585f403",
        repository: "builder/private-app",
        url: connection.repositories[0]!.url,
        commit: "a".repeat(40),
        branch: "main",
        stack: ["Next.js", "PostgreSQL"],
        fileCount: 42,
        complete: false,
        limitations: ["Static inventory; workflows need verification."],
      });
    }
    if (path === "/v1/projects" && method === "POST") {
      state.creationCalls++;
      if (state.failCreate) {
        state.failCreate = false;
        return send({ error: { message: "Request wasn't saved. Please try again." } }, 503);
      }
      if (!state.empty && body.id === state.project.id) {
        if (body.summary !== state.project.summary)
          return send({ error: { code: "REQUEST_ALREADY_SAVED", message: "Your earlier request is already saved. Open it to add these changes in the conversation. Your edited input is still here." } }, 409);
        return send({ id: state.project.id }, 201);
      }
      state.empty = false;
      state.project = {
        ...state.project,
        ...body,
        ...(body.inspectionId ? {
          name: "private-app",
          platform: "GitHub",
          contactEmail: auth.account?.email ?? "",
          stage: "IN_REVIEW",
          repositoryUrl: connection.repositories[0]!.url,
          inspectionReport: { repository: "builder/private-app", url: connection.repositories[0]!.url, commit: "a".repeat(40), branch: "main", stack: ["Next.js"], fileCount: 42, complete: false, limitations: ["Static inventory; workflows need verification."] },
        } : {}),
        id: body.id as string,
      } as Project;
      if (state.loseCreateResponse) {
        state.loseCreateResponse = false;
        return route.abort("connectionreset");
      }
      return send({ id: state.project.id }, 201);
    }
    if (path === "/v1/projects" || path === "/v1/operator/projects") {
      if (state.failList) return send({ error: { message: "Your projects could not be loaded. Try again." } }, 503);
      return send({
        projects: state.empty
          ? []
          : [{ ...state.project, billingMode: state.project.billing?.mode }],
      });
    }
    if (
      path === `/v1/projects/${state.project.id}` ||
      path === `/v1/operator/projects/${state.project.id}`
    ) {
      const publicProject = { ...state.project };
      delete publicProject.notes;
      return send(path.includes("/operator/") ? state.project : publicProject);
    }
    if (path.endsWith("/repository")) {
      state.project.repositoryUrl = connection.repositories[0]!.url;
      state.project.inspectionReport = {
        repository: "builder/private-app",
        url: connection.repositories[0]!.url,
        commit: "a".repeat(40),
        branch: "main",
        stack: ["Next.js", "PostgreSQL"],
        fileCount: 42,
        complete: false,
        limitations: ["Static inventory; workflows need verification."],
      };
      state.project.version++;
      return send({ saved: true });
    }
    if (path.endsWith("/requests")) {
      state.requestCalls++;
      if (state.expireRequest) {
        state.expireRequest = false;
        state.signedOut = true;
        return send(
          {
            error: {
              message: "Sign in to see your projects. Your workspace is saved.",
            },
          },
          401,
        );
      }
      if (state.failRequest) {
        state.failRequest = false;
        return send(
          { error: { message: "The request wasn’t saved. Please try again." } },
          500,
        );
      }
      state.project.requests.unshift({
        id: "request",
        kind: body.kind as string,
        title: body.title as string,
        detail: body.detail as string,
        referenceUrl: null,
        createdAt: new Date().toISOString(),
      });
      state.project.version++;
      return send({ id: "request" }, 201);
    }
    if (path.endsWith("/submit")) {
      state.project.stage = "IN_REVIEW";
      state.project.version++;
      return send({ submitted: true });
    }
    if (path.endsWith("/review")) {
      state.project.reviewSummary = body.summary as string;
      state.project.version++;
      return send({ saved: true });
    }
    if (path.endsWith("/proposals")) {
      expect(body.amountCents).toBe(125000);
      state.project.proposals = [
        {
          id: proposalId,
          version: 1,
          scope: body.scope as string,
          acceptance: body.acceptance as string,
          amountCents: body.amountCents as number,
          currency: body.currency as string,
          deliveryDate: body.deliveryDate as string,
          assumptions: body.assumptions as string,
          approvedAt: null,
          milestones: (
            (body.paymentPlan as
              | {
                  label: string;
                  amountCents: number;
                  dueWhen: PaymentMilestone["dueWhen"];
                }[]
              | undefined) ?? [
              {
                label: "Project payment",
                amountCents: body.amountCents as number,
                dueWhen: "BEFORE_BUILD",
              },
            ]
          ).map((m, position) => ({
            ...m,
            id: `8b3f8de8-5118-4a54-8506-78372585f4${10 + position}`,
            position,
            paidAt: null,
            releasedAt: null,
            paidCents: 0,
            refundedCents: 0,
            disputed: false,
          })),
        },
      ];
      state.project.currentProposalId = proposalId;
      state.project.stage = "AWAITING_APPROVAL";
      state.project.version++;
      return send({ id: proposalId }, 201);
    }
    if (path.endsWith("/approve")) {
      if (state.staleApproval)
        return send(
          {
            error: {
              message:
                "This project changed. Refresh it and check the latest proposal.",
            },
          },
          409,
        );
      expect(body.proposalId).toBe(proposalId);
      expect(body.consent).toBe(true);
      state.project.stage = "APPROVED";
      state.project.proposals[0]!.approvedAt = new Date().toISOString();
      const firstPayment = state.project.proposals[0]!.milestones?.[0];
      if (firstPayment) firstPayment.releasedAt = new Date().toISOString();
      state.project.version++;
      return send({ approved: true });
    }
    if (path.endsWith("/notes")) {
      state.project.notes!.unshift({
        id: body.id as string,
        body: body.body as string,
        authorName: "team",
        createdAt: new Date().toISOString(),
      });
      return send({ id: body.id }, 201);
    }
    if (path.endsWith("/work")) {
      state.project.workItems!.push({
        id: body.id as string,
        title: body.title as string,
        detail: body.detail as string,
        status: "TODO",
        evidence: null,
        evidenceUrl: null,
      });
      state.project.version++;
      return send({ id: body.id }, 201);
    }
    if (path.includes("/work/")) {
      const item = state.project.workItems!.find(
        (item) => item.id === path.split("/").at(-1),
      )!;
      Object.assign(item, body);
      state.project.version++;
      return send({ saved: true });
    }
    if (path.includes("/payments/")) {
      const milestone = state.project.proposals[0]!.milestones?.find(
        (m) => m.id === path.split("/").at(-2),
      );
      if (!milestone)
        return send({ error: { message: "No fixture installment." } }, 404);
      if (path.endsWith("/request")) {
        milestone.releasedAt = new Date().toISOString();
        state.project.version++;
        return send({ requested: true });
      }
      if (path.endsWith("/checkout")) {
        if (state.failCheckout) {
          state.failCheckout = false;
          return send(
            {
              error: {
                message:
                  "Payment collection is being set up. Your agreement is saved.",
              },
            },
            503,
          );
        }
        milestone.paidCents = milestone.amountCents;
        milestone.attempts = [{ mode: "test", status: "PAID" }];
        milestone.paidAt = new Date().toISOString();
        state.project.version++;
        return send({ paid: true });
      }
      state.syncCalls++;
      return send({ refreshed: true });
    }
    if (path.endsWith("/progress")) {
      state.project.stage = body.stage as string;
      if (body.verificationSummary)
        state.project.verificationSummary = body.verificationSummary as string;
      state.project.version++;
      state.project.updates.unshift({
        id: crypto.randomUUID(),
        author: "TEAM",
        title: body.title as string,
        detail: body.detail as string,
        createdAt: new Date().toISOString(),
      });
      return send({ saved: true });
    }
    return send({ error: { message: "Unexpected fixture route." } }, 404);
  });
  return state;
}
export function publishProposal(
  state: Awaited<ReturnType<typeof mockWorkspace>>,
) {
  state.project.stage = "AWAITING_APPROVAL";
  state.project.reviewSummary =
    "The booking foundation exists. We recommend recurring booking support and a verified checkout journey.";
  state.project.currentProposalId = proposalId;
  state.project.proposals = [
    {
      id: proposalId,
      version: 1,
      scope: "Add recurring bookings and repair the agreed checkout journey.",
      acceptance:
        "A customer can book every week and complete checkout successfully.",
      amountCents: 125000,
      currency: "USD",
      deliveryDate: new Date(Date.now() + 14 * 86400000).toISOString(),
      assumptions:
        "Starts after access and payment are agreed. Includes the listed acceptance checks and handover.",
      approvedAt: null,
    },
  ];
}
