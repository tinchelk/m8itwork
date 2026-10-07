import type { Env } from "./config.js";
import { AppError } from "./shared/errors.js";

export interface AccountEmail {
  to: string;
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD";
  actionUrl: string;
  deliveryId: string;
}
export interface AccountEmailProvider {
  readonly enabled: boolean;
  send(email: AccountEmail): Promise<void>;
}
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export class ResendAccountEmail implements AccountEmailProvider {
  readonly enabled: boolean;
  constructor(private env: Env, private fetcher: typeof fetch = fetch) {
    this.enabled = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  }
  async send(email: AccountEmail) {
    if (!this.enabled) throw new AppError(503, "EMAIL_UNAVAILABLE", "Email signup is being set up. Please try again later.");
    const verify = email.purpose === "VERIFY_EMAIL";
    const title = verify ? "Verify your email" : "Reset your password";
    const detail = verify ? "Confirm your email to open your m8itwork dashboard. This link expires in 24 hours." : "Choose a new password for your m8itwork account. This link expires in 30 minutes.";
    const note = "If you did not request this email, ignore it. Do not share this link.";
    try {
      const response = await this.fetcher("https://api.resend.com/emails", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": email.deliveryId },
        body: JSON.stringify({ from: `m8itwork <${this.env.EMAIL_FROM}>`, to: [email.to], subject: `${title} — m8itwork`,
          text: `${title}\n\n${detail}\n\n${email.actionUrl}\n\n${note}`,
          html: `<div style="background:#0e1c2b;color:#f2f5f4;padding:32px;font-family:Arial,sans-serif;max-width:560px"><strong style="color:#e5af7f">m8itwork.</strong><h1>${title}</h1><p style="line-height:1.6">${detail}</p><p><a style="display:inline-block;background:#e5af7f;color:#14202b;padding:14px 20px;border-radius:8px;text-decoration:none" href="${escape(email.actionUrl)}">${title}</a></p><p style="font-size:13px;color:#b9cbd4">${note}</p></div>` }),
      });
      if (!response.ok) throw new Error("delivery rejected");
      await response.body?.cancel();
    } catch {
      throw new AppError(503, "EMAIL_UNAVAILABLE", "We couldn’t send the account email. Please try again shortly.");
    }
  }
}
