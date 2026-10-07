import type { Account, Prisma, PrismaClient } from "@prisma/client";
import { hash } from "./crypto.js";
import { AppError } from "./shared/errors.js";
export const identityKey = (kind: string, value: string) =>
  hash(`${kind}:${kind === "email" ? value.trim().toLowerCase() : value}`);
export async function assertIdentityOpen(
  tx: Prisma.TransactionClient | PrismaClient,
  kind: string,
  value: string,
) {
  if (
    await tx.closedIdentity.findUnique({
      where: { id: identityKey(kind, value) },
    })
  )
    throw new AppError(
      403,
      "ACCOUNT_CLOSED",
      "This account is closed. Contact hello@m8itwork.com for help.",
    );
}
export async function retireIdentities(
  tx: Prisma.TransactionClient,
  account: Pick<Account, "id" | "email" | "githubId" | "googleId">,
) {
  for (const kind of ["email", "githubId", "googleId"] as const)
    if (account[kind])
      await tx.closedIdentity.upsert({
        where: { id: identityKey(kind, account[kind]) },
        update: {},
        create: { id: identityKey(kind, account[kind]), accountId: account.id },
      });
}
