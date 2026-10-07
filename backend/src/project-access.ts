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
import { financialLock } from "./financial-lock.js";
import { enqueueUpdate, enqueueOperators } from "./notifications.js";

export const terminalStages = ["WITHDRAWN", "DECLINED", "CANCELLED", "CLOSED"];
export function assertWorkAllowed(project: Project) {
  if (terminalStages.includes(project.stage))
    throw new AppError(
      409,
      "PROJECT_TERMINAL",
      "This project is closed. Its history remains available.",
    );
  if (project.cancellationRequestedAt)
    throw new AppError(
      409,
      "CANCELLATION_PENDING",
      "Resolve the cancellation before requesting more work or payment.",
    );
}
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
    if (tx !== prisma) await financialLock(tx);
    const project = await tx.project.findFirst({
      where: { id, ...(operator ? {} : { accountId: account.id }) },
    });
    if (!project)
      throw new AppError(
        404,
        "PROJECT_UNAVAILABLE",
        "This project isn't available to your account.",
      );
    if (
      tx !== prisma &&
      (
        await tx.account.findUnique({
          where: { id: project.accountId },
          select: { closedAt: true },
        })
      )?.closedAt
    )
      throw new AppError(
        409,
        "ACCOUNT_CLOSED",
        "The customer's account is closed. This project is read-only.",
      );
    return project;
  }
  async function touch(
    tx: Prisma.TransactionClient,
    project: Project,
    expected: number,
    data: Prisma.ProjectUpdateManyMutationInput = {},
  ) {
    if (terminalStages.includes(project.stage))
      throw new AppError(
        409,
        "PROJECT_TERMINAL",
        "This project is closed. Its history remains available.",
      );
    if (project.version !== expected) throw projectConflict();
    const result = await tx.project.updateMany({
      where: { id: project.id, version: expected, account: { closedAt: null } },
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
    const event = await tx.projectUpdate.create({
      data: { projectId: id, title, detail, author },
    });
    const project = await tx.project.findUniqueOrThrow({
      where: { id },
      select: { accountId: true },
    });
    await enqueueUpdate(
      tx,
      project.accountId,
      id,
      "PROJECT_UPDATE",
      `update:${event.id}`,
    );
    if (author === "CUSTOMER")
      await enqueueOperators(
        tx,
        env,
        "OPERATOR_CUSTOMER_UPDATE",
        `operator-update:${event.id}`,
        id,
      );
  }
  const notifyOperators = (
    tx: Prisma.TransactionClient,
    kind: string,
    id: string,
    projectId: string,
  ) => enqueueOperators(tx, env, kind, id, projectId);
  return { actor, projectFor, touch, update, notifyOperators };
}
export type ProjectAccess = ReturnType<typeof createProjectAccess>;
export const projectConflict = () =>
  new AppError(
    409,
    "PROJECT_CHANGED",
    "This project changed. Refresh it, check the latest details, and try again. Your input is still here.",
  );
