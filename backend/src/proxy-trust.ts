import proxyaddr from "@fastify/proxy-addr";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";
import type { Env } from "./config.js";

export function clientRateLimitKey(env: Pick<Env, "TRUST_PROXY_HOPS" | "CLOUDFLARE_PROXY_RANGES">) {
  const ranges = env.CLOUDFLARE_PROXY_RANGES.split(",")
    .map((range) => range.trim())
    .filter(Boolean);
  for (const range of ranges) {
    const [address, prefix] = range.split("/");
    if (!address || !isIP(address) || !prefix || !/^\d+$/.test(prefix) || range.split("/").length !== 2)
      throw new Error("Cloudflare proxy ranges must contain IP CIDRs.");
  }
  const cloudflare = ranges.length ? proxyaddr.compile(ranges) : () => false;
  // Railway's edge overwrites X-Real-IP with its connecting peer. Its
  // X-Forwarded-For chain retains client-supplied values and is not trusted.
  // Only an actual Cloudflare peer may supply the next visitor address.
  // Enable this configuration only behind Railway's HTTP edge.
  return (request: Pick<FastifyRequest, "ip" | "headers">) => {
    if (!env.TRUST_PROXY_HOPS) return request.ip;
    const peer = request.headers["x-real-ip"];
    if (typeof peer !== "string" || !isIP(peer)) return request.ip;
    const visitor = request.headers["cf-connecting-ip"];
    if (cloudflare(peer, 0) && typeof visitor === "string" && isIP(visitor))
      return visitor;
    return peer;
  };
}
