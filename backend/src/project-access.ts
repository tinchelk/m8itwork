import {
  Prisma,
  type Account,
  type PrismaClient,
  type Project,
} from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { isOperator, requireAccount } from "./accounts.js";
import type { Env } from "./config.js";
import { AppError } from "./shared/errors.js";

export const projectId = (request: FastifyRequest) =>
  z.object({ id: z.uuid() }).passthrough().parse(request.params).id;
export function createProjectAccess(prisma: PrismaClient, env: Env) {
  async function actor(
    request: FastifyRequest,
    operator = false,
  ): Promise<Account> {
    const account = await requireAccount(prisma, request);
    if (operator && !isOperator(account, env))
      throw new AppError(
        403,
        "OPERATOR_REQUIRED",
        "This area is for the project team.",
      );
    return account;
  }
  async function projectFor(
    account: Account,
    id: string,
    operator = false,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const project = await tx.project.findFirst({
      where: { id, ...(operator ? {} : { accountId: account.id }) },
    });
    if (!project)
      throw new AppError(
        404,
        "PROJECT_UNAVAILABLE",
        "This project isn't available to your account.",
      );
    return project;
  }
  async function touch(
    tx: Prisma.TransactionClient,
    project: Project,
    expected: number,
    data: Prisma.ProjectUpdateManyMutationInput = {},
  ) {
    if (project.version !== expected) throw projectConflict();
    const result = await tx.project.updateMany({
      where: { id: project.id, version: expected },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count !== 1) throw projectConflict();
  }
  async function update(
    tx: Prisma.TransactionClient,
    id: string,
    title: string,
    detail: string,
    author = "TEAM",
  ) {
    await tx.projectUpdate.create({
      data: { projectId: id, title, detail, author },
    });
  }
  return { actor, projectFor, touch, update };
}
export type ProjectAccess = ReturnType<typeof createProjectAccess>;
export const projectConflict = () =>
  new AppError(
    409,
    "PROJECT_CHANGED",
    "This project changed. Refresh it, check the latest details, and try again. Your input is still here.",
  );
