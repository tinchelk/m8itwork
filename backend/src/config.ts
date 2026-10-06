import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3121),
  DATABASE_URL: z
    .string()
    .default(
      "postgresql://m8itwork:m8itwork_local@localhost:55434/m8itwork?schema=public",
    ),
  FRONTEND_ORIGIN: z.url().default("http://localhost:3120"),
  PUBLIC_API_URL: z.url().default("http://localhost:3121"),
  TOKEN_ENCRYPTION_KEY: z.string().default(""),
  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),
  GITHUB_APP_SLUG: z.string().default(""),
});
export type Env = z.infer<typeof schema>;
export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const env = schema.parse(input);
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
  if (
    env.NODE_ENV === "production" &&
    (!env.FRONTEND_ORIGIN.startsWith("https://") ||
      !env.PUBLIC_API_URL.startsWith("https://"))
  ) {
    throw new Error("Production frontend and API origins must use HTTPS.");
  }
  return env;
}
