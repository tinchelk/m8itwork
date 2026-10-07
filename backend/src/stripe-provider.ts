import Stripe from "stripe";
import type { Env } from "./config.js";
import { AppError } from "./shared/errors.js";

export interface Checkout {
  id: string;
  url: string | null;
  status: string;
  paid: boolean;
  amountCents: number;
  currency: string;
  live: boolean;
  attemptId: string;
  paymentIntentId: string | null;
  refundedCents: number;
  receiptUrl: string | null;
  disputed?: boolean;
  observedAt?: number;
  customerId?: string | null;
  invoiceUrl?: string | null;
  invoicePdf?: string | null;
}
export interface CheckoutInput {
  attemptId: string;
  projectId: string;
  projectName: string;
  label: string;
  amountCents: number;
  currency: string;
  email: string;
  customerId?: string;
}
export interface PaymentProvider {
  enabled: boolean;
  mode: "test" | "live" | "unconfigured";
  create(input: CheckoutInput): Promise<Checkout>;
  retrieve(id: string): Promise<Checkout>;
  expire(id: string): Promise<void>;
  verify(raw: Buffer, signature: string): Stripe.Event;
  dispute(
    id: string,
  ): Promise<{ paymentIntentId: string | null; held: boolean }>;
  resolveIntent?(id: string): Promise<{ attemptId: string | null; sessionId: string | null }>;
}
export class StripeProvider implements PaymentProvider {
  readonly enabled: boolean;
  readonly mode: PaymentProvider["mode"];
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
        "PAYMENT_SETUP_REQUIRED",
        "Payment collection is being set up. Your agreement is saved; contact the team in this project.",
      );
    return this.client;
  }
  private normalize(session: Stripe.Checkout.Session): Checkout {
    const intent =
      session.payment_intent && typeof session.payment_intent !== "string"
        ? session.payment_intent
        : null;
    const charge =
      intent?.latest_charge && typeof intent.latest_charge !== "string"
        ? intent.latest_charge
        : null;
    const invoice = session.invoice && typeof session.invoice !== "string" ? session.invoice : null;
    return {
      id: session.id,
      url: session.url,
      status: session.status ?? "open",
      paid: session.payment_status === "paid",
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? "",
      live: session.livemode,
      attemptId: session.metadata?.attemptId ?? "",
      paymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (intent?.id ?? null),
      refundedCents: charge?.amount_refunded ?? 0,
      receiptUrl: charge?.receipt_url ?? null,
      customerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      invoiceUrl: invoice?.hosted_invoice_url ?? null,
      invoicePdf: invoice?.invoice_pdf ?? null,
    };
  }
  async create(input: CheckoutInput) {
    const origin = this.env.FRONTEND_ORIGIN;
    const session = await this.stripe().checkout.sessions.create(
      {
        mode: "payment",
        managed_payments: { enabled: false },
        ui_mode: "hosted_page",
        allowed_payment_method_types: ["card"],
        ...(input.customerId ? { customer: input.customerId, invoice_creation: { enabled: true, invoice_data: { metadata: { attemptId: input.attemptId } } }, saved_payment_method_options: { payment_method_save: "enabled" as const } } : input.email ? { customer_email: input.email } : {}),
        adaptive_pricing: { enabled: false },
        allow_promotion_codes: false,
        client_reference_id: input.projectId,
        metadata: { attemptId: input.attemptId },
        payment_intent_data: { metadata: { attemptId: input.attemptId } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountCents,
              product_data: {
                name: `m8itwork · ${input.projectName} · ${input.label}`,
              },
            },
          },
        ],
        success_url: `${origin}/dashboard?project=${input.projectId}&payment=returned`,
        cancel_url: `${origin}/dashboard?project=${input.projectId}&payment=cancelled`,
      },
      { idempotencyKey: `m8-checkout-${input.attemptId}` },
    );
    return this.normalize(session);
  }
  async retrieve(id: string) {
    // Fence snapshots started before a newer reconciliation transaction.
    const observedAt = Date.now();
    const session = await this.stripe().checkout.sessions.retrieve(id, {
      expand: ["payment_intent.latest_charge", "invoice"],
    });
    const checkout = this.normalize(session);
    if (checkout.paid && checkout.paymentIntentId) {
      const disputes = await this.stripe().disputes.list({
        payment_intent: checkout.paymentIntentId,
        limit: 100,
      });
      // Pagination or missing charge details must not silently clear a hold.
      const intent =
        typeof session.payment_intent === "object"
          ? session.payment_intent
          : null;
      const charge =
        typeof intent?.latest_charge === "object" ? intent.latest_charge : null;
      checkout.disputed =
        disputes.has_more ||
        disputes.data.some(
          (dispute) => !["won", "warning_closed"].includes(dispute.status),
        ) ||
        Boolean(charge?.disputed && !disputes.data.length);
      checkout.observedAt = observedAt;
    }
    return checkout;
  }
  async expire(id: string) {
    await this.stripe().checkout.sessions.expire(id);
  }
  verify(raw: Buffer, signature: string) {
    try {
      return this.stripe().webhooks.constructEvent(
        raw,
        signature,
        this.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        400,
        "INVALID_PAYMENT_SIGNATURE",
        "Payment event signature is invalid.",
      );
    }
  }
  async dispute(id: string) {
    const dispute = await this.stripe().disputes.retrieve(id);
    return {
      paymentIntentId:
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : (dispute.payment_intent?.id ?? null),
      held: !["won", "warning_closed"].includes(dispute.status),
    };
  }
  async resolveIntent(id: string) {
    const intent = await this.stripe().paymentIntents.retrieve(id);
    const attemptId = intent.metadata?.attemptId ?? null;
    if (!attemptId) return { attemptId: null, sessionId: null };
    const sessions = await this.stripe().checkout.sessions.list({ payment_intent: id, limit: 2 });
    if (sessions.has_more || sessions.data.length !== 1)
      throw new AppError(409, "PAYMENT_IDENTITY_UNCERTAIN", "The payment needs an operator identity check.");
    return { attemptId, sessionId: sessions.data[0]!.id };
  }
}
