import Stripe from "stripe";
import type { Env } from "./config.js";
import { AppError } from "./shared/errors.js";

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}
export interface BillingProvider {
  enabled: boolean;
  mode: "test" | "live" | "unconfigured";
  createCustomer(reservationId: string, accountId: string): Promise<string>;
  cards(
    customerId: string,
    accountId: string,
    after?: string,
  ): Promise<{ cards: SavedCard[]; next: string | null }>;
  setup(
    customerId: string,
    accountId: string,
    requestId: string,
  ): Promise<{ url: string | null; status: "open" | "complete" | "expired" }>;
  verifySetup(
    sessionId: string,
    customerId: string,
    accountId: string,
  ): Promise<boolean>;
  authorizeRemoval(
    customerId: string,
    accountId: string,
    methodId: string,
  ): Promise<void>;
  remove(
    customerId: string,
    accountId: string,
    methodId: string,
  ): Promise<void>;
}
const unavailable = () =>
  new AppError(
    404,
    "BILLING_UNAVAILABLE",
    "This billing record isn't available to your account.",
  );
export class StripeBillingProvider implements BillingProvider {
  readonly enabled: boolean;
  readonly mode: BillingProvider["mode"];
  private client: Stripe | null;
  constructor(
    private env: Env,
    client?: Stripe,
  ) {
    this.enabled = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
    this.mode = !this.enabled
      ? "unconfigured"
      : env.STRIPE_SECRET_KEY.startsWith("sk_live_")
        ? "live"
        : "test";
    this.client = this.enabled
      ? (client ??
        new Stripe(env.STRIPE_SECRET_KEY, {
          timeout: 10_000,
          maxNetworkRetries: 1,
        }))
      : null;
  }
  private stripe() {
    if (!this.client)
      throw new AppError(
        503,
        "BILLING_SETUP_REQUIRED",
        "Card management is unavailable right now. Contact hello@m8itwork.com for billing help.",
      );
    return this.client;
  }
  private async customer(customerId: string, accountId: string) {
    const customer = await this.stripe().customers.retrieve(customerId);
    if (
      customer.deleted ||
      customer.livemode !== (this.mode === "live") ||
      customer.metadata.application !== "m8itwork" ||
      customer.metadata.accountId !== accountId
    )
      throw unavailable();
    return customer;
  }
  private async method(customerId: string, methodId: string) {
    const method = await this.stripe().paymentMethods.retrieve(methodId);
    const owner =
      typeof method.customer === "string"
        ? method.customer
        : method.customer?.id;
    if (
      owner !== customerId ||
      method.livemode !== (this.mode === "live") ||
      method.type !== "card" ||
      !method.card
    )
      throw unavailable();
    return method;
  }
  async createCustomer(reservationId: string, accountId: string) {
    // No email-based matching and no mutable contact values in the creation key.
    const customer = await this.stripe().customers.create(
      { metadata: { application: "m8itwork", accountId } },
      { idempotencyKey: `m8-billing-customer-${reservationId}` },
    );
    if (
      customer.livemode !== (this.mode === "live") ||
      customer.metadata.accountId !== accountId ||
      customer.metadata.application !== "m8itwork"
    )
      throw unavailable();
    return customer.id;
  }
  async cards(customerId: string, accountId: string, after?: string) {
    await this.customer(customerId, accountId);
    if (after) await this.method(customerId, after);
    const page = await this.stripe().paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: 20,
      ...(after ? { starting_after: after } : {}),
    });
    const cards = page.data.map((method) => {
      if (
        (typeof method.customer === "string"
          ? method.customer
          : method.customer?.id) !== customerId ||
        method.livemode !== (this.mode === "live") ||
        !method.card
      )
        throw unavailable();
      return {
        id: method.id,
        brand: method.card.brand,
        last4: method.card.last4,
        expMonth: method.card.exp_month,
        expYear: method.card.exp_year,
      };
    });
    return { cards, next: page.has_more ? (cards.at(-1)?.id ?? null) : null };
  }
  async setup(
    customerId: string,
    accountId: string,
    requestId: string,
  ): ReturnType<BillingProvider["setup"]> {
    await this.customer(customerId, accountId);
    const created = await this.stripe().checkout.sessions.create(
      {
        mode: "setup",
        ui_mode: "hosted_page",
        customer: customerId,
        managed_payments: { enabled: false },
        currency: "usd",
        allowed_payment_method_types: ["card"],
        metadata: { application: "m8itwork", accountId },
        setup_intent_data: { metadata: { application: "m8itwork", accountId } },
        success_url: `${this.env.FRONTEND_ORIGIN}/account?card=returned&session_id={CHECKOUT_SESSION_ID}#payment-methods`,
        cancel_url: `${this.env.FRONTEND_ORIGIN}/account?card=cancelled#payment-methods`,
      },
      { idempotencyKey: `m8-card-setup-${customerId}-${requestId}` },
    );
    // Creation can replay a cached open response after the customer completed
    // Checkout but missed its return. Reconcile before deciding to reuse it.
    const session = await this.stripe().checkout.sessions.retrieve(created.id);
    const owner =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;
    if (
      session.mode !== "setup" ||
      owner !== customerId ||
      session.livemode !== (this.mode === "live") ||
      session.metadata?.application !== "m8itwork" ||
      session.metadata?.accountId !== accountId ||
      !session.status
    )
      throw unavailable();
    if (session.status === "open" && !session.url) throw unavailable();
    if (session.status === "complete")
      return { url: session.url, status: "complete" };
    if (session.status === "expired")
      return { url: session.url, status: "expired" };
    if (session.status === "open") return { url: session.url, status: "open" };
    throw unavailable();
  }
  async verifySetup(sessionId: string, customerId: string, accountId: string) {
    await this.customer(customerId, accountId);
    const session = await this.stripe().checkout.sessions.retrieve(sessionId, {
      expand: ["setup_intent"],
    });
    const owner =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;
    if (
      session.mode !== "setup" ||
      owner !== customerId ||
      session.livemode !== (this.mode === "live") ||
      session.metadata?.application !== "m8itwork" ||
      session.metadata?.accountId !== accountId
    )
      throw unavailable();
    const intent =
      typeof session.setup_intent === "object" ? session.setup_intent : null;
    if (
      session.status !== "complete" ||
      !intent ||
      intent.status !== "succeeded"
    )
      return false;
    const intentOwner =
      typeof intent.customer === "string"
        ? intent.customer
        : intent.customer?.id;
    if (
      intentOwner !== customerId ||
      intent.livemode !== (this.mode === "live")
    )
      throw unavailable();
    return true;
  }
  async authorizeRemoval(
    customerId: string,
    accountId: string,
    methodId: string,
  ) {
    await this.customer(customerId, accountId);
    await this.method(customerId, methodId);
  }
  async remove(customerId: string, accountId: string, methodId: string) {
    const customer = await this.customer(customerId, accountId);
    // The API records verified ownership before calling this method. A detached
    // card can therefore complete a retry after Stripe's response was lost.
    const current = await this.stripe().paymentMethods.retrieve(methodId);
    if (
      current.customer === null &&
      current.livemode === (this.mode === "live") &&
      current.type === "card"
    )
      return;
    await this.method(customerId, methodId);
    const defaultMethod = customer.invoice_settings.default_payment_method;
    if (
      (typeof defaultMethod === "string"
        ? defaultMethod
        : defaultMethod?.id) === methodId
    ) {
      await this.stripe().customers.update(customerId, {
        invoice_settings: { default_payment_method: "" },
      });
    }
    await this.stripe().paymentMethods.detach(
      methodId,
      {},
      { idempotencyKey: `m8-card-remove-${customerId}-${methodId}` },
    );
  }
}
