import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3121),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  CLOUDFLARE_PROXY_RANGES: z.string().max(5000).default(""),
  DATABASE_URL: z
    .string()
    .default(
      "postgresql://m8itwork:m8itwork_local@localhost:55434/m8itwork?schema=public",
    ),
  FRONTEND_ORIGIN: z.url().default("http://localhost:3120"),
  ADMIN_ORIGIN: z.url().default("http://localhost:3123"),
  PUBLIC_API_URL: z.url().default("http://localhost:3121"),
  TOKEN_ENCRYPTION_KEY: z.string().default(""),
  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),
  GITHUB_APP_SLUG: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  OPERATOR_GITHUB_IDS: z
    .string()
    .default("")
    .refine(
      (value) =>
        !value ||
        value.split(",").every((id) => /^[1-9][0-9]*$/.test(id.trim())),
      "Use comma-separated GitHub numeric user IDs for operators.",
    ),
});
export type Env = z.infer<typeof schema>;
export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const env = schema.parse(input);
  if (
    Boolean(env.STRIPE_SECRET_KEY) !== Boolean(env.STRIPE_WEBHOOK_SECRET) ||
    (env.STRIPE_SECRET_KEY &&
      (!/^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY) ||
        !env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")))
  )
    throw new Error(
      "Stripe Checkout requires a server secret key and webhook signing secret.",
    );
  const configured = [
    env.GITHUB_CLIENT_ID,
    env.GITHUB_CLIENT_SECRET,
    env.GITHUB_APP_SLUG,
  ].filter(Boolean).length;
  if (
    configured > 0 &&
    (configured !== 3 ||
      Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64").length !== 32)
  ) {
    throw new Error(
      "GitHub App connections require a client ID, secret, slug, and a 32-byte base64 TOKEN_ENCRYPTION_KEY.",
    );
  }
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET))
    throw new Error("Google login requires both its client ID and client secret.");
  if (env.GOOGLE_CLIENT_ID && Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64").length !== 32)
    throw new Error("Google login requires a 32-byte base64 TOKEN_ENCRYPTION_KEY.");
  if (Boolean(env.RESEND_API_KEY) !== Boolean(env.EMAIL_FROM) ||
      (env.EMAIL_FROM && !z.email().safeParse(env.EMAIL_FROM).success))
    throw new Error("Account email requires a Resend API key and a valid EMAIL_FROM address.");
  if (
    env.NODE_ENV === "production" &&
    (!env.FRONTEND_ORIGIN.startsWith("https://") ||
      !env.ADMIN_ORIGIN.startsWith("https://") ||
      !env.PUBLIC_API_URL.startsWith("https://"))
  ) {
    throw new Error("Production customer, admin, and API origins must use HTTPS.");
  }
  return env;
}

export function isAppOrigin(env: Env, origin: string | undefined) {
  return origin === env.FRONTEND_ORIGIN || origin === env.ADMIN_ORIGIN;
}
