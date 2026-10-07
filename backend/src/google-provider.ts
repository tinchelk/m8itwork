import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { Env } from "./config.js";
import { AppError } from "./shared/errors.js";

export interface GoogleIdentity { id: string; email: string; name: string | null; mailboxAuthoritative: boolean }
export interface GoogleProvider {
  exchange(input: { code: string; verifier: string; nonceHash: string }): Promise<GoogleIdentity>;
}
import { hash } from "./crypto.js";
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 5_000 });
export class GoogleOidcProvider implements GoogleProvider {
  constructor(private env: Env, private fetcher: typeof fetch = fetch, private verificationKeys: JWTVerifyGetKey = keys) {}
  async exchange(input: { code: string; verifier: string; nonceHash: string }): Promise<GoogleIdentity> {
    try {
      const response = await this.fetcher("https://oauth2.googleapis.com/token", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET,
          code: input.code, code_verifier: input.verifier, grant_type: "authorization_code",
          redirect_uri: `${this.env.PUBLIC_API_URL}/v1/auth/google/callback` }),
      });
      if (!response.ok) throw new Error("exchange rejected");
      const { id_token } = z.object({ id_token: z.string().max(16_000) }).parse(await response.json());
      const { payload } = await jwtVerify(id_token, this.verificationKeys, {
        algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: this.env.GOOGLE_CLIENT_ID, maxTokenAge: "1h", clockTolerance: 5,
        requiredClaims: ["sub", "exp", "iat", "nonce", "email", "email_verified"],
      });
      const identity = z.object({ sub: z.string().min(1).max(255), email: z.email().max(254), email_verified: z.literal(true),
        nonce: z.string().min(40).max(100), name: z.string().max(100).optional(), hd: z.string().min(1).max(253).optional() }).parse(payload);
      if (hash(identity.nonce) !== input.nonceHash) throw new Error("nonce mismatch");
      const email = identity.email.toLowerCase();
      return { id: identity.sub, email, name: identity.name ?? null, mailboxAuthoritative: email.endsWith("@gmail.com") || Boolean(identity.hd) };
    } catch {
      throw new AppError(400, "GOOGLE_SIGN_IN", "Google sign-in wasn’t completed. Please try again.");
    }
  }
}
