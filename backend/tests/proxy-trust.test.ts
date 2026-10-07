import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";
import { clientRateLimitKey } from "../src/proxy-trust.js";

const config = { TRUST_PROXY_HOPS: 1, CLOUDFLARE_PROXY_RANGES: "173.245.48.0/20,2400:cb00::/32" };
async function fixture(trust = config) {
  const key = clientRateLimitKey(trust);
  const app = Fastify();
  await app.register(rateLimit, { max: 2, timeWindow: "1 minute", keyGenerator: key });
  app.get("/", async (request) => ({ ip: key(request) }));
  return app;
}

describe("bounded deployment proxies", () => {
  it("keeps direct visitors separate and ignores forged prefixes and Cloudflare headers", async () => {
    const app = await fixture();
    try {
      for (let i = 0; i < 2; i++) {
        const result = await app.inject({ url: "/", remoteAddress: "10.0.0.1", headers: {
          "x-forwarded-for": `${i ? "192.0.2.99" : "192.0.2.98"}, 203.0.113.20`,
          "cf-connecting-ip": `192.0.2.${i + 1}`,
          "x-real-ip": "203.0.113.20",
        } });
        expect(result.json().ip).toBe("203.0.113.20");
      }
      expect((await app.inject({ url: "/", remoteAddress: "10.0.0.1", headers: { "x-real-ip": "203.0.113.20", "x-forwarded-for": "192.0.2.77, 203.0.113.20" } })).statusCode).toBe(429);
      expect((await app.inject({ url: "/", remoteAddress: "10.0.0.1", headers: { "x-real-ip": "203.0.113.21", "x-forwarded-for": "203.0.113.21" } })).statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it("uses the visitor behind a verified Cloudflare peer, with no shared edge limit", async () => {
    const app = await fixture();
    try {
      for (const visitor of ["203.0.113.20", "203.0.113.21"]) {
        for (let i = 0; i < 2; i++) {
          const result = await app.inject({ url: "/", remoteAddress: "10.0.0.1", headers: { "x-real-ip": "173.245.48.20", "cf-connecting-ip": visitor, "x-forwarded-for": `192.0.2.${i}, ${visitor}, 173.245.48.20` } });
          expect(result.statusCode).toBe(200);
          expect(result.json().ip).toBe(visitor);
        }
      }
      expect((await app.inject({ url: "/", remoteAddress: "10.0.0.1", headers: { "x-real-ip": "173.245.48.20", "cf-connecting-ip": "203.0.113.20", "x-forwarded-for": "203.0.113.20, 173.245.48.20" } })).statusCode).toBe(429);
      expect((await app.inject({ url: "/", remoteAddress: "10.0.0.1", headers: { "x-real-ip": "2400:cb00::10", "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "2001:db8::1, 2400:cb00::10" } })).json().ip).toBe("2001:db8::1");
    } finally { await app.close(); }
  });

  it("leaves forwarding untrusted locally and rejects unbounded configuration", async () => {
    const app = await fixture({ TRUST_PROXY_HOPS: 0, CLOUDFLARE_PROXY_RANGES: "" });
    try {
      expect((await app.inject({ url: "/", remoteAddress: "127.0.0.1", headers: { "x-real-ip": "203.0.113.20", "cf-connecting-ip": "203.0.113.20", "x-forwarded-for": "203.0.113.20" } })).json().ip).toBe("127.0.0.1");
    } finally { await app.close(); }
    expect(() => loadEnv({ TRUST_PROXY_HOPS: "2" })).toThrow();
    expect(() => clientRateLimitKey({ ...config, CLOUDFLARE_PROXY_RANGES: "loopback" })).toThrow();
    expect(() => clientRateLimitKey({ ...config, CLOUDFLARE_PROXY_RANGES: "173.245.48.0/33" })).toThrow();
  });
});
