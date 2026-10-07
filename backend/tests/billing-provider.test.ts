import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/config.js";
import { StripeBillingProvider } from "../src/billing-provider.js";
const env = loadEnv({
  NODE_ENV: "test",
  STRIPE_SECRET_KEY: "sk_test_fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture",
});
const customer = {
  id: "cus_owned",
  livemode: false,
  metadata: { application: "m8itwork", accountId: "account" },
  invoice_settings: { default_payment_method: "pm_owned" },
} as unknown as Stripe.Response<Stripe.Customer>;
const card = {
  id: "pm_owned",
  livemode: false,
  customer: "cus_owned",
  type: "card",
  card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
} as unknown as Stripe.Response<Stripe.PaymentMethod>;
function fixture() {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const retrieveCustomer = vi
    .spyOn(stripe.customers, "retrieve")
    .mockResolvedValue(customer);
  const retrieveMethod = vi
    .spyOn(stripe.paymentMethods, "retrieve")
    .mockResolvedValue(card);
  return {
    stripe,
    retrieveCustomer,
    retrieveMethod,
    provider: new StripeBillingProvider(env, stripe),
  };
}
describe("Stripe billing SDK contract", () => {
  it("creates immutable owned customer metadata without email matching", async () => {
    const { stripe, provider } = fixture();
    const create = vi
      .spyOn(stripe.customers, "create")
      .mockRejectedValueOnce(new Error("lost"))
      .mockResolvedValue(customer);
    await expect(
      provider.createCustomer("reservation", "account"),
    ).rejects.toThrow("lost");
    await provider.createCustomer("reservation", "account");
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
    expect(create.mock.calls[0]).toEqual([
      { metadata: { application: "m8itwork", accountId: "account" } },
      { idempotencyKey: "m8-billing-customer-reservation" },
    ]);
  });
  it("uses setup Checkout only, an owned customer, stable request ID and fixed return origins", async () => {
    const { stripe, provider } = fixture();
    const create = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({
        id: "cs_owned",
        url: "https://checkout.stripe.com/c/setup/fixture",
        customer: "cus_owned",
        livemode: false,
      } as unknown as Stripe.Response<Stripe.Checkout.Session>);
    const retrieve = vi
      .spyOn(stripe.checkout.sessions, "retrieve")
      .mockResolvedValue({
        id: "cs_owned",
        url: "https://checkout.stripe.com/c/setup/fixture",
        mode: "setup",
        status: "open",
        customer: "cus_owned",
        livemode: false,
        metadata: { application: "m8itwork", accountId: "account" },
      } as unknown as Stripe.Response<Stripe.Checkout.Session>);
    await provider.setup("cus_owned", "account", "request");
    await provider.setup("cus_owned", "account", "request");
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
    expect(create.mock.calls[0]![0]).toMatchObject({
      mode: "setup",
      customer: "cus_owned",
      currency: "usd",
      allowed_payment_method_types: ["card"],
      success_url:
        "http://localhost:3120/account?card=returned&session_id={CHECKOUT_SESSION_ID}#payment-methods",
      cancel_url:
        "http://localhost:3120/account?card=cancelled#payment-methods",
    });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("line_items");
    retrieve.mockResolvedValue({
      id: "cs_owned",
      mode: "setup",
      status: "complete",
      customer: "cus_owned",
      livemode: false,
      metadata: { application: "m8itwork", accountId: "account" },
      url: null,
    } as unknown as Stripe.Response<Stripe.Checkout.Session>);
    expect(await provider.setup("cus_owned", "account", "request")).toEqual({
      url: null,
      status: "complete",
    });
    retrieve.mockResolvedValue({
      id: "cs_owned",
      mode: "setup",
      status: "expired",
      customer: "cus_owned",
      livemode: false,
      metadata: { application: "m8itwork", accountId: "account" },
      url: null,
    } as unknown as Stripe.Response<Stripe.Checkout.Session>);
    expect(await provider.setup("cus_owned", "account", "request")).toEqual({
      url: null,
      status: "expired",
    });
  });
  it("requires a completed owned setup session and succeeded setup intent", async () => {
    const { stripe, provider } = fixture();
    const session = {
      customer: "cus_owned",
      livemode: false,
      mode: "setup",
      metadata: { application: "m8itwork", accountId: "account" },
      status: "complete",
      setup_intent: {
        status: "succeeded",
        customer: "cus_owned",
        livemode: false,
      },
    };
    const retrieve = vi
      .spyOn(stripe.checkout.sessions, "retrieve")
      .mockResolvedValue(
        session as unknown as Stripe.Response<Stripe.Checkout.Session>,
      );
    expect(await provider.verifySetup("cs_owned", "cus_owned", "account")).toBe(
      true,
    );
    retrieve.mockResolvedValue({
      ...session,
      status: "open",
    } as unknown as Stripe.Response<Stripe.Checkout.Session>);
    expect(await provider.verifySetup("cs_owned", "cus_owned", "account")).toBe(
      false,
    );
    retrieve.mockResolvedValue({
      ...session,
      customer: "cus_foreign",
    } as unknown as Stripe.Response<Stripe.Checkout.Session>);
    await expect(
      provider.verifySetup("cs_foreign", "cus_owned", "account"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("checks account, mode and cursor ownership and returns only masked card fields", async () => {
    const { stripe, provider, retrieveCustomer, retrieveMethod } = fixture();
    vi.spyOn(stripe.paymentMethods, "list").mockResolvedValue({
      data: [card],
      has_more: true,
    } as unknown as Stripe.Response<Stripe.ApiList<Stripe.PaymentMethod>>);
    expect(await provider.cards("cus_owned", "account")).toEqual({
      cards: [
        {
          id: "pm_owned",
          brand: "visa",
          last4: "4242",
          expMonth: 12,
          expYear: 2030,
        },
      ],
      next: "pm_owned",
    });
    await expect(provider.cards("cus_owned", "foreign")).rejects.toMatchObject({
      statusCode: 404,
    });
    retrieveMethod.mockResolvedValue({ ...card, customer: "cus_foreign" });
    await expect(
      provider.cards("cus_owned", "account", "pm_foreign"),
    ).rejects.toMatchObject({ statusCode: 404 });
    retrieveCustomer.mockResolvedValue({ ...customer, livemode: true });
    await expect(provider.cards("cus_owned", "account")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it("clears a selected default, detaches once, and treats a proven detached retry as complete", async () => {
    const { stripe, provider, retrieveMethod } = fixture();
    const update = vi
        .spyOn(stripe.customers, "update")
        .mockResolvedValue(customer),
      detach = vi
        .spyOn(stripe.paymentMethods, "detach")
        .mockResolvedValue({ ...card, customer: null });
    await provider.authorizeRemoval("cus_owned", "account", "pm_owned");
    await provider.remove("cus_owned", "account", "pm_owned");
    expect(update).toHaveBeenCalledWith("cus_owned", {
      invoice_settings: { default_payment_method: "" },
    });
    expect(detach).toHaveBeenCalledTimes(1);
    retrieveMethod.mockResolvedValue({ ...card, customer: null });
    await provider.remove("cus_owned", "account", "pm_owned");
    expect(detach).toHaveBeenCalledTimes(1);
    await expect(
      provider.authorizeRemoval("cus_owned", "account", "pm_owned"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
