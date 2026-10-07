import type { Prisma } from "@prisma/client";
export const reviewLock = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(814721)::text`;
