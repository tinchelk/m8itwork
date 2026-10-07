import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { hash } from "../src/crypto.js";
import { AppError } from "../src/shared/errors.js";
import type { BillingProvider, SavedCard } from "../src/billing-provider.js";
import type {
  Checkout,
  CheckoutInput,
  PaymentProvider,
} from "../src/stripe-provider.js";

interface BillingPage {
  history: {
    id: string;
    invoiceUrl: string | null;
    receiptUrl: string | null;
  }[];
  next: string | null;
  totals: unknown[];
  due: { id: string; needsReview: boolean }[];
}
const database = process.env.TEST_DATABASE_URL;
describe.skipIf(!database)(
  "customer billing ownership and payment integration",
  () => {
    const prisma = new PrismaClient({ datasourceUrl: database! });
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: database });
    const accountIds: string[] = [];
    const profiles = new Map<string, string>();
    const methods = new Map<
      string,
      SavedCard & { customerId: string | null }
    >();
    const setupRequests: string[] = [],
      authorizations: string[] = [];
    const checkoutInputs: CheckoutInput[] = [];
    const checkouts = new Map<string, Checkout>();
    let setupFinished = false;
    let loseCustomer = false,
      loseRemoval = false,
      setupSaved = false;
    const forbidden = () =>
      new AppError(
        404,
        "BILLING_UNAVAILABLE",
        "Not available to your account.",
      );
    const billingProvider: BillingProvider = {
      enabled: true,
      mode: "test",
      async createCustomer(reservationId, accountId) {
        const customerId = `cus_${reservationId.replaceAll("-", "")}`;
        profiles.set(customerId, accountId);
        if (loseCustomer) {
          loseCustomer = false;
          throw new Error("lost response");
        }
        return customerId;
      },
      async cards(customerId, accountId, after) {
        if (profiles.get(customerId) !== accountId) throw forbidden();
        if (after && methods.get(after)?.customerId !== customerId)
          throw forbidden();
        const own = [...methods.values()].filter(
          (card) => card.customerId === customerId,
        );
        const from = after ? own.findIndex((card) => card.id === after) + 1 : 0;
        return {
          cards: own.slice(from, from + 20).map((card) => ({
            id: card.id,
            brand: card.brand,
            last4: card.last4,
            expMonth: card.expMonth,
            expYear: card.expYear,
          })),
          next: own.length > from + 20 ? own[from + 19]!.id : null,
        };
      },
      async setup(customerId, accountId, requestId) {
        if (profiles.get(customerId) !== accountId) throw forbidden();
        setupRequests.push(`${customerId}:${requestId}`);
        return setupFinished
          ? { url: null, status: "complete" }
          : {
              url: "https://checkout.stripe.com/c/setup/fixture",
              status: "open",
            };
      },
      async verifySetup(sessionId, customerId, accountId) {
        if (
          sessionId !== "cs_test_owned" ||
          profiles.get(customerId) !== accountId
        )
          throw forbidden();
        return setupSaved;
      },
      async authorizeRemoval(customerId, accountId, methodId) {
        if (
          profiles.get(customerId) !== accountId ||
          methods.get(methodId)?.customerId !== customerId
        )
          throw forbidden();
        authorizations.push(methodId);
      },
      async remove(customerId, accountId, methodId) {
        if (profiles.get(customerId) !== accountId) throw forbidden();
        const method = methods.get(methodId);
        if (
          !method ||
          (method.customerId !== null && method.customerId !== customerId)
        )
          throw forbidden();
        method.customerId = null;
        if (loseRemoval) {
          loseRemoval = false;
          throw new Error("lost detach response");
        }
      },
    };
    const paymentProvider: PaymentProvider = {
      enabled: true,
      mode: "test",
      async create(input) {
        checkoutInputs.push(input);
        const checkout: Checkout = {
          id: `cs_test_${input.attemptId}`,
          attemptId: input.attemptId,
          url: "https://checkout.stripe.com/c/pay/fixture",
          status: "open",
          paid: false,
          amountCents: input.amountCents,
          currency: input.currency.toLowerCase(),
          live: false,
          paymentIntentId: null,
          refundedCents: 0,
          receiptUrl: null,
          customerId: input.customerId ?? null,
        };
        checkouts.set(checkout.id, checkout);
        return checkout;
      },
      async retrieve(id) {
        const found = checkouts.get(id);
        if (!found) throw new Error("Missing fixture Checkout");
        return found;
      },
      async expire(id) {
        checkouts.get(id)!.status = "expired";
      },
      verify() {
        throw new Error("Webhook not used by fixture");
      },
      async dispute() {
        return { held: false, paymentIntentId: null };
      },
    };
    let app: Awaited<ReturnType<typeof buildApp>>;
    beforeAll(async () => {
      if (!database || !new URL(database).pathname.endsWith("/m8itwork_test"))
        throw new Error("Use dedicated test database.");
      app = await buildApp({
        prisma,
        env,
        billingProvider,
        paymentProvider,
        logger: false,
        rateLimiting: false,
      });
    });
    afterAll(async () => {
      await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
      await app?.close();
    });
    async function actor() {
      const account = await prisma.account.create({
        data: { displayName: "Billing fixture" },
      });
      accountIds.push(account.id);
      const session = randomBytes(32).toString("base64url");
      await prisma.accountSession.create({
        data: {
          id: hash(session),
          accountId: account.id,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      return { account, cookie: `m8_account_session=${session}` };
    }
    function get(url: string, cookie = "") {
      return app.inject({ url, headers: { cookie } });
    }
    function post(
      url: string,
      cookie: string,
      payload: unknown = {},
      origin = env.FRONTEND_ORIGIN,
    ) {
      return app.inject({
        method: "POST",
        url,
        headers: { cookie, origin, "content-type": "application/json" },
        payload: JSON.stringify(payload),
      });
    }
    async function profile(customer: Awaited<ReturnType<typeof actor>>) {
      expect(
        (
          await post("/v1/billing/cards/setup", customer.cookie, {
            requestId: randomUUID(),
          })
        ).statusCode,
      ).toBe(200);
      return (
        await prisma.billingCustomer.findUniqueOrThrow({
          where: {
            accountId_mode: { accountId: customer.account.id, mode: "test" },
          },
        })
      ).stripeCustomerId!;
    }
    function card(customerId: string) {
      const value = {
        id: `pm_${randomUUID().replaceAll("-", "")}`,
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
        customerId,
      };
      methods.set(value.id, value);
      return value;
    }
    async function project(
      accountId: string,
      approved = true,
      released = true,
    ) {
      const value = await prisma.project.create({
        data: {
          accountId,
          name: "Fixture app",
          summary: "Move it forward",
          contactEmail: "fixture@example.invalid",
          platform: "GitHub",
          stage: approved ? "APPROVED" : "PROPOSED",
        },
      });
      const proposal = await prisma.proposal.create({
        data: {
          projectId: value.id,
          version: 1,
          scope: "Agreed scope",
          acceptance: "Agreed checks",
          amountCents: 10000,
          currency: "USD",
          deliveryDate: new Date("2027-01-01"),
          assumptions: "Fixture",
          ...(approved ? { approvedAt: new Date() } : {}),
          milestones: {
            create: {
              position: 0,
              label: "Deposit",
              amountCents: 10000,
              dueWhen: "BEFORE_BUILD",
              ...(released ? { releasedAt: new Date() } : {}),
            },
          },
        },
        include: { milestones: true },
      });
      await prisma.project.update({
        where: { id: value.id },
        data: { currentProposalId: proposal.id },
      });
      return { project: value, proposal, milestone: proposal.milestones[0]! };
    }
    it("requires login and customer origin, rejects card-number payloads, and creates no profile on a read", async () => {
      const a = await actor();
      expect((await get("/v1/billing")).statusCode).toBe(401);
      expect((await get("/v1/billing/cards")).statusCode).toBe(401);
      expect((await get("/v1/billing/cards", a.cookie)).json()).toMatchObject({
        cards: [],
        enabled: true,
        mode: "test",
      });
      expect(
        await prisma.billingCustomer.count({
          where: { accountId: a.account.id },
        }),
      ).toBe(0);
      for (const origin of ["", env.ADMIN_ORIGIN, "https://evil.example"])
        expect(
          (
            await post(
              "/v1/billing/cards/setup",
              a.cookie,
              { requestId: randomUUID() },
              origin,
            )
          ).statusCode,
        ).toBe(403);
      expect(
        (
          await post("/v1/billing/cards/setup", a.cookie, {
            requestId: randomUUID(),
            cardNumber: "fixture-value",
          })
        ).statusCode,
      ).toBe(400);
    });
    it("reserves one customer across lost responses, concurrent setup, and profile edits", async () => {
      const a = await actor(),
        requestId = randomUUID();
      loseCustomer = true;
      expect(
        (await post("/v1/billing/cards/setup", a.cookie, { requestId }))
          .statusCode,
      ).toBe(500);
      const reserved = await prisma.billingCustomer.findUniqueOrThrow({
        where: { accountId_mode: { accountId: a.account.id, mode: "test" } },
      });
      await prisma.account.update({
        where: { id: a.account.id },
        data: { displayName: "Changed name" },
      });
      const responses = await Promise.all([
        post("/v1/billing/cards/setup", a.cookie, { requestId }),
        post("/v1/billing/cards/setup", a.cookie, { requestId }),
      ]);
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(
        await prisma.billingCustomer.count({
          where: { accountId: a.account.id },
        }),
      ).toBe(1);
      expect(setupRequests.slice(-2)).toEqual([
        `cus_${reserved.id.replaceAll("-", "")}:${requestId}`,
        `cus_${reserved.id.replaceAll("-", "")}:${requestId}`,
      ]);
      const stale = await actor();
      await prisma.billingCustomer.create({
        data: {
          accountId: stale.account.id,
          mode: "test",
          createdAt: new Date(Date.now() - 24 * 3600_000),
        },
      });
      expect(
        (
          await post("/v1/billing/cards/setup", stale.cookie, {
            requestId: randomUUID(),
          })
        ).statusCode,
      ).toBe(409);
    });
    it("lists masked owned cards with pagination and rejects foreign cursors and setup sessions", async () => {
      const a = await actor(),
        b = await actor(),
        own = await profile(a),
        other = await profile(b);
      const cards = Array.from({ length: 21 }, () => card(own)),
        foreign = card(other);
      const page = (await get("/v1/billing/cards", a.cookie)).json();
      expect(page.cards).toHaveLength(20);
      expect(page.next).toBe(cards[19]!.id);
      expect(page.cards[0]).toEqual({
        id: cards[0]!.id,
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
      });
      expect(
        (await get(`/v1/billing/cards?after=${page.next}`, a.cookie)).json()
          .cards,
      ).toHaveLength(1);
      expect(
        (await get(`/v1/billing/cards?after=${foreign.id}`, a.cookie))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await post("/v1/billing/cards/verify", a.cookie, {
            sessionId: "cs_foreign",
          })
        ).statusCode,
      ).toBe(404);
      setupSaved = false;
      expect(
        (
          await post("/v1/billing/cards/verify", a.cookie, {
            sessionId: "cs_test_owned",
          })
        ).json(),
      ).toEqual({ saved: false });
      setupSaved = true;
      expect(
        (
          await post("/v1/billing/cards/verify", a.cookie, {
            sessionId: "cs_test_owned",
          })
        ).json(),
      ).toEqual({ saved: true });
      expect(
        (
          await post("/v1/billing/cards/verify", a.cookie, {
            sessionId: cards[0]!.id,
          })
        ).statusCode,
      ).toBe(400);
    });
    it("records proven ownership before removal and safely retries a lost detach response", async () => {
      const a = await actor(),
        b = await actor(),
        own = card(await profile(a)),
        foreign = card(await profile(b));
      expect(
        (await post(`/v1/billing/cards/${foreign.id}/remove`, a.cookie))
          .statusCode,
      ).toBe(404);
      expect(
        await prisma.billingCardRemoval.count({
          where: { methodId: foreign.id },
        }),
      ).toBe(0);
      loseRemoval = true;
      expect(
        (await post(`/v1/billing/cards/${own.id}/remove`, a.cookie)).statusCode,
      ).toBe(500);
      expect(
        (await post(`/v1/billing/cards/${own.id}/remove`, a.cookie)).json(),
      ).toEqual({ removed: true });
      expect(authorizations.filter((id) => id === own.id)).toHaveLength(1);
      expect(
        (await post(`/v1/billing/cards/${own.id}/remove`, b.cookie)).statusCode,
      ).toBe(404);
    });
    it("filters and paginates owned history, separates mode/currency totals, and sanitizes documents", async () => {
      const a = await actor(),
        b = await actor(),
        own = await project(a.account.id),
        other = await project(b.account.id);
      const attempts = await Promise.all(
        Array.from({ length: 27 }, (_, i) =>
          prisma.paymentAttempt.create({
            data: {
              milestoneId: own.milestone.id,
              mode: i === 0 ? "live" : "test",
              currency: i === 1 ? "EUR" : "USD",
              amountCents: 10000,
              status: i < 24 ? "PAID" : "FAILED",
              refundedCents: i === 2 ? 3000 : 0,
              disputed: i === 3,
              receiptUrl:
                i === 4
                  ? "https://evil.example/receipt"
                  : "https://pay.stripe.com/receipts/fixture",
              invoiceUrl: "javascript:alert(1)",
            },
          }),
        ),
      );
      const foreign = await prisma.paymentAttempt.create({
        data: {
          milestoneId: other.milestone.id,
          mode: "test",
          currency: "USD",
          amountCents: 999999,
          status: "PAID",
        },
      });
      const page = (await get("/v1/billing", a.cookie)).json<BillingPage>();
      expect(page.history).toHaveLength(25);
      expect(page.next).toBeTruthy();
      expect(
        page.history.some((row: { id: string }) => row.id === foreign.id),
      ).toBe(false);
      expect(
        page.history.every(
          (row: { invoiceUrl: unknown }) => row.invoiceUrl === null,
        ),
      ).toBe(true);
      const next = (
        await get(`/v1/billing?after=${page.next}`, a.cookie)
      ).json<BillingPage>();
      expect(next.history).toHaveLength(2);
      expect(next.next).toBeNull();
      expect(
        new Set(
          [...page.history, ...next.history].map(
            (row: { id: string }) => row.id,
          ),
        ).size,
      ).toBe(27);
      expect(page.totals).toEqual(
        expect.arrayContaining([
          { currency: "USD", mode: "live", paidCents: 10000, refundedCents: 0 },
          { currency: "EUR", mode: "test", paidCents: 10000, refundedCents: 0 },
          {
            currency: "USD",
            mode: "test",
            paidCents: 220000,
            refundedCents: 3000,
          },
        ]),
      );
      expect(
        (await get("/v1/billing?status=REFUNDED", a.cookie)).json().history,
      ).toHaveLength(1);
      expect(
        (await get("/v1/billing?status=DISPUTED", a.cookie)).json().history,
      ).toHaveLength(1);
      expect(
        (await get("/v1/billing?status=FAILED", a.cookie)).json().history,
      ).toHaveLength(3);
      expect(
        (await get("/v1/billing?status=PAID", a.cookie)).json().history,
      ).toHaveLength(22);
      expect(
        (await get(`/v1/billing?after=${foreign.id}`, a.cookie)).statusCode,
      ).toBe(404);
      expect(attempts).toHaveLength(27);
    });
    it("shows only current, approved, released dues and marks earlier-payment and refund blockers", async () => {
      const a = await actor(),
        b = await actor();
      const due = await project(a.account.id),
        unapproved = await project(a.account.id, false),
        unreleased = await project(a.account.id, true, false),
        foreign = await project(b.account.id);
      const old = await project(a.account.id);
      await prisma.project.update({
        where: { id: old.project.id },
        data: { currentProposalId: null },
      });
      const later = await prisma.paymentMilestone.create({
        data: {
          proposalId: due.proposal.id,
          position: 1,
          label: "Final",
          amountCents: 10000,
          dueWhen: "BEFORE_HANDOVER",
          releasedAt: new Date(),
        },
      });
      const result = (await get("/v1/billing", a.cookie)).json<BillingPage>();
      expect(result.due.map((d: { id: string }) => d.id)).toEqual(
        expect.arrayContaining([due.milestone.id, later.id]),
      );
      expect(result.due).toHaveLength(2);
      expect(result.due.find((d) => d.id === later.id)!.needsReview).toBe(true);
      for (const id of [
        unapproved.milestone.id,
        unreleased.milestone.id,
        foreign.milestone.id,
        old.milestone.id,
      ])
        expect(result.due.some((d: { id: string }) => d.id === id)).toBe(false);
      expect(
        (await get(`/v1/billing?dueAfter=${foreign.milestone.id}`, a.cookie))
          .statusCode,
      ).toBe(404);
      await prisma.paymentMilestone.update({
        where: { id: due.milestone.id },
        data: { paidCents: 10000, refundedCents: 1000 },
      });
      expect(
        (await get("/v1/billing", a.cookie))
          .json<BillingPage>()
          .due.find((d) => d.id === due.milestone.id)!.needsReview,
      ).toBe(true);
    });
    it("acknowledges a terminal setup before permitting a new request ID", async () => {
      const a = await actor(),
        requestId = randomUUID();
      expect(
        (await post("/v1/billing/cards/setup", a.cookie, { requestId })).json(),
      ).toHaveProperty("url");
      setupFinished = true;
      expect(
        (await post("/v1/billing/cards/setup", a.cookie, { requestId })).json(),
      ).toEqual({ finished: true });
      setupFinished = false;
      expect(
        (
          await post("/v1/billing/cards/setup", a.cookie, {
            requestId: randomUUID(),
          })
        ).json(),
      ).toHaveProperty("url");
    });
    it("keeps overpaid, mode-mismatched and confirmation-pending installments visible for reconciliation", async () => {
      const a = await actor(),
        over = await project(a.account.id),
        mismatch = await project(a.account.id),
        pending = await project(a.account.id);
      await prisma.paymentMilestone.update({
        where: { id: over.milestone.id },
        data: { paidCents: 20000 },
      });
      await prisma.paymentMilestone.update({
        where: { id: mismatch.milestone.id },
        data: { paidCents: 10000 },
      });
      await prisma.paymentAttempt.create({
        data: {
          milestoneId: mismatch.milestone.id,
          mode: "live",
          currency: "USD",
          amountCents: 10000,
          status: "PAID",
        },
      });
      await prisma.paymentAttempt.create({
        data: {
          milestoneId: pending.milestone.id,
          mode: "test",
          currency: "USD",
          amountCents: 10000,
          status: "PROCESSING",
        },
      });
      const page = (await get("/v1/billing", a.cookie)).json<{
        due: { id: string; needsReview: boolean; processing: boolean }[];
      }>();
      expect(
        page.due.find((row) => row.id === over.milestone.id)?.needsReview,
      ).toBe(true);
      expect(
        page.due.find((row) => row.id === mismatch.milestone.id)?.needsReview,
      ).toBe(true);
      expect(
        page.due.find((row) => row.id === pending.milestone.id),
      ).toMatchObject({ needsReview: false, processing: true });
    });
    it("uses the card profile for project Checkout and rejects a mismatched provider customer", async () => {
      const a = await actor(),
        customerId = await profile(a),
        value = await project(a.account.id);
      const path = `/v1/projects/${value.project.id}/payments/${value.milestone.id}/checkout`;
      expect((await post(path, a.cookie)).statusCode).toBe(200);
      expect(checkoutInputs.at(-1)?.customerId).toBe(customerId);
      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { milestoneId: value.milestone.id },
      });
      expect(attempt.stripeCustomerId).toBe(customerId);
      checkouts.get(attempt.stripeSessionId!)!.customerId = "cus_other";
      expect((await post(path, a.cookie)).statusCode).toBe(409);
      expect(
        (
          await prisma.paymentAttempt.findUniqueOrThrow({
            where: { id: attempt.id },
          })
        ).status,
      ).toBe("OPEN");
    });
  },
);
