import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/config.js";
import { StripeProvider } from "../src/stripe-provider.js";

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://fixture:fixture@localhost/m8itwork_test",
  STRIPE_SECRET_KEY: "sk_test_fixture_only",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture_only",
});
const session = {
  id: "cs_test_adapter",
  url: "https://checkout.stripe.com/test",
  status: "open",
  payment_status: "unpaid",
  amount_total: 10000,
  currency: "usd",
  livemode: false,
  metadata: { attemptId: "attempt" },
  payment_intent: null,
} as unknown as Stripe.Response<Stripe.Checkout.Session>;
describe("Stripe SDK adapter contract", () => {
  it("reuses identical creation parameters after a lost response and clock change", async () => {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const create = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValue(session);
    const adapter = new StripeProvider(env, stripe);
    const input = {
      attemptId: "attempt",
      projectId: "project",
      projectName: "Booking app",
      label: "Deposit",
      amountCents: 10000,
      currency: "USD",
      email: "builder@example.invalid",
    };
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_800_000_000_000);
      await expect(adapter.create(input)).rejects.toThrow("lost response");
      now.mockReturnValue(1_800_000_005_000);
      await adapter.create(input);
      expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
      expect(create.mock.calls[0]![1]).toEqual({
        idempotencyKey: "m8-checkout-attempt",
      });
      expect(create.mock.calls[0]![0]).toMatchObject({
        mode: "payment",
        ui_mode: "hosted_page",
        allowed_payment_method_types: ["card"],
        success_url: "http://localhost:3120/dashboard?project=project&payment=returned",
        cancel_url: "http://localhost:3120/dashboard?project=project&payment=cancelled",
      });
    } finally {
      now.mockRestore();
    }
  });
  it("reads authoritative disputes with paid Checkout and includes a snapshot fence", async () => {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue({
      ...session,
      status: "complete",
      payment_status: "paid",
      payment_intent: {
        id: "pi_adapter",
        latest_charge: {
          disputed: true,
          amount_refunded: 0,
          receipt_url: null,
        },
      },
    } as unknown as Stripe.Response<Stripe.Checkout.Session>);
    const list = vi.spyOn(stripe.disputes, "list").mockResolvedValue({
      data: [{ status: "needs_response" }],
      has_more: false,
    } as unknown as Stripe.Response<Stripe.ApiList<Stripe.Dispute>>);
    const adapter = new StripeProvider(env, stripe);
    const result = await adapter.retrieve(session.id);
    expect(list).toHaveBeenCalledWith({
      payment_intent: "pi_adapter",
      limit: 100,
    });
    expect(result.disputed).toBe(true);
    expect(result.observedAt).toBeGreaterThan(0);
    list.mockResolvedValue({
      data: [{ status: "won" }],
      has_more: false,
    } as unknown as Stripe.Response<Stripe.ApiList<Stripe.Dispute>>);
    expect((await adapter.retrieve(session.id)).disputed).toBe(false);
    list.mockResolvedValue({
      data: [],
      has_more: false,
    } as unknown as Stripe.Response<Stripe.ApiList<Stripe.Dispute>>);
    expect((await adapter.retrieve(session.id)).disputed).toBe(true);
  });
});
