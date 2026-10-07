export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}
export interface CardPage {
  enabled: boolean;
  mode: "test" | "live" | "unconfigured";
  cards: SavedCard[];
  next: string | null;
}
export interface BillingPayment {
  id: string;
  label: string;
  project: { id: string; name: string };
  amountCents: number;
  currency: string;
  mode: string;
  status: string;
  refundedCents: number;
  disputed: boolean;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  receiptUrl: string | null;
  invoiceUrl: string | null;
  invoicePdf: string | null;
}
export interface BillingData {
  enabled: boolean;
  mode: "test" | "live" | "unconfigured";
  totals: {
    currency: string;
    mode: string;
    paidCents: number;
    refundedCents: number;
  }[];
  history: BillingPayment[];
  next: string | null;
  due: {
    id: string;
    label: string;
    amountCents: number;
    currency: string;
    needsReview: boolean;
    processing: boolean;
    project: { id: string; name: string };
  }[];
  dueNext: string | null;
}
export function billingLink(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
