import type { Account, Prisma, PrismaClient } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "./config.js";
import { hash } from "./crypto.js";
import { AppError } from "./shared/errors.js";

export const ACCOUNT_COOKIE = "m8_account_session";
export const ACCOUNT_TTL = 30 * 24 * 60 * 60;

export function cookieHash(request: FastifyRequest): string | undefined {
  const raw = request.cookies[ACCOUNT_COOKIE];
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? hash(raw) : undefined;
}
export async function accountFromRequest(
  prisma: PrismaClient | Prisma.TransactionClient,
  request: FastifyRequest,
): Promise<Account | null> {
  const id = cookieHash(request);
  if (!id) return null;
  const session = await prisma.accountSession.findUnique({
    where: { id },
    include: { account: true },
  });
  return session && session.expiresAt > new Date() && !session.account.closedAt
    ? session.account
    : null;
}
export async function requireAccount(
  prisma: PrismaClient | Prisma.TransactionClient,
  request: FastifyRequest,
): Promise<Account> {
  const account = await accountFromRequest(prisma, request);
  if (!account)
    throw new AppError(
      401,
      "SIGN_IN_REQUIRED",
      "Sign in to see your projects. Your workspace is saved.",
    );
  return account;
}
export function isOperator(account: Account, env: Env): boolean {
  return (
    !account.closedAt &&
    Boolean(account.githubId) &&
    env.OPERATOR_GITHUB_IDS.split(",")
      .map((id) => id.trim())
      .includes(account.githubId!)
  );
}
export function assertAccountOpen(account: Account) {
  if (account.closedAt)
    throw new AppError(
      403,
      "ACCOUNT_CLOSED",
      "This account is closed. Contact hello@m8itwork.com for help.",
    );
}
export function accountLabel(account: Account): string {
  return (
    account.displayName || account.githubLogin || account.email || "Customer"
  );
}
export function setAccountCookie(reply: FastifyReply, raw: string, env: Env) {
  reply.setCookie(ACCOUNT_COOKIE, raw, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCOUNT_TTL,
  });
}
