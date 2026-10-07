import { assertWorkAllowed } from "./project-access.js";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { projectId, type ProjectAccess } from "./project-access.js";
import { requirePaymentGate } from "./payment-rules.js";
import { AppError } from "./shared/errors.js";
import { accountLabel } from "./accounts.js";
import { financialLock } from "./financial-lock.js";
import { enqueueUpdate } from "./notifications.js";

export async function registerCollaboration(
  app: FastifyInstance,
  {
    prisma,
    access,
    paymentMode,
  }: { prisma: PrismaClient; access: ProjectAccess; paymentMode: () => string },
) {
  const { actor, projectFor, touch } = access;
  for (const team of [false, true]) {
    const prefix = team ? "/v1/operator/projects" : "/v1/projects";
    app.get(`${prefix}/:id/messages`, async (request) => {
      const account = await actor(request, team);
      const project = await projectFor(account, projectId(request), team);
      const { before } = z
        .object({ before: z.uuid().optional() })
        .parse(request.query);
      const cursor = before
        ? await prisma.projectMessage.findFirst({
            where: { id: before, projectId: project.id },
          })
        : null;
      if (before && !cursor)
        throw new AppError(
          400,
          "MESSAGE_CURSOR",
          "Refresh the conversation and try again.",
        );
      const messages = await prisma.projectMessage.findMany({
        where: {
          projectId: project.id,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          authorRole: true,
          authorName: true,
          body: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 51,
      });
      const hasMore = messages.length > 50;
      const page = messages.slice(0, 50).reverse();
      return { messages: page, olderCursor: hasMore ? page[0]!.id : null };
    });
    app.post(`${prefix}/:id/messages`, async (request, reply) => {
      const account = await actor(request, team);
      const input = z
        .object({ id: z.uuid(), body: z.string().trim().min(1).max(5000) })
        .strict()
        .parse(request.body);
      const message = await prisma.$transaction(async (tx) => {
        const id = projectId(request);
        await financialLock(tx);
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const project = await projectFor(account, id, team, tx);
        const existing = await tx.projectMessage.findUnique({
          where: { id: input.id },
        });
        if (existing) {
          if (
            existing.projectId !== project.id ||
            existing.authorId !== account.id ||
            existing.body !== input.body ||
            existing.authorRole !== (team ? "TEAM" : "CUSTOMER")
          )
            throw new AppError(
              409,
              "MESSAGE_ID_CONFLICT",
              "This message changed. Refresh and send it again.",
            );
          return existing;
        }
        const created = await tx.projectMessage.upsert({
          where: { id: input.id },
          update: {},
          create: {
            id: input.id,
            projectId: project.id,
            authorId: account.id,
            authorRole: team ? "TEAM" : "CUSTOMER",
            authorName: accountLabel(account),
            body: input.body,
          },
        });
        if (
          created.projectId !== project.id ||
          created.authorId !== account.id ||
          created.body !== input.body ||
          created.authorRole !== (team ? "TEAM" : "CUSTOMER")
        )
          throw new AppError(
            409,
            "MESSAGE_ID_CONFLICT",
            "This message changed. Refresh and send it again.",
          );
        await tx.project.updateMany({
          where: {
            id: project.id,
            [team ? "teamLastMessageAt" : "customerLastMessageAt"]: {
              lt: created.createdAt,
            },
          },
          data: {
            [team ? "teamLastMessageAt" : "customerLastMessageAt"]:
              created.createdAt,
          },
        });
        await tx.project.updateMany({
          where: {
            id: project.id,
            [team ? "teamLastMessageAt" : "customerLastMessageAt"]: null,
          },
          data: {
            [team ? "teamLastMessageAt" : "customerLastMessageAt"]:
              created.createdAt,
          },
        });
        if (team) await enqueueUpdate(tx, project.accountId, project.id, "TEAM_REPLY", `message:${created.id}`);
        else await access.notifyOperators(tx, "OPERATOR_CUSTOMER_REPLY", `operator-message:${created.id}`, project.id);
        return created;
      });
      return reply.code(201).send({ id: message.id });
    });
    app.post(`${prefix}/:id/messages/read`, async (request) => {
      const account = await actor(request, team);
      const input = z
        .object({ messageId: z.uuid() })
        .strict()
        .parse(request.body);
      const project = await projectFor(account, projectId(request), team);
      const message = await prisma.projectMessage.findFirst({
        where: { id: input.messageId, projectId: project.id },
      });
      if (!message)
        throw new AppError(
          404,
          "MESSAGE_UNAVAILABLE",
          "This message isn't available.",
        );
      const field = team ? "teamReadAt" : "customerReadAt";
      await prisma.project.updateMany({
        where: {
          id: project.id,
          OR: [{ [field]: null }, { [field]: { lt: message.createdAt } }],
        },
        data: { [field]: message.createdAt },
      });
      return { read: true };
    });
  }
  app.post("/v1/operator/projects/:id/notes", async (request, reply) => {
    const account = await actor(request, true);
    const input = z
      .object({ id: z.uuid(), body: z.string().trim().min(1).max(5000) })
      .strict()
      .parse(request.body);
    const note = await prisma.$transaction(async (tx) => {
      const id = projectId(request);
      await financialLock(tx);
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const project = await projectFor(account, id, true, tx);
      const saved = await tx.teamNote.upsert({
        where: { id: input.id },
        update: {},
        create: {
          ...input,
          projectId: project.id,
          authorName: accountLabel(account),
        },
      });
      if (
        saved.projectId !== project.id ||
        saved.authorName !== accountLabel(account) ||
        saved.body !== input.body
      )
        throw new AppError(
          409,
          "NOTE_ID_CONFLICT",
          "Please refresh before saving this note.",
        );
      return saved;
    });
    return reply.code(201).send({ id: note.id });
  });
  const taskFields = {
    title: z.string().trim().min(3).max(160),
    detail: z.string().trim().min(10).max(3000),
  };
  app.post("/v1/operator/projects/:id/work", async (request, reply) => {
    const account = await actor(request, true);
    const input = z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        ...taskFields,
      })
      .strict()
      .parse(request.body);
    const result = await prisma.$transaction(async (tx) => {
      const project = await projectFor(account, projectId(request), true, tx);
      const existing = await tx.workItem.findUnique({
        where: { id: input.id },
      });
      if (
        existing &&
        existing.projectId === project.id &&
        existing.title === input.title &&
        existing.detail === input.detail
      )
        return { id: existing.id };
      if (existing)
        throw new AppError(
          409,
          "WORK_ID_CONFLICT",
          "Refresh before adding this work item.",
        );
      assertWorkAllowed(project);
      if (!["APPROVED", "BUILDING", "VERIFYING"].includes(project.stage))
        throw new AppError(
          409,
          "APPROVAL_REQUIRED",
          "Agree the scope before adding the delivery checklist.",
        );
      await touch(tx, project, input.version);
      const item = await tx.workItem.create({
        data: {
          id: input.id,
          projectId: project.id,
          title: input.title,
          detail: input.detail,
        },
      });
      await access.update(tx, project.id, "Delivery item added", input.title);
      return { id: item.id };
    });
    return reply.code(201).send(result);
  });
  app.post("/v1/operator/projects/:id/work/:itemId", async (request) => {
    const account = await actor(request, true);
    const { itemId } = z
      .object({ itemId: z.uuid() })
      .passthrough()
      .parse(request.params);
    const input = z
      .object({
        version: z.number().int().positive(),
        status: z.enum(["TODO", "DOING", "BLOCKED", "DONE"]),
        evidence: z.string().trim().max(3000).optional(),
        evidenceUrl: z
          .union([
            z.literal(""),
            z
              .url()
              .max(500)
              .refine((value) => {
                const url = new URL(value);
                return (
                  ["https:", "http:"].includes(url.protocol) &&
                  !url.username &&
                  !url.password
                );
              }),
          ])
          .optional(),
      })
      .strict()
      .parse(request.body);
    return prisma.$transaction(async (tx) => {
      const project = await projectFor(account, projectId(request), true, tx);
      assertWorkAllowed(project);
      if (!["APPROVED", "BUILDING", "VERIFYING"].includes(project.stage))
        throw new AppError(
          409,
          "WORK_STAGE",
          "Update the checklist during agreed delivery.",
        );
      const item = await tx.workItem.findFirst({
        where: { id: itemId, projectId: project.id },
      });
      if (!item)
        throw new AppError(
          404,
          "WORK_UNAVAILABLE",
          "This work item isn't available.",
        );
      await touch(tx, project, input.version);
      if (["DOING", "DONE"].includes(input.status)) {
        if (project.stage === "APPROVED")
          throw new AppError(
            409,
            "WORK_STAGE",
            "Start the building stage before doing delivery work.",
          );
        await requirePaymentGate(
          tx,
          project.currentProposalId!,
          "BEFORE_BUILD",
          paymentMode(),
        );
      }
      if (input.status === "DONE" && (input.evidence?.length ?? 0) < 10)
        throw new AppError(
          400,
          "WORK_EVIDENCE_REQUIRED",
          "Record the checks and result before marking this item done.",
        );
      await tx.workItem.update({
        where: { id: item.id },
        data: {
          status: input.status,
          evidence: input.evidence || null,
          evidenceUrl: input.evidenceUrl || null,
        },
      });
      await access.update(
        tx,
        project.id,
        `${input.status === "DONE" ? "Verified" : "Work updated"}: ${item.title}`,
        input.evidence || `Delivery status: ${input.status.toLowerCase()}.`,
      );
      return { saved: true };
    });
  });
}
