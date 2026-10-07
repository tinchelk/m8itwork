import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { hash } from "../src/crypto.js";
import {
  StripeProvider,
  type Checkout,
  type CheckoutInput,
  type PaymentProvider,
} from "../src/stripe-provider.js";

const url = process.env.TEST_DATABASE_URL;
type Detail = Prisma.ProjectGetPayload<{
  include: {
    proposals: { include: { milestones: true } };
    notes: true;
    workItems: true;
  };
}> & { billing: { enabled: boolean } };
describe.skipIf(!url)(
  "admin agreement, payment, conversation and delivery",
  () => {
    const prisma = new PrismaClient({
      datasourceUrl:
        url ?? "postgresql://unused:unused@localhost:5432/m8itwork_test",
    });
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: url,
      OPERATOR_GITHUB_IDS: "800001",
      STRIPE_SECRET_KEY: "sk_test_fixture_only",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture_only",
    });
    const signature = new Stripe("sk_test_fixture_only");
    const realVerifier = new StripeProvider(env);
    const accounts: string[] = [];
    const eventIds: string[] = [];
    const sessions = new Map<string, Checkout>();
    const created: CheckoutInput[] = [];
    let failCreate = false;
    let held = false;
    let disputeHook = async () => {};
    let disputeIntent: string | null = null;
    let retrieveHook: (checkout: Checkout) => Promise<void> = async () => {};
    const provider: PaymentProvider = {
      enabled: true,
      mode: "test",
      verify: realVerifier.verify.bind(realVerifier),
      async create(input) {
        created.push(input);
        if (failCreate) {
          failCreate = false;
          throw new Error("fixture connection lost");
        }
        const existing = [...sessions.values()].find(
          (s) => s.attemptId === input.attemptId,
        );
        if (existing) return existing;
        const checkout: Checkout = {
          id: `cs_test_${randomUUID().replaceAll("-", "")}`,
          url: "https://checkout.stripe.com/c/pay/test",
          status: "open",
          paid: false,
          amountCents: input.amountCents,
          currency: input.currency.toLowerCase(),
          live: false,
          attemptId: input.attemptId,
          paymentIntentId: null,
          refundedCents: 0,
          receiptUrl: null,
        };
        sessions.set(checkout.id, checkout);
        return { ...checkout };
      },
      async retrieve(id) {
        const checkout = sessions.get(id);
        if (!checkout) throw new Error("unknown fixture session");
        const snapshot = { ...checkout };
        await retrieveHook(snapshot);
        return snapshot;
      },
      async expire(id) {
        sessions.get(id)!.status = "expired";
        sessions.get(id)!.url = null;
      },
      async dispute() {
        const snapshot = { paymentIntentId: disputeIntent, held };
        await disputeHook();
        return snapshot;
      },
    };
    let app: Awaited<ReturnType<typeof buildApp>>;
    let team: string;
    beforeAll(async () => {
      if (!url || !new URL(url).pathname.endsWith("/m8itwork_test"))
        throw new Error("Use dedicated test database.");
      app = await buildApp({
        env,
        prisma,
        paymentProvider: provider,
        logger: false,
        rateLimiting: false,
      });
      team = await actor("800001");
    });
    afterAll(async () => {
      await prisma.paymentInbox.deleteMany({ where: { id: { in: eventIds } } });
      if (eventIds.length)
        await prisma.paymentEvent.deleteMany({
          where: { id: { in: eventIds } },
        });
      if (accounts.length)
        await prisma.account.deleteMany({ where: { id: { in: accounts } } });
      if (app) await app.close();
      else await prisma.$disconnect();
    });
    async function actor(
      githubId = String(
        2_000_000_000 + Math.floor(Math.random() * 100_000_000),
      ),
    ) {
      const account = await prisma.account.create({
        data: { githubId, githubLogin: "fixture-" + githubId },
      });
      accounts.push(account.id);
      const raw = randomBytes(32).toString("base64url");
      await prisma.accountSession.create({
        data: {
          id: hash(raw),
          accountId: account.id,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      return `m8_account_session=${raw}`;
    }
    const get = (path: string, cookie: string) =>
      app.inject({ url: path, headers: { cookie } });
    const post = (path: string, cookie: string, payload: unknown) =>
      app.inject({
        method: "POST",
        url: path,
        headers: {
          cookie,
          origin: env.FRONTEND_ORIGIN,
          "content-type": "application/json",
        },
        payload: JSON.stringify(payload),
      });
    const detail = async (id: string, cookie: string, operator = false) =>
      (
        await get(`/v1/${operator ? "operator/" : ""}projects/${id}`, cookie)
      ).json<Detail>();
    async function project(cookie: string) {
      const id = randomUUID();
      const result = await post("/v1/projects", cookie, {
        id,
        name: "Fixture booking app",
        contactEmail: "builder@example.invalid",
        platform: "Lovable",
        summary: "Add recurring bookings and verify the checkout journey.",
        accessNote: "Private export is being arranged with the customer.",
        consent: true,
      });
      expect(result.statusCode).toBe(201);
      return id;
    }
    const quote = (version: number, split = false) => ({
      version,
      scope:
        "Add recurring bookings and improve the customer checkout journey.",
      acceptance:
        "Verify recurring bookings and successful checkout against the agreed examples.",
      amountCents: 100000,
      currency: "USD",
      deliveryDate: "2099-12-01",
      assumptions:
        "Starts after access and deposit payment. Includes only the agreed acceptance checks.",
      ...(split
        ? {
            paymentPlan: [
              { label: "Deposit", amountCents: 40000, dueWhen: "BEFORE_BUILD" },
              {
                label: "Build checkpoint",
                amountCents: 40000,
                dueWhen: "BEFORE_VERIFY",
              },
              {
                label: "Final payment",
                amountCents: 20000,
                dueWhen: "BEFORE_HANDOVER",
              },
            ],
          }
        : {}),
    });
    async function agreed(split = false) {
      const customer = await actor();
      const id = await project(customer);
      expect(
        (await post(`/v1/projects/${id}/submit`, customer, { version: 1 }))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await post(`/v1/operator/projects/${id}/review`, team, {
            version: 2,
            summary:
              "The existing app has been reviewed and the focused acceptance checks are understood.",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/proposals`,
            team,
            quote(3, split),
          )
        ).statusCode,
      ).toBe(201);
      const proposal = await detail(id, customer);
      expect(
        (
          await post(`/v1/projects/${id}/approve`, customer, {
            version: proposal.version,
            proposalId: proposal.currentProposalId,
            consent: true,
          })
        ).statusCode,
      ).toBe(200);
      const current = await detail(id, customer);
      return {
        id,
        customer,
        milestones: current.proposals[0]!.milestones as { id: string }[],
      };
    }
    async function event(
      type: string,
      object: unknown,
      options: { id?: string; live?: boolean; created?: number } = {},
    ) {
      const id = options.id ?? `evt_${randomUUID()}`;
      eventIds.push(id);
      const raw = JSON.stringify({
        id,
        object: "event",
        type,
        created: options.created ?? Math.floor(Date.now() / 1000),
        livemode: options.live ?? false,
        data: { object },
      });
      return app.inject({
        method: "POST",
        url: "/v1/stripe/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature.webhooks.generateTestHeaderString({
            payload: raw,
            secret: env.STRIPE_WEBHOOK_SECRET,
          }),
        },
        payload: raw,
      });
    }
    async function open(id: string, customer: string, milestone: string) {
      const response = await post(
        `/v1/projects/${id}/payments/${milestone}/checkout`,
        customer,
        {},
      );
      expect(response.statusCode).toBe(200);
      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { milestoneId: milestone },
        orderBy: { createdAt: "desc" },
      });
      return sessions.get(attempt.stripeSessionId!)!;
    }
    async function pay(id: string, customer: string, milestone: string) {
      const checkout = await open(id, customer, milestone);
      checkout.status = "complete";
      checkout.paid = true;
      checkout.url = null;
      checkout.paymentIntentId = "pi_" + randomUUID();
      expect(
        (
          await event("checkout.session.completed", {
            id: checkout.id,
            metadata: { attemptId: checkout.attemptId },
          })
        ).statusCode,
      ).toBe(200);
      return checkout;
    }
    it("keeps historical invoice and refund webhooks reconciling after customer closure", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await pay(id, customer, milestones[0]!.id);
      const project = await prisma.project.update({
        where: { id },
        data: { stage: "COMPLETE" },
      });
      expect(
        (
          await post(`/v1/operator/projects/${id}/handover`, team, {
            version: project.version,
            summary: "Completed artifact delivered and verified.",
            artifacts: [
              {
                label: "Delivery",
                url: "https://github.com/fixture/app/pull/1",
              },
            ],
            checks: "Agreed checks passed in the recorded environment.",
            instructions:
              "Operate using the approved branch and configuration.",
            limitations: "No known limitations in the agreed checks.",
            deployment: "Deployment is excluded from this agreement.",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post("/v1/auth/account/close", customer, {
            accountId: project.accountId,
            requestId: randomUUID(),
            confirmation: "CLOSE",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/payments/${milestones[0]!.id}/expire`,
            team,
            {},
          )
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/payments/${milestones[0]!.id}/recover`,
            team,
            { sessionId: checkout.id },
          )
        ).statusCode,
      ).toBe(409);
      checkout.invoiceUrl = "https://invoice.stripe.com/i/closed-fixture";
      expect(
        (
          await event("invoice.paid", {
            id: "in_closed",
            metadata: { attemptId: checkout.attemptId },
          })
        ).statusCode,
      ).toBe(200);
      checkout.refundedCents = 1000;
      expect(
        (
          await event("charge.refunded", {
            payment_intent: checkout.paymentIntentId,
          })
        ).statusCode,
      ).toBe(200);
      const saved = await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: checkout.attemptId },
      });
      expect(saved).toMatchObject({
        status: "PAID",
        invoiceUrl: checkout.invoiceUrl,
        refundedCents: 1000,
      });
      expect((await get(`/v1/operator/projects/${id}`, team)).statusCode).toBe(
        200,
      );
      expect(
        (await prisma.project.findUniqueOrThrow({ where: { id } })).stage,
      ).toBe("COMPLETE");
    });
    it("reconciles delayed invoice documents without duplicating a recorded payment", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await pay(id, customer, milestones[0]!.id);
      checkout.invoiceUrl = "https://invoice.stripe.com/i/fixture";
      checkout.invoicePdf = "https://invoice.stripe.com/i/fixture/pdf";
      checkout.receiptUrl = "https://pay.stripe.com/receipts/fixture";
      const before = await prisma.projectUpdate.count({
        where: { projectId: id },
      });
      const eventId = `evt_${randomUUID()}`;
      for (let i = 0; i < 2; i++)
        expect(
          (
            await event(
              "invoice.paid",
              { id: "in_fixture", metadata: { attemptId: checkout.attemptId } },
              { id: eventId },
            )
          ).statusCode,
        ).toBe(200);
      const saved = await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: checkout.attemptId },
      });
      expect(saved).toMatchObject({
        status: "PAID",
        invoiceUrl: checkout.invoiceUrl,
        invoicePdf: checkout.invoicePdf,
        receiptUrl: checkout.receiptUrl,
      });
      expect(
        await prisma.projectUpdate.count({ where: { projectId: id } }),
      ).toBe(before);
      expect(
        await prisma.paymentAttempt.count({
          where: { milestoneId: milestones[0]!.id },
        }),
      ).toBe(1);
      const billing = (await get("/v1/billing", customer)).json<{
        history: { id: string; invoiceUrl: string | null }[];
      }>();
      expect(
        billing.history.find((row) => row.id === saved.id)?.invoiceUrl,
      ).toBe(checkout.invoiceUrl);
    });
    async function progress(id: string, stage: string, evidence?: string) {
      const current = await detail(id, team, true);
      return post(`/v1/operator/projects/${id}/progress`, team, {
        version: current.version,
        stage,
        title: "Delivery stage update",
        detail: "The agreed delivery work is moving to the next step.",
        ...(evidence ? { verificationSummary: evidence } : {}),
      });
    }
    it("protects admin, conversation, work, notes and payment access across accounts", async () => {
      const { id, customer, milestones } = await agreed();
      const outsider = await actor();
      expect((await get("/v1/operator/projects", customer)).statusCode).toBe(
        403,
      );
      expect(
        (await app.inject({ url: `/v1/projects/${id}/messages` })).statusCode,
      ).toBe(401);
      for (const path of [`/v1/projects/${id}/messages`, `/v1/projects/${id}`])
        expect((await get(path, outsider)).statusCode).toBe(404);
      expect(
        (
          await post(
            `/v1/projects/${id}/payments/${milestones[0]!.id}/checkout`,
            outsider,
            {},
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await post(`/v1/operator/projects/${id}/notes`, customer, {
            id: randomUUID(),
            body: "Not authorized",
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await post(`/v1/operator/projects/${id}/work`, customer, {
            id: randomUUID(),
            version: 5,
            title: "Unsafe edit",
            detail: "This should not be accepted.",
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await post(`/v1/projects/${id}/messages`, customer, {
            id: randomUUID(),
            body: "Spoof role",
            authorRole: "TEAM",
          })
        ).statusCode,
      ).toBe(400);
      const missingOrigin = await app.inject({
        method: "POST",
        url: `/v1/projects/${id}/messages`,
        headers: { cookie: customer },
        payload: { id: randomUUID(), body: "CSRF" },
      });
      expect(missingOrigin.statusCode).toBe(403);
    });
    it("keeps team notes private and messages durable, idempotent, paginated and separate from quote versions", async () => {
      const customer = await actor();
      const id = await project(customer);
      const initial = await detail(id, customer);
      const message = {
        id: randomUUID(),
        body: "Can we include recurring bookings in this scope?",
      };
      for (let i = 0; i < 2; i++)
        expect(
          (await post(`/v1/projects/${id}/messages`, customer, message))
            .statusCode,
        ).toBe(201);
      expect(
        await prisma.projectMessage.count({ where: { projectId: id } }),
      ).toBe(1);
      expect((await detail(id, customer)).version).toBe(initial.version);
      expect(
        (
          await post(`/v1/operator/projects/${id}/messages`, team, {
            id: randomUUID(),
            body: "Yes, I’ll include that in a reviewed proposal.",
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await post(`/v1/operator/projects/${id}/notes`, team, {
            id: randomUUID(),
            body: "Private effort estimate: this needs a custom background job.",
          })
        ).statusCode,
      ).toBe(201);
      expect((await detail(id, customer)).notes).toBeUndefined();
      expect((await detail(id, team, true)).notes).toHaveLength(1);
      const record = await prisma.project.findUniqueOrThrow({ where: { id } });
      await prisma.projectMessage.createMany({
        data: Array.from({ length: 52 }, (_, n) => ({
          id: randomUUID(),
          projectId: id,
          authorId: record.accountId,
          authorRole: "CUSTOMER",
          authorName: "fixture",
          body: `Requirement ${n}`,
          createdAt: new Date(Date.now() + n),
        })),
      });
      const newest = (
        await get(`/v1/operator/projects/${id}/messages`, team)
      ).json<{ messages: { id: string }[]; olderCursor: string }>();
      expect(newest.messages).toHaveLength(50);
      const older = (
        await get(
          `/v1/operator/projects/${id}/messages?before=${newest.olderCursor}`,
          team,
        )
      ).json();
      expect(older.messages).toHaveLength(4);
      const last = newest.messages.at(-1)!.id;
      expect(
        (
          await post(`/v1/operator/projects/${id}/messages/read`, team, {
            messageId: last,
          })
        ).statusCode,
      ).toBe(200);
      expect((await detail(id, team, true)).teamReadAt).not.toBeNull();
      const otherId = await project(customer);
      expect(
        (
          await post(`/v1/projects/${otherId}/messages/read`, customer, {
            messageId: last,
          })
        ).statusCode,
      ).toBe(404);
    });
    it("rejects invalid schedules and requires approval before collecting payment", async () => {
      const customer = await actor();
      const id = await project(customer);
      await post(`/v1/projects/${id}/submit`, customer, { version: 1 });
      await post(`/v1/operator/projects/${id}/review`, team, {
        version: 2,
        summary:
          "Reviewed the existing app and documented the scope for a focused proposal.",
      });
      for (const paymentPlan of [
        [{ label: "Deposit", amountCents: 99999, dueWhen: "BEFORE_BUILD" }],
        [{ label: "Final", amountCents: 100000, dueWhen: "BEFORE_HANDOVER" }],
      ])
        expect(
          (
            await post(`/v1/operator/projects/${id}/proposals`, team, {
              ...quote(3),
              paymentPlan,
            })
          ).statusCode,
        ).toBe(400);
      expect(
        (await post(`/v1/operator/projects/${id}/proposals`, team, quote(3)))
          .statusCode,
      ).toBe(201);
      const current = await detail(id, customer);
      expect(
        (
          await post(
            `/v1/projects/${id}/payments/${current.proposals[0]!.milestones[0]!.id}/checkout`,
            customer,
            {},
          )
        ).statusCode,
      ).toBe(409);
    });
    it("uses server prices, keeps Checkout retries idempotent and return URLs untrusted", async () => {
      const { id, customer, milestones } = await agreed();
      const milestone = milestones[0]!.id;
      expect(
        (
          await post(
            `/v1/projects/${id}/payments/${milestone}/checkout`,
            customer,
            { amountCents: 1 },
          )
        ).statusCode,
      ).toBe(400);
      const before = created.length;
      await open(id, customer, milestone);
      await open(id, customer, milestone);
      expect(created.length).toBe(before + 1);
      expect(created.at(-1)!.amountCents).toBe(100000);
      expect(
        await prisma.paymentAttempt.count({
          where: { milestoneId: milestone },
        }),
      ).toBe(1);
      const returned = (
        await get(`/v1/projects/${id}?payment=success`, customer)
      ).json();
      expect(returned.proposals[0]!.milestones[0]!.paidCents).toBe(0);
      expect((await progress(id, "BUILDING")).json().error.code).toBe(
        "PAYMENT_REQUIRED",
      );
    });
    it("requires signed correct-mode, matching payment confirmation and deduplicates real signatures", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await open(id, customer, milestones[0]!.id);
      const forged = await app.inject({
        method: "POST",
        url: "/v1/stripe/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "forged",
        },
        payload: "{}",
      });
      expect(forged.statusCode).toBe(400);
      checkout.paid = true;
      checkout.status = "complete";
      checkout.paymentIntentId = "pi_" + randomUUID();
      expect(
        (
          await event(
            "checkout.session.completed",
            { id: checkout.id },
            { live: true },
          )
        ).statusCode,
      ).toBe(400);
      checkout.amountCents = 1;
      expect(
        (await event("checkout.session.completed", { id: checkout.id }))
          .statusCode,
      ).toBe(200); // Signed events are durably accepted; mismatches remain held for recovery.
      expect(
        await prisma.paymentInbox.count({
          where: {
            attemptId: checkout.attemptId,
            processedAt: null,
            lastError: { not: null },
          },
        }),
      ).toBe(1);
      checkout.amountCents = 100000;
      const duplicateId = `evt_${randomUUID()}`;
      const calls = await Promise.all([
        event(
          "checkout.session.completed",
          { id: checkout.id },
          { id: duplicateId },
        ),
        event(
          "checkout.session.completed",
          { id: checkout.id },
          { id: duplicateId },
        ),
      ]);
      expect(calls.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(
        await prisma.projectUpdate.count({
          where: { projectId: id, title: "Payment confirmed: Project payment" },
        }),
      ).toBe(1);
      expect(
        (await detail(id, customer)).proposals[0]!.milestones[0]!.paidCents,
      ).toBe(100000);
      expect((await progress(id, "BUILDING")).json().error.code).toBe(
        "PAYMENT_RECONCILIATION_PENDING",
      );
      await prisma.paymentInbox.updateMany({
        where: { attemptId: checkout.attemptId, processedAt: null },
        data: { nextAttemptAt: new Date(0) },
      });
      await app.maintenance();
      expect((await progress(id, "BUILDING")).statusCode).toBe(200);
    });
    it("leaves unpaid completion pending and prevents concurrent double Checkout", async () => {
      const { id, customer, milestones } = await agreed();
      const milestone = milestones[0]!.id;
      const responses = await Promise.all([
        post(`/v1/projects/${id}/payments/${milestone}/checkout`, customer, {}),
        post(`/v1/projects/${id}/payments/${milestone}/checkout`, customer, {}),
      ]);
      expect(responses.every((r) => [200, 409].includes(r.statusCode))).toBe(
        true,
      );
      expect(
        await prisma.paymentAttempt.count({
          where: { milestoneId: milestone },
        }),
      ).toBe(1);
      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { milestoneId: milestone },
      });
      const checkout = sessions.get(attempt.stripeSessionId!)!;
      checkout.status = "complete";
      expect(
        (await event("checkout.session.completed", { id: checkout.id }))
          .statusCode,
      ).toBe(200);
      expect(
        (await detail(id, customer)).proposals[0]!.milestones[0]!.paidCents,
      ).toBe(0);
      expect((await progress(id, "BUILDING")).statusCode).toBe(409);
    });
    it("recovers failed creation with the same key, expires unpaid checkout, and locks revisions while money is active", async () => {
      const { id, customer, milestones } = await agreed();
      const milestone = milestones[0]!.id;
      failCreate = true;
      expect(
        (
          await post(
            `/v1/projects/${id}/payments/${milestone}/checkout`,
            customer,
            {},
          )
        ).statusCode,
      ).toBe(500);
      const firstAttempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { milestoneId: milestone },
      });
      await open(id, customer, milestone);
      expect(created.at(-1)!.attemptId).toBe(firstAttempt.id);
      let current = await detail(id, customer);
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/proposals`,
            team,
            quote(current.version),
          )
        ).json().error.code,
      ).toBe("PAYMENT_PLAN_LOCKED");
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/payments/${milestone}/expire`,
            team,
            {},
          )
        ).statusCode,
      ).toBe(200);
      current = await detail(id, customer);
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/proposals`,
            team,
            quote(current.version),
          )
        ).statusCode,
      ).toBe(201);
      expect((await detail(id, customer)).stage).toBe("AWAITING_APPROVAL");
    });
    it("requires recovery for ambiguous old creation instead of risking a new charge", async () => {
      const { id, customer, milestones } = await agreed();
      const milestone = milestones[0]!.id;
      failCreate = true;
      await post(
        `/v1/projects/${id}/payments/${milestone}/checkout`,
        customer,
        {},
      );
      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { milestoneId: milestone },
      });
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
      });
      expect(
        (
          await post(
            `/v1/projects/${id}/payments/${milestone}/checkout`,
            customer,
            {},
          )
        ).json().error.code,
      ).toBe("CHECKOUT_RECOVERY_REQUIRED");
      const checkout = await provider.create({
        attemptId: attempt.id,
        projectId: id,
        projectName: "Fixture",
        label: "Project payment",
        amountCents: 100000,
        currency: "USD",
        email: "fixture@example.invalid",
      });
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/payments/${milestone}/recover`,
            team,
            { sessionId: checkout.id },
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post(
            `/v1/projects/${id}/payments/${milestone}/checkout`,
            customer,
            {},
          )
        ).statusCode,
      ).toBe(200);
    });
    it("handles the complete three-installment delivery without collecting future stages early", async () => {
      const { id, customer, milestones } = await agreed(true);
      const [deposit, checkpoint, final] = milestones.map((m) => m.id);
      expect(
        (
          await post(
            `/v1/projects/${id}/payments/${final}/checkout`,
            customer,
            {},
          )
        ).statusCode,
      ).toBe(409);
      let current = await detail(id, customer);
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/payments/${checkpoint}/request`,
            team,
            { version: current.version },
          )
        ).statusCode,
      ).toBe(409);
      await pay(id, customer, deposit!);
      expect((await progress(id, "BUILDING")).statusCode).toBe(200);
      current = await detail(id, customer);
      const workId = randomUUID();
      expect(
        (
          await post(`/v1/operator/projects/${id}/work`, team, {
            id: workId,
            version: current.version,
            title: "Recurring bookings",
            detail:
              "Customers can reserve the same appointment slot every week.",
          })
        ).statusCode,
      ).toBe(201);
      current = await detail(id, customer);
      expect(
        (
          await post(`/v1/operator/projects/${id}/work/${workId}`, team, {
            version: current.version,
            status: "DONE",
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await post(`/v1/operator/projects/${id}/work/${workId}`, team, {
            version: current.version,
            status: "DONE",
            evidence:
              "Verified weekly booking creation and cancellation against agreed examples.",
            evidenceUrl: "https://github.com/fixture/app/pull/1",
          })
        ).statusCode,
      ).toBe(200);
      expect((await progress(id, "VERIFYING")).statusCode).toBe(409);
      current = await detail(id, customer);
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/payments/${checkpoint}/request`,
            team,
            { version: current.version },
          )
        ).statusCode,
      ).toBe(200);
      await pay(id, customer, checkpoint!);
      expect((await progress(id, "VERIFYING")).statusCode).toBe(200);
      expect(
        (
          await progress(
            id,
            "COMPLETE",
            "All agreed journeys verified with recorded handover links.",
          )
        ).statusCode,
      ).toBe(409);
      current = await detail(id, customer);
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/payments/${final}/request`,
            team,
            { version: current.version },
          )
        ).statusCode,
      ).toBe(200);
      await pay(id, customer, final!);
      expect(
        (
          await progress(
            id,
            "COMPLETE",
            "All agreed booking and checkout checks passed. Handover details are recorded in the project.",
          )
        ).statusCode,
      ).toBe(200);
      current = await detail(id, customer);
      expect(current.stage).toBe("COMPLETE");
      expect(current.workItems[0]!.status).toBe("DONE");
      expect(
        current.proposals[0]!.milestones.every(
          (m: { paidCents: number; amountCents: number }) =>
            m.paidCents === m.amountCents,
        ),
      ).toBe(true);
    });
    it("blocks unfinished work and keeps paid proposals immutable", async () => {
      const { id, customer, milestones } = await agreed();
      await pay(id, customer, milestones[0]!.id);
      let current = await detail(id, customer);
      expect(
        (
          await post(
            `/v1/operator/projects/${id}/proposals`,
            team,
            quote(current.version),
          )
        ).statusCode,
      ).toBe(409);
      await progress(id, "BUILDING");
      current = await detail(id, customer);
      await post(`/v1/operator/projects/${id}/work`, team, {
        id: randomUUID(),
        version: current.version,
        title: "Pending verification",
        detail: "This item still needs its acceptance check.",
      });
      await progress(id, "VERIFYING");
      expect(
        (
          await progress(
            id,
            "COMPLETE",
            "A handover summary cannot bypass unfinished items.",
          )
        ).json().error.code,
      ).toBe("WORK_INCOMPLETE");
    });
    it("retains a full refund arriving before the first intent mapping, even while a stale paid snapshot is in flight", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await open(id, customer, milestones[0]!.id);
      checkout.status = "complete";
      checkout.paid = true;
      checkout.paymentIntentId = `pi_${randomUUID()}`;
      let release!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      retrieveHook = async (snapshot) => {
        if (snapshot.id === checkout.id) {
          entered();
          await pending;
        }
      };
      const paidEvent = event("checkout.session.completed", {
        id: checkout.id,
      });
      await reached;
      retrieveHook = async () => {};
      expect(
        (
          await event("charge.refunded", {
            id: "ch_early",
            payment_intent: checkout.paymentIntentId,
            amount_refunded: 100000,
          })
        ).statusCode,
      ).toBe(200);
      release();
      expect((await paidEvent).statusCode).toBe(200);
      const state = await detail(id, customer);
      expect(state.proposals[0]!.milestones[0]!.refundedCents).toBe(100000);
      expect((await progress(id, "BUILDING")).statusCode).toBe(409);
      expect(
        await prisma.paymentInbox.count({
          where: {
            paymentIntentId: checkout.paymentIntentId,
            processedAt: null,
          },
        }),
      ).toBe(0);
    });
    it("does not acknowledge a pending completed event from a stale open provider snapshot", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await open(id, customer, milestones[0]!.id);
      const eventId = `evt_${randomUUID()}`;
      expect(
        (
          await event(
            "checkout.session.completed",
            { id: checkout.id },
            { id: eventId },
          )
        ).statusCode,
      ).toBe(200);
      expect(
        await prisma.paymentEvent.findUnique({ where: { id: eventId } }),
      ).toBeNull();
      expect(
        await prisma.paymentInbox.findUnique({ where: { id: eventId } }),
      ).toMatchObject({
        processedAt: null,
        lastError: "PROVIDER_STATE_PENDING",
      });
      checkout.status = "complete";
      checkout.paid = true;
      checkout.paymentIntentId = `pi_${randomUUID()}`;
      expect(
        (
          await event(
            "checkout.session.completed",
            { id: checkout.id },
            { id: eventId },
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await detail(id, customer)).proposals[0]!.milestones[0]!.paidCents,
      ).toBe(100000);
    });
    it("requires customer settlement agreement, reconciles retained funds, and allows closure without fake completion", async () => {
      const { id, customer, milestones } = await agreed(true);
      await pay(id, customer, milestones[0]!.id);
      const cancel = {
        version: (await detail(id, customer)).version,
        reason:
          "We have paused this business and need to cancel the remaining development.",
      };
      expect(
        (await post(`/v1/projects/${id}/cancel`, customer, cancel)).statusCode,
      ).toBe(200);
      expect(
        (await post(`/v1/projects/${id}/cancel`, customer, cancel)).statusCode,
      ).toBe(200);
      expect((await progress(id, "BUILDING")).json().error.code).toBe(
        "CANCELLATION_PENDING",
      );
      expect(
        (
          await post(
            `/v1/projects/${id}/payments/${milestones[1]!.id}/checkout`,
            customer,
            {},
          )
        ).json().error.code,
      ).toBe("COLLECTION_PAUSED");
      const terms = {
        summary:
          "Retain the paid deposit for the completed assessment. Cancel the remaining development and final installment; no further amount is due.",
        retainedCents: 40000,
      };
      expect(
        (
          await post(`/v1/operator/projects/${id}/settlement/propose`, team, {
            version: (await detail(id, customer)).version,
            ...terms,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post(`/v1/operator/projects/${id}/settle`, team, {
            version: (await detail(id, customer)).version,
            ...terms,
            consent: true,
          })
        ).json().error.code,
      ).toBe("SETTLEMENT_AGREEMENT_REQUIRED");
      const accept = {
        version: (await detail(id, customer)).version,
        consent: true,
      };
      expect(
        (await post(`/v1/projects/${id}/settlement/accept`, customer, accept))
          .statusCode,
      ).toBe(200);
      expect(
        (await post(`/v1/projects/${id}/settlement/accept`, customer, accept))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await post(`/v1/operator/projects/${id}/settle`, team, {
            version: (await detail(id, customer)).version,
            ...terms,
            consent: true,
          })
        ).statusCode,
      ).toBe(200);
      const closed = await detail(id, customer);
      expect(closed.stage).toBe("CANCELLED");
      expect(closed.proposals[0]!.milestones[1]!.paidCents).toBe(0);
      const accountId = (
        await prisma.project.findUniqueOrThrow({ where: { id } })
      ).accountId;
      expect(
        (
          await post("/v1/auth/account/close", customer, {
            accountId,
            requestId: randomUUID(),
            confirmation: "CLOSE",
          })
        ).statusCode,
      ).toBe(200);
    });
    it("rejects settlement with open collection and retains agreed conditions, handover and separate acceptance", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await pay(id, customer, milestones[0]!.id);
      await progress(id, "BUILDING");
      await progress(id, "VERIFYING");
      expect(
        (
          await progress(
            id,
            "COMPLETE",
            "The agreed journeys passed on the recorded deployment and the checklist evidence is complete.",
          )
        ).statusCode,
      ).toBe(200);
      const payload = {
        summary:
          "Delivered the agreed working workflows and deployment changes.",
        artifacts: [
          {
            label: "Delivered changes",
            url: "https://github.com/customer/app/pull/1",
          },
        ],
        checks:
          "The signed-in flow and payment recovery passed against the agreed checks.",
        instructions:
          "Use the existing hosting account; run the documented migration before the next release.",
        limitations:
          "Deployment requires the customer's production hosting credentials; no unrelated features were changed.",
        deployment:
          "Verified on staging. Production deployment is excluded from this scope.",
      };
      expect(
        (
          await post(`/v1/operator/projects/${id}/handover`, team, {
            version: (await detail(id, customer)).version,
            ...payload,
          })
        ).statusCode,
      ).toBe(200);
      const proposal = await prisma.proposal.findFirstOrThrow({
        where: { projectId: id },
      });
      expect(proposal.conditions).toMatchObject({ aftercareDays: 30 });
      expect(
        (await prisma.project.findUniqueOrThrow({ where: { id } })).acceptedAt,
      ).toBeNull();
      const requestId = randomUUID(),
        report = {
          id: requestId,
          version: (await detail(id, customer)).version,
          kind: "ISSUE",
          purpose: "DEFECT",
          title: "The agreed recovery check fails",
          detail:
            "Returning to the app after an interrupted payment does not show the status.",
        };
      expect(
        (await post(`/v1/projects/${id}/requests`, customer, report))
          .statusCode,
      ).toBe(201);
      expect(
        (await post(`/v1/projects/${id}/requests`, customer, report))
          .statusCode,
      ).toBe(201);
      expect(
        await prisma.projectRequest.count({ where: { id: requestId } }),
      ).toBe(1);
      expect(
        (
          await post(`/v1/projects/${id}/requests`, customer, {
            ...report,
            title: "Edited request after ambiguous response",
          })
        ).json().error.code,
      ).toBe("REQUEST_ID_CONFLICT");
      expect(
        (
          await prisma.projectRequest.findUniqueOrThrow({
            where: { id: requestId },
          })
        ).aftercareEligible,
      ).toBe(true);
      for (const status of [
        "INCLUDED_CORRECTION",
        "CORRECTION_IN_PROGRESS",
        "CORRECTION_RESOLVED",
      ])
        expect(
          (
            await post(
              `/v1/operator/projects/${id}/requests/${requestId}/triage`,
              team,
              {
                version: (await detail(id, customer)).version,
                status,
                reason:
                  "Verified against the original recovery check; the correction and repeated acceptance test are recorded here.",
              },
            )
          ).statusCode,
        ).toBe(200);
      expect(
        (
          await post(`/v1/projects/${id}/accept`, customer, {
            version: (await detail(id, customer)).version,
            consent: true,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await prisma.project.findUniqueOrThrow({ where: { id } })).acceptedAt,
      ).not.toBeNull();
      checkout.refundedCents = 10000;
      await event("charge.refunded", {
        id: "ch_after_handover",
        payment_intent: checkout.paymentIntentId,
        amount_refunded: 10000,
      });
      expect(
        (await detail(id, customer)).proposals[0]!.milestones[0]!.refundedCents,
      ).toBe(10000);
    });
    it("records refunds and prevents stale events from reopening paid work gates", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await pay(id, customer, milestones[0]!.id);
      checkout.refundedCents = 10000;
      expect(
        (
          await event("charge.refunded", {
            id: "ch_fixture",
            payment_intent: checkout.paymentIntentId,
          })
        ).statusCode,
      ).toBe(200);
      checkout.refundedCents = 0;
      expect(
        (await event("checkout.session.completed", { id: checkout.id }))
          .statusCode,
      ).toBe(200);
      const current = await detail(id, customer);
      expect(current.proposals[0]!.milestones[0]!.refundedCents).toBe(10000);
      expect((await progress(id, "BUILDING")).json().error.code).toBe(
        "PAYMENT_REQUIRED",
      );
      expect(
        (
          await post(
            `/v1/projects/${id}/payments/${milestones[0]!.id}/checkout`,
            customer,
            {},
          )
        ).json().error.code,
      ).toBe("PAYMENT_REVIEW_REQUIRED");
    });
    it("holds disputed payments and uses current dispute state despite out-of-order delivery", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await pay(id, customer, milestones[0]!.id);
      disputeIntent = checkout.paymentIntentId;
      held = true;
      expect(
        (
          await event(
            "charge.dispute.created",
            { id: "dp_fixture" },
            { created: 100 },
          )
        ).statusCode,
      ).toBe(200);
      expect((await progress(id, "BUILDING")).statusCode).toBe(409);
      held = false;
      expect(
        (
          await event(
            "charge.dispute.closed",
            { id: "dp_fixture" },
            { created: 200 },
          )
        ).statusCode,
      ).toBe(200);
      held = true;
      expect(
        (
          await event(
            "charge.dispute.created",
            { id: "dp_fixture" },
            { created: 100 },
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await detail(id, customer)).proposals[0]!.milestones[0]!.disputed,
      ).toBe(false);
    });
    it("honestly blocks checkout when Stripe is unconfigured", async () => {
      const { id, customer, milestones } = await agreed();
      provider.enabled = false;
      try {
        expect(
          (
            await post(
              `/v1/projects/${id}/payments/${milestones[0]!.id}/checkout`,
              customer,
              {},
            )
          ).statusCode,
        ).toBe(503);
        expect((await detail(id, customer)).billing.enabled).toBe(false);
      } finally {
        provider.enabled = true;
      }
    });
    it("recovers a missed dispute during sync and fences stale clearing snapshots", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await pay(id, customer, milestones[0]!.id);
      const path = `/v1/projects/${id}/payments/${milestones[0]!.id}/sync`;
      checkout.disputed = true;
      checkout.observedAt = Date.now();
      expect((await post(path, customer, {})).statusCode).toBe(200);
      expect((await progress(id, "BUILDING")).statusCode).toBe(409);
      // This response began before the hold was recorded.
      checkout.disputed = false;
      checkout.observedAt = 1;
      await post(path, customer, {});
      expect(
        (await detail(id, customer)).proposals[0]!.milestones[0]!.disputed,
      ).toBe(true);
      checkout.observedAt = Date.now() + 1;
      await post(path, customer, {});
      expect(
        (await detail(id, customer)).proposals[0]!.milestones[0]!.disputed,
      ).toBe(false);
    });
    it("a closed dispute webhook cannot override a current or concurrently recorded hold", async () => {
      const { id, customer, milestones } = await agreed();
      const checkout = await pay(id, customer, milestones[0]!.id);
      disputeIntent = checkout.paymentIntentId;
      held = false;
      checkout.disputed = true;
      checkout.observedAt = 1;
      expect(
        (
          await event(
            "charge.dispute.closed",
            { id: "dp_current_hold" },
            { created: 300 },
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await detail(id, customer)).proposals[0]!.milestones[0]!.disputed,
      ).toBe(true);
      expect((await progress(id, "BUILDING")).statusCode).toBe(409);
      // Dispute lookup starts first; a newer sync records a hold before its
      // old clearing response completes. Even a later false session snapshot
      // must not upgrade the stale dispute lookup into permission to clear.
      disputeHook = async () => {
        checkout.disputed = true;
        checkout.observedAt = Date.now();
        await post(
          `/v1/projects/${id}/payments/${milestones[0]!.id}/sync`,
          customer,
          {},
        );
        checkout.disputed = false;
        checkout.observedAt = Date.now() + 10;
      };
      try {
        expect(
          (
            await event(
              "charge.dispute.closed",
              { id: "dp_stale_clear" },
              { created: 400 },
            )
          ).statusCode,
        ).toBe(200);
        expect(
          (await detail(id, customer)).proposals[0]!.milestones[0]!.disputed,
        ).toBe(true);
        expect((await progress(id, "BUILDING")).statusCode).toBe(409);
      } finally {
        disputeHook = async () => {};
      }
    });
    it("never lets sandbox balances satisfy live delivery or later installment gates", async () => {
      const { id, customer, milestones } = await agreed(true);
      await pay(id, customer, milestones[0]!.id);
      provider.mode = "live";
      try {
        expect((await progress(id, "BUILDING")).json().error.code).toBe(
          "PAYMENT_REQUIRED",
        );
        // Even a later stage cannot release an installment on sandbox money.
        await prisma.project.update({
          where: { id },
          data: { stage: "BUILDING" },
        });
        const current = await detail(id, customer);
        expect(
          (
            await post(
              `/v1/operator/projects/${id}/payments/${milestones[1]!.id}/request`,
              team,
              { version: current.version },
            )
          ).statusCode,
        ).toBe(409);
      } finally {
        provider.mode = "test";
      }
    });
  },
);
