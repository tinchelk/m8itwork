import { Prisma, type Account, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAccount } from "./accounts.js";
import type { BillingProvider } from "./billing-provider.js";
import type { Env } from "./config.js";
import { paidInMode } from "./payment-rules.js";
import { AppError } from "./shared/errors.js";

const methodIdSchema = z
  .string()
  .regex(/^pm_[a-zA-Z0-9_]+$/)
  .max(200);
const sessionIdSchema = z
  .string()
  .regex(/^cs_[a-zA-Z0-9_]+$/)
  .max(200);
const unavailable = () =>
  new AppError(
    404,
    "BILLING_UNAVAILABLE",
    "This billing record isn't available to your account.",
  );
export function stripeLink(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export async function registerBilling(
  app: FastifyInstance,
  {
    prisma,
    provider,
    env,
  }: { prisma: PrismaClient; provider: BillingProvider; env: Env },
) {
  const ensureEnabled = () => {
    if (!provider.enabled)
      throw new AppError(
        503,
        "BILLING_SETUP_REQUIRED",
        "Card management is unavailable right now. Contact hello@m8itwork.com for billing help.",
      );
  };
  async function actor(request: FastifyRequest) {
    if (
      request.method === "POST" &&
      request.headers.origin !== env.FRONTEND_ORIGIN
    )
      throw new AppError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "Request origin is not allowed.",
      );
    return requireAccount(prisma, request);
  }
  async function customer(account: Account) {
    ensureEnabled();
    const row = await prisma.billingCustomer.upsert({
      where: { accountId_mode: { accountId: account.id, mode: provider.mode } },
      create: { accountId: account.id, mode: provider.mode },
      update: {},
    });
    if (row.stripeCustomerId) return row.stripeCustomerId;
    if (Date.now() - row.createdAt.getTime() > 23 * 3600_000)
      throw new AppError(
        409,
        "BILLING_RECOVERY_REQUIRED",
        "Your billing profile needs a team check before continuing. Contact hello@m8itwork.com; no payment has been taken.",
      );
    const id = await provider.createCustomer(row.id, account.id);
    await prisma.billingCustomer.updateMany({
      where: { id: row.id, stripeCustomerId: null },
      data: { stripeCustomerId: id },
    });
    const saved = await prisma.billingCustomer.findUniqueOrThrow({
      where: { id: row.id },
    });
    if (saved.stripeCustomerId !== id) throw unavailable();
    return id;
  }
  async function existing(account: Account) {
    ensureEnabled();
    return (
      await prisma.billingCustomer.findUnique({
        where: {
          accountId_mode: { accountId: account.id, mode: provider.mode },
        },
      })
    )?.stripeCustomerId;
  }
  app.get("/v1/billing/cards", async (request) => {
    const account = await actor(request);
    const { after } = z
      .object({ after: methodIdSchema.optional() })
      .parse(request.query);
    if (!provider.enabled)
      return { enabled: false, mode: provider.mode, cards: [], next: null };
    const id = await existing(account);
    if (!id)
      return { enabled: true, mode: provider.mode, cards: [], next: null };
    return {
      enabled: true,
      mode: provider.mode,
      ...(await provider.cards(id, account.id, after)),
    };
  });
  app.post("/v1/billing/cards/setup", async (request) => {
    const account = await actor(request);
    const { requestId } = z
      .object({ requestId: z.uuid() })
      .strict()
      .parse(request.body);
    const setup = await provider.setup(
      await customer(account),
      account.id,
      requestId,
    );
    if (setup.status !== "open") return { finished: true };
    const url = stripeLink(setup.url);
    if (!url || new URL(url).hostname !== "checkout.stripe.com")
      throw new AppError(
        502,
        "BILLING_URL",
        "The secure card page couldn't be opened. Please retry.",
      );
    return { url };
  });
  app.post("/v1/billing/cards/verify", async (request) => {
    const account = await actor(request);
    const { sessionId } = z
      .object({ sessionId: sessionIdSchema })
      .strict()
      .parse(request.body);
    const id = await existing(account);
    if (!id) throw unavailable();
    return { saved: await provider.verifySetup(sessionId, id, account.id) };
  });
  app.post("/v1/billing/cards/:methodId/remove", async (request) => {
    const account = await actor(request);
    z.object({}).strict().parse(request.body);
    const { methodId } = z
      .object({ methodId: methodIdSchema })
      .parse(request.params);
    const id = await existing(account);
    if (!id) throw unavailable();
    const profile = await prisma.billingCustomer.findUniqueOrThrow({
      where: { accountId_mode: { accountId: account.id, mode: provider.mode } },
    });
    const key = { billingCustomerId: profile.id, methodId };
    if (
      !(await prisma.billingCardRemoval.findUnique({
        where: { billingCustomerId_methodId: key },
      }))
    ) {
      await provider.authorizeRemoval(id, account.id, methodId);
      await prisma.billingCardRemoval.upsert({
        where: { billingCustomerId_methodId: key },
        create: key,
        update: {},
      });
    }
    await provider.remove(id, account.id, methodId);
    return { removed: true };
  });
  app.get("/v1/billing", async (request) => {
    const account = await requireAccount(prisma, request);
    const { after, dueAfter, status } = z
      .object({
        after: z.uuid().optional(),
        dueAfter: z.uuid().optional(),
        status: z
          .enum(["ALL", "PAID", "REFUNDED", "PENDING", "FAILED", "DISPUTED"])
          .default("ALL"),
      })
      .parse(request.query);
    const ownership = {
      milestone: { proposal: { project: { accountId: account.id } } },
    };
    const stateFilter: Prisma.PaymentAttemptWhereInput =
      status === "PAID"
        ? { status: "PAID", refundedCents: 0, disputed: false }
        : status === "REFUNDED"
          ? { refundedCents: { gt: 0 } }
          : status === "PENDING"
            ? { status: { in: ["CREATING", "OPEN", "PROCESSING"] } }
            : status === "FAILED"
              ? { status: { in: ["FAILED", "EXPIRED"] } }
              : status === "DISPUTED"
                ? { disputed: true }
                : {};
    const cursor = after
      ? await prisma.paymentAttempt.findFirst({
          where: { id: after, ...ownership },
          select: { id: true, createdAt: true },
        })
      : null;
    if (after && !cursor) throw unavailable();
    if (
      dueAfter &&
      !(await prisma.paymentMilestone.findFirst({
        where: {
          id: dueAfter,
          proposal: { project: { accountId: account.id } },
        },
      }))
    )
      throw unavailable();
    const [attempts, totals, dueIds] = await Promise.all([
      prisma.paymentAttempt.findMany({
        where: {
          ...ownership,
          ...stateFilter,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26,
        select: {
          id: true,
          amountCents: true,
          currency: true,
          mode: true,
          status: true,
          refundedCents: true,
          disputed: true,
          receiptUrl: true,
          invoiceUrl: true,
          invoicePdf: true,
          createdAt: true,
          updatedAt: true,
          milestone: {
            select: {
              label: true,
              paidAt: true,
              proposal: {
                select: { project: { select: { id: true, name: true } } },
              },
            },
          },
        },
      }),
      prisma.paymentAttempt.groupBy({
        by: ["currency", "mode"],
        where: { ...ownership, status: "PAID" },
        _sum: { amountCents: true, refundedCents: true },
      }),
      prisma.$queryRaw<
        { id: string }[]
      >(Prisma.sql`SELECT m.id FROM "PaymentMilestone" m JOIN "Proposal" q ON q.id = m."proposalId" JOIN "Project" p ON p.id = q."projectId"
        WHERE p."accountId" = ${account.id}::uuid AND p."currentProposalId" = q.id AND q."approvedAt" IS NOT NULL AND p."cancellationRequestedAt" IS NULL AND p.stage IN ('APPROVED','BUILDING','VERIFYING')
        AND m."releasedAt" IS NOT NULL AND (m."paidCents" - m."refundedCents" <> m."amountCents" OR m.disputed
          OR EXISTS (SELECT 1 FROM "PaymentAttempt" a WHERE a."milestoneId" = m.id AND a.status = 'PAID' AND a.mode <> ${provider.mode}))
        ${dueAfter ? Prisma.sql`AND m.id > ${dueAfter}::uuid` : Prisma.empty} ORDER BY m.id ASC LIMIT 26`),
    ]);
    const dues = await prisma.paymentMilestone.findMany({
      where: {
        id: { in: dueIds.slice(0, 25).map((row) => row.id) },
        proposal: { project: { accountId: account.id } },
      },
      include: {
        attempts: true,
        proposal: {
          include: {
            milestones: { include: { attempts: true } },
            project: { select: { id: true, name: true } },
          },
        },
      },
    });
    const history = attempts
      .slice(0, 25)
      .map(({ milestone, receiptUrl, invoiceUrl, invoicePdf, ...row }) => ({
        ...row,
        label: milestone.label,
        project: milestone.proposal.project,
        paidAt: row.status === "PAID" ? milestone.paidAt : null,
        receiptUrl: stripeLink(receiptUrl),
        invoiceUrl: stripeLink(invoiceUrl),
        invoicePdf: stripeLink(invoicePdf),
      }));
    return {
      enabled: provider.enabled,
      mode: provider.mode,
      totals: totals.map((row) => ({
        currency: row.currency,
        mode: row.mode,
        paidCents: row._sum.amountCents ?? 0,
        refundedCents: row._sum.refundedCents ?? 0,
      })),
      history,
      next: attempts.length > 25 ? history.at(-1)?.id : null,
      due: dueIds.slice(0, 25).flatMap(({ id }) => {
        const row = dues.find((item) => item.id === id);
        if (!row) return [];
        return [
          {
            id: row.id,
            label: row.label,
            amountCents: row.amountCents,
            currency: row.proposal.currency,
            project: row.proposal.project,
            processing: row.attempts.some(
              (attempt) =>
                attempt.mode === provider.mode &&
                attempt.status === "PROCESSING",
            ),
            needsReview:
              row.paidCents > 0 ||
              row.refundedCents > 0 ||
              row.disputed ||
              row.attempts.some(
                (attempt) =>
                  attempt.mode !== provider.mode &&
                  !["FAILED", "EXPIRED"].includes(attempt.status),
              ) ||
              row.proposal.milestones.some(
                (earlier) =>
                  earlier.position < row.position &&
                  !paidInMode(earlier, provider.mode),
              ),
          },
        ];
      }),
      dueNext: dueIds.length > 25 ? dueIds[24]!.id : null,
    };
  });
  return { enabled: provider.enabled, mode: provider.mode, customer };
}
