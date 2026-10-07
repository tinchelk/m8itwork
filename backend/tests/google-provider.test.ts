import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { GoogleOidcProvider } from "../src/google-provider.js";
import { loadEnv } from "../src/config.js";
import { hash } from "../src/crypto.js";

describe("Google signed identity boundary", () => {
  const env = loadEnv({ GOOGLE_CLIENT_ID: "m8itwork-web", GOOGLE_CLIENT_SECRET: "fixture", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64") });
  let key: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"], publicKey: ReturnType<typeof createLocalJWKSet>;
  const nonce = "n".repeat(43);
  beforeAll(async () => { const pair = await generateKeyPair("RS256"); key = pair.privateKey; publicKey = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "fixture", alg: "RS256" }] }); });
  async function jwt(changes: Record<string, unknown> = {}) {
    return new SignJWT({ sub: "google-subject", email: "Builder@example.invalid", email_verified: true, nonce, name: "Builder", iss: "https://accounts.google.com", aud: env.GOOGLE_CLIENT_ID, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...changes }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(key);
  }
  it("validates the identity and sends exact server callback and PKCE verifier", async () => {
    let body: URLSearchParams | undefined;
    const token = await jwt();
    const provider = new GoogleOidcProvider(env, async (_url, options) => { body = options?.body as URLSearchParams; return Response.json({ id_token: token }); }, publicKey);
    expect(await provider.exchange({ code: "fixture-code", verifier: "fixture-verifier", nonceHash: hash(nonce) })).toEqual({ id: "google-subject", email: "builder@example.invalid", name: "Builder", mailboxAuthoritative: false });
    expect(body!.get("redirect_uri")).toBe("http://localhost:3121/v1/auth/google/callback"); expect(body!.get("code_verifier")).toBe("fixture-verifier");
  });
  it.each([{ aud: "another-app" }, { iss: "https://attacker.invalid" }, { exp: 1 }, { email_verified: false }, { nonce: "x".repeat(43) }])("rejects invalid identity claims %j", async changes => {
    const token = await jwt(changes), provider = new GoogleOidcProvider(env, async () => Response.json({ id_token: token }), publicKey);
    await expect(provider.exchange({ code: "fixture", verifier: "fixture", nonceHash: hash(nonce) })).rejects.toMatchObject({ code: "GOOGLE_SIGN_IN" });
  });
  it.each([{ email: "builder@gmail.com" }, { hd: "example.invalid" }])("trusts only Google-hosted mailboxes for bootstrap %j", async changes => {
    const token = await jwt(changes), provider = new GoogleOidcProvider(env, async () => Response.json({ id_token: token }), publicKey);
    expect((await provider.exchange({ code: "fixture", verifier: "fixture", nonceHash: hash(nonce) })).mailboxAuthoritative).toBe(true);
  });
});
