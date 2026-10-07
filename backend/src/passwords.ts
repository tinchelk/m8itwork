import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP's 32 MiB scrypt profile, with three passes. Bound password size at the route.
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, parameters, (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$32768$8$3$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split("$");
  const valid = parts?.length === 6 && parts.slice(0, 4).join("$") === "scrypt$32768$8$3" &&
    /^[A-Za-z0-9_-]{22}$/.test(parts[4]!) && /^[A-Za-z0-9_-]{43}$/.test(parts[5]!);
  const salt = valid ? Buffer.from(parts[4]!, "base64url") : Buffer.alloc(16, 4);
  const expected = valid ? Buffer.from(parts[5]!, "base64url") : Buffer.alloc(32, 7);
  const result = await derive(password, salt);
  return timingSafeEqual(result, expected) && Boolean(valid);
}
