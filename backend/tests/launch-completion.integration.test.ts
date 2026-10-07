import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { encrypt, hash } from "../src/crypto.js";
import { type ProjectEmail } from "../src/notifications.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "launch continuity, notifications and terminal boundaries",
  () => {
    const prisma = new PrismaClient({
      datasourceUrl:
        databaseUrl ?? "postgresql://unused:unused@localhost/m8itwork_test",
    });
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      OPERATOR_GITHUB_IDS: "830001",
      TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    });
    const ids: string[] = [],
      reviews: string[] = [];
    const sent: ProjectEmail[] = [];
    let sendHook: (message: ProjectEmail) => Promise<void> = async () => {};
    const email = {
      enabled: true,
      async send(message: ProjectEmail) {
        await sendHook(message);
        sent.push(message);
      },
    };
    let app: Awaited<ReturnType<typeof buildApp>>;
    let operator: Awaited<ReturnType<typeof actor>>;
    beforeAll(async () => {
      if (
        !databaseUrl ||
        !new URL(databaseUrl).pathname.endsWith("/m8itwork_test")
      )
        throw new Error("Dedicated test database required");
      app = await buildApp({
        env,
        prisma,
        projectEmailProvider: email,
        logger: false,
        rateLimiting: false,
      });
      operator = await actor("830001");
    });
    afterAll(async () => {
      await prisma.reviewSession.deleteMany({ where: { id: { in: reviews } } });
      await prisma.account.deleteMany({ where: { id: { in: ids } } });
      if (app) await app.close();
      else await prisma.$disconnect();
    });
    async function actor(githubId?: string) {
      const account = await prisma.account.create({
        data: {
          ...(githubId ? { githubId } : {}),
          email: `${randomUUID()}@example.invalid`,
          emailVerifiedAt: new Date(),
        },
      });
      ids.push(account.id);
      const raw = randomBytes(32).toString("base64url");
      const sessionId = hash(raw);
      await prisma.accountSession.create({
        data: {
          id: sessionId,
          accountId: account.id,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      return { account, sessionId, cookie: `m8_account_session=${raw}` };
    }
    const post = (path: string, cookieValue: string, payload: unknown) =>
      app.inject({
        method: "POST",
        url: path,
        headers: {
          cookie: cookieValue,
          origin: env.FRONTEND_ORIGIN,
          "content-type": "application/json",
        },
        payload: JSON.stringify(payload),
      });
    async function project(accountId: string, stage = "IN_REVIEW") {
      return prisma.project.create({
        data: {
          accountId,
          name: "Synthetic continuity app",
          contactEmail: "",
          platform: "Other",
          summary:
            "Extend this synthetic fixture and verify its important workflows.",
          stage,
          repositoryUrl: "https://github.com/fixture/continuity",
          inspectionReport: {
            commit: "a".repeat(40),
            repositoryUrl: "https://github.com/fixture/continuity",
            stack: ["Node.js"],
          },
          aiReviewConsentAt: new Date(),
          aiReviewConsentVersion: "ai-review-v1",
        },
      });
    }
    it("acknowledges an exact added-request retry before version checks, rejects changed/cross-project identities", async () => {
      const owner = await actor(),
        p = await project(owner.account.id),
        other = await project(owner.account.id);
      const body = {
        id: randomUUID(),
        version: p.version,
        purpose: "ADDITION",
        kind: "FEATURE",
        title: "Add a calendar",
        detail: "Add a monthly view for upcoming bookings.",
      };
      expect(
        (await post(`/v1/projects/${p.id}/requests`, owner.cookie, body))
          .statusCode,
      ).toBe(201);
      expect(
        (await post(`/v1/projects/${p.id}/requests`, owner.cookie, body))
          .statusCode,
      ).toBe(201);
      expect(
        (
          await post(`/v1/projects/${p.id}/requests`, owner.cookie, {
            ...body,
            detail:
              "Changed request should not silently reuse the original identity.",
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (await post(`/v1/projects/${other.id}/requests`, owner.cookie, body))
          .statusCode,
      ).toBe(409);
      expect(
        await prisma.projectRequest.count({ where: { id: body.id } }),
      ).toBe(1);
    });
    it("withdraws once, cancels queued reviews and denies consent and new private review dispatch", async () => {
      const owner = await actor(),
        p = await project(owner.account.id),
        jobId = randomUUID();
      await prisma.reviewJob.create({
        data: {
          id: jobId,
          projectId: p.id,
          provider: "codex",
          commit: "a".repeat(40),
          repositoryUrl: p.repositoryUrl!,
          inputDigest: "fixture",
          requestSnapshot: {},
        },
      });
      const body = {
        version: p.version,
        reason: "We decided to pause this request for now.",
      };
      expect(
        (await post(`/v1/projects/${p.id}/cancel`, owner.cookie, body))
          .statusCode,
      ).toBe(200);
      expect(
        (await post(`/v1/projects/${p.id}/cancel`, owner.cookie, body))
          .statusCode,
      ).toBe(200);
      const saved = await prisma.project.findUniqueOrThrow({
        where: { id: p.id },
      });
      expect(saved.stage).toBe("WITHDRAWN");
      expect(saved.aiReviewConsentAt).toBeNull();
      expect(
        (await prisma.reviewJob.findUniqueOrThrow({ where: { id: jobId } }))
          .status,
      ).toBe("CANCELLED");
      expect(
        (
          await post(`/v1/projects/${p.id}/ai-review-consent`, owner.cookie, {
            version: saved.version,
            consent: true,
            policy: "ai-review-v1",
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await post(
            `/v1/operator/projects/${p.id}/review-jobs`,
            operator.cookie,
            { id: randomUUID(), version: saved.version, provider: "codex" },
          )
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await post(
            `/v1/operator/projects/${p.id}/review-comparisons`,
            operator.cookie,
            { id: randomUUID(), version: saved.version, provider: "both" },
          )
        ).statusCode,
      ).toBe(409);
    });
    it("both parties can request cancellation; resuming requires a team offer and customer confirmation", async () => {
      const owner = await actor(),
        p = await project(owner.account.id, "BUILDING");
      const proposal = await prisma.proposal.create({
        data: {
          projectId: p.id,
          version: 1,
          scope: "Original agreed work",
          acceptance: "Check the agreed work",
          assumptions: "No new external costs",
          amountCents: 10000,
          currency: "USD",
          deliveryDate: new Date(Date.now() + 86400_000),
          approvedAt: new Date(),
        },
      });
      await prisma.project.update({
        where: { id: p.id },
        data: { currentProposalId: proposal.id },
      });
      expect(
        (
          await post(`/v1/operator/projects/${p.id}/cancel`, operator.cookie, {
            version: 1,
            reason: "The team needs to discuss a cancellation settlement.",
          })
        ).statusCode,
      ).toBe(200);
      let saved = await prisma.project.findUniqueOrThrow({
        where: { id: p.id },
      });
      expect(
        (
          await post(`/v1/operator/projects/${p.id}/work`, operator.cookie, {
            id: randomUUID(),
            version: saved.version,
            title: "Should pause",
            detail: "Do not continue this work before agreement.",
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await post(
            `/v1/projects/${p.id}/cancellation/resume/accept`,
            owner.cookie,
            { version: saved.version, consent: true },
          )
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await post(
            `/v1/operator/projects/${p.id}/cancellation/resume/propose`,
            operator.cookie,
            { version: saved.version },
          )
        ).statusCode,
      ).toBe(200);
      saved = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
      const confirmation = { version: saved.version, consent: true };
      expect(
        (
          await post(
            `/v1/projects/${p.id}/cancellation/resume/accept`,
            owner.cookie,
            confirmation,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post(
            `/v1/projects/${p.id}/cancellation/resume/accept`,
            owner.cookie,
            confirmation,
          )
        ).statusCode,
      ).toBe(200);
      saved = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
      expect(saved.cancellationRequestedAt).toBeNull();
      expect(saved.currentProposalId).toBe(proposal.id);
      expect(saved.stage).toBe("BUILDING");
    });
    it("refreshes only a live owned same-repository selection, retaining old evidence and retiring jobs/proposals", async () => {
      const owner = await actor(),
        stranger = await actor(),
        p = await project(owner.account.id, "AWAITING_APPROVAL");
      const quote = await prisma.proposal.create({
        data: {
          projectId: p.id,
          version: 1,
          scope: "Retained earlier scope",
          acceptance: "Retained earlier checks",
          assumptions: "No external costs",
          amountCents: 10000,
          currency: "USD",
          deliveryDate: new Date(Date.now() + 86400_000),
        },
      });
      await prisma.project.update({
        where: { id: p.id },
        data: {
          currentProposalId: quote.id,
          reviewSummary: "Historical assessment.",
        },
      });
      const raw = randomBytes(32).toString("base64url"),
        reviewId = hash(raw);
      reviews.push(reviewId);
      await prisma.reviewSession.create({
        data: {
          id: reviewId,
          accountSessionId: owner.sessionId,
          expiresAt: new Date(Date.now() + 3600_000),
          githubLogin: "fixture",
          tokenEncrypted: encrypt("synthetic_token", env.TOKEN_ENCRYPTION_KEY),
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });
      const selection = await prisma.inspection.create({
        data: {
          sessionId: reviewId,
          accountId: owner.account.id,
          report: {
            commit: "b".repeat(40),
            url: p.repositoryUrl!,
            stack: ["Node.js"],
          },
        },
      });
      await prisma.reviewSession.update({
        where: { id: reviewId },
        data: { selectedInspectionId: selection.id },
      });
      const body = {
          version: p.version,
          inspectionId: selection.id,
          consent: true,
        },
        cookieValue = `${owner.cookie}; m8_review_session=${raw}`;
      expect(
        (
          await post(
            `/v1/projects/${p.id}/repository/refresh`,
            `${stranger.cookie}; m8_review_session=${raw}`,
            body,
          )
        ).statusCode,
      ).toBe(404);
      const jobId = randomUUID();
      await prisma.reviewJob.create({
        data: {
          id: jobId,
          projectId: p.id,
          provider: "codex",
          commit: "a".repeat(40),
          repositoryUrl: p.repositoryUrl!,
          inputDigest: "fixture",
          requestSnapshot: {},
        },
      });
      expect(
        (
          await post(
            `/v1/projects/${p.id}/repository/refresh`,
            cookieValue,
            body,
          )
        ).statusCode,
      ).toBe(200);
      let saved = await prisma.project.findUniqueOrThrow({
        where: { id: p.id },
      });
      expect(saved.stage).toBe("IN_REVIEW");
      expect(saved.currentProposalId).toBeNull();
      expect(
        await prisma.repositoryRevision.count({ where: { projectId: p.id } }),
      ).toBe(1);
      expect(
        (await prisma.reviewJob.findUniqueOrThrow({ where: { id: jobId } }))
          .status,
      ).toBe("CANCELLED");
      expect(
        (
          await post(`/v1/projects/${p.id}/approve`, owner.cookie, {
            version: saved.version,
            proposalId: quote.id,
            consent: true,
          })
        ).statusCode,
      ).toBe(409);
      await prisma.reviewSession.update({
        where: { id: reviewId },
        data: { selectedInspectionId: selection.id },
      });
      expect(
        (
          await post(`/v1/projects/${p.id}/repository/refresh`, cookieValue, {
            ...body,
            version: saved.version,
          })
        ).json(),
      ).toMatchObject({ unchanged: true });
      expect(
        (await prisma.project.findUniqueOrThrow({ where: { id: p.id } }))
          .version,
      ).toBe(saved.version);
      await prisma.proposal.update({
        where: { id: quote.id },
        data: { approvedAt: new Date() },
      });
      await prisma.reviewSession.update({
        where: { id: reviewId },
        data: { selectedInspectionId: selection.id },
      });
      saved = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
      expect(
        (
          await post(`/v1/projects/${p.id}/repository/refresh`, cookieValue, {
            ...body,
            version: saved.version,
          })
        ).statusCode,
      ).toBe(409);
    });
    it("sends account-bound generic updates after sign-out, deduplicates retries and exposes ambiguity without leaking errors", async () => {
      const owner = await actor(),
        p = await project(owner.account.id),
        id = `fixture:${randomUUID()}`;
      await prisma.notificationOutbox.create({
        data: {
          id,
          accountId: owner.account.id,
          projectId: p.id,
          kind: "PROJECT_UPDATE",
          createdAt: new Date(Date.now() - 48 * 3600_000),
        },
      });
      await prisma.accountSession.delete({ where: { id: owner.sessionId } });
      sendHook = async (message) => {
        if (message.to === owner.account.email)
          throw new Error("provider secret must never be saved");
      };
      await app.maintenance();
      let row = await prisma.notificationOutbox.findUniqueOrThrow({
        where: { id },
      });
      expect(row.lastError).toBe("EMAIL_UNAVAILABLE");
      expect(row.skippedAt).toBeNull();
      await prisma.notificationOutbox.update({
        where: { id },
        data: { nextAttemptAt: new Date(0) },
      });
      sendHook = async () => {};
      await Promise.all([app.maintenance(), app.maintenance()]);
      row = await prisma.notificationOutbox.findUniqueOrThrow({
        where: { id },
      });
      expect(row.sentAt).not.toBeNull();
      const deliveries = sent.filter((m) => m.to === owner.account.email);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.actionUrl).toBe(
        `${env.FRONTEND_ORIGIN}/dashboard?project=${p.id}`,
      );
      const uncertain = `fixture:${randomUUID()}`;
      await prisma.notificationOutbox.create({
        data: {
          id: uncertain,
          accountId: owner.account.id,
          kind: "PROJECT_UPDATE",
          firstAttemptAt: new Date(Date.now() - 24 * 3600_000),
        },
      });
      await app.maintenance();
      expect(
        (
          await prisma.notificationOutbox.findUniqueOrThrow({
            where: { id: uncertain },
          })
        ).lastError,
      ).toBe("DELIVERY_UNCERTAIN");
    });
    it("keeps slow mail off unrelated project transactions and honors prefs, closure, destination and operator-role changes", async () => {
      const owner = await actor(),
        other = await actor(),
        p = await project(other.account.id),
        id = `fixture:${randomUUID()}`;
      await prisma.notificationOutbox.create({
        data: { id, accountId: owner.account.id, kind: "PROJECT_UPDATE" },
      });
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        started = new Promise<void>((resolve) => {
          entered = resolve;
        });
      sendHook = async (m) => {
        if (m.to === owner.account.email) {
          entered();
          await gate;
        }
      };
      const pending = app.maintenance();
      await started;
      try {
        const response = await post(
          `/v1/projects/${p.id}/requests`,
          other.cookie,
          {
            id: randomUUID(),
            version: p.version,
            title: "Independent work",
            detail:
              "This project mutation must not wait for another tenant's email.",
            kind: "QUESTION",
          },
        );
        expect(response.statusCode).toBe(201);
      } finally {
        release();
        await pending;
        sendHook = async () => {};
      }
      const cases = ["prefs", "closed", "changed", "operator"];
      for (const kind of cases) {
        const recipient = await actor(),
          eventId = `fixture:${randomUUID()}`;
        await prisma.notificationOutbox.create({
          data: {
            id: eventId,
            accountId: recipient.account.id,
            kind: kind === "operator" ? "OPERATOR_ALERT" : "PROJECT_UPDATE",
            ...(kind === "changed"
              ? { destination: "old@example.invalid" }
              : {}),
          },
        });
        await prisma.account.update({
          where: { id: recipient.account.id },
          data:
            kind === "prefs"
              ? { projectNotifications: false }
              : kind === "closed"
                ? { closedAt: new Date() }
                : {},
        });
        await app.maintenance();
        expect(
          (
            await prisma.notificationOutbox.findUniqueOrThrow({
              where: { id: eventId },
            })
          ).skippedAt,
        ).not.toBeNull();
        expect(sent.some((m) => m.to === recipient.account.email)).toBe(false);
      }
    });
    it("verifies a notification destination on the same account, never changes recovery identity, and keeps throttling after confirmation", async () => {
      const owner = await actor(),
        other = await actor();
      for (let attempt = 0; attempt < 3; attempt++) {
        expect(
          (
            await post("/v1/auth/notifications/contact", owner.cookie, {
              email: "updates@example.invalid",
            })
          ).statusCode,
        ).toBe(200);
        await app.maintenance();
        const message = sent
          .filter(
            (m) =>
              m.kind === "VERIFY_CONTACT" && m.to === "updates@example.invalid",
          )
          .at(-1)!;
        const token = new URLSearchParams(
          new URL(message.actionUrl).hash.slice(1),
        ).get("contact")!;
        expect(
          (await post("/v1/auth/notifications/verify", other.cookie, { token }))
            .statusCode,
        ).toBe(400);
        expect(
          (await post("/v1/auth/notifications/verify", owner.cookie, { token }))
            .statusCode,
        ).toBe(200);
      }
      expect(
        (
          await post("/v1/auth/notifications/contact", owner.cookie, {
            email: "updates@example.invalid",
          })
        ).statusCode,
      ).toBe(429);
      const saved = await prisma.account.findUniqueOrThrow({
        where: { id: owner.account.id },
      });
      expect(saved.email).toBe(owner.account.email);
      expect(saved.notificationEmail).toBe("updates@example.invalid");
      expect(
        (
          await app.inject({
            url: "/v1/auth/session",
            headers: { cookie: owner.cookie },
          })
        ).json(),
      ).toMatchObject({ account: { notificationVerified: true } });
    });
    it("opens one actionable NEEDS_LOGIN alert per incident and does not recursively alert on operator-mail failure", async () => {
      const worker = await prisma.reviewWorker.create({
        data: {
          operatorId: operator.account.id,
          name: "Synthetic worker",
          tokenHash: hash(randomUUID()),
          lastSeenAt: new Date(),
          providerStatus: [{ provider: "codex", state: "NEEDS_LOGIN" }],
        },
      });
      await app.maintenance();
      await app.maintenance();
      const alert = await prisma.healthAlert.findUniqueOrThrow({
        where: { id: `worker:${worker.id}` },
      });
      expect(alert.code).toBe("WORKER_AUTH_OR_ERROR");
      expect(
        await prisma.notificationOutbox.count({
          where: { id: { startsWith: `alert:worker:${worker.id}:` } },
        }),
      ).toBe(1);
      const count = await prisma.healthAlert.count();
      await prisma.notificationOutbox.create({
        data: {
          id: `fixture:${randomUUID()}`,
          accountId: operator.account.id,
          kind: "OPERATOR_ALERT",
          attempts: 5,
          lastError: "EMAIL_UNAVAILABLE",
          nextAttemptAt: new Date(Date.now() + 3600_000),
        },
      });
      await app.maintenance();
      expect(await prisma.healthAlert.count()).toBe(count);
      await prisma.reviewWorker.update({
        where: { id: worker.id },
        data: { providerStatus: [{ provider: "codex", state: "READY" }] },
      });
      await app.maintenance();
      expect(
        (
          await prisma.healthAlert.findUniqueOrThrow({
            where: { id: alert.id },
          })
        ).resolvedAt,
      ).not.toBeNull();
      await prisma.healthAlert.delete({ where: { id: alert.id } });
    });
  },
);
