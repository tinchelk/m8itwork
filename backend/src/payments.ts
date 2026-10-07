import { Prisma, type PaymentAttempt, type PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "./config.js";
import { projectId, type ProjectAccess } from "./project-access.js";
import { paid, paidInMode } from "./payment-rules.js";
import type { Checkout, PaymentProvider } from "./stripe-provider.js";
import { AppError } from "./shared/errors.js";

export async function registerPayments(
  app: FastifyInstance,
  options: {
    prisma: PrismaClient;
    env: Env;
    access: ProjectAccess;
    provider: PaymentProvider;
  },
) {
  const { prisma, access, provider } = options;
  const { actor, projectFor, touch, update } = access;
  const params = (value: unknown) =>
    z.object({ milestoneId: z.uuid() }).passthrough().parse(value);
  const ensureEnabled = () => {
    if (!provider.enabled)
      throw new AppError(
        503,
        "PAYMENT_SETUP_REQUIRED",
        "Payment collection is being set up. Your agreement is saved; contact the team in this project.",
      );
  };
  async function milestoneFor(
    id: string,
    project: { id: string; currentProposalId: string | null },
  ) {
    const milestone = await prisma.paymentMilestone.findFirst({
      where: {
        id,
        proposalId:
          project.currentProposalId ?? "00000000-0000-0000-0000-000000000000",
        proposal: { projectId: project.id },
      },
      include: { proposal: true },
    });
    if (!milestone)
      throw new AppError(
        404,
        "PAYMENT_UNAVAILABLE",
        "This installment isn't part of the current proposal.",
      );
    return milestone;
  }
  function validate(checkout: Checkout, attempt: PaymentAttempt) {
    if (
      checkout.attemptId !== attempt.id ||
      (attempt.stripeSessionId && attempt.stripeSessionId !== checkout.id) ||
      checkout.amountCents !== attempt.amountCents ||
      checkout.currency.toUpperCase() !== attempt.currency ||
      checkout.live !== (attempt.mode === "live")
    )
      throw new AppError(
        409,
        "PAYMENT_MISMATCH",
        "Payment details need a team review. No payment has been credited to this project.",
      );
  }
  async function reconcile(
    checkout: Checkout,
    attempt: PaymentAttempt,
    event?: { id: string; type: string },
    dispute?: { held: boolean; created: number; observedAt: number },
  ) {
    validate(checkout, attempt);
    try {
      return await prisma.$transaction(async (tx) => {
        if (event) await tx.paymentEvent.create({ data: event });
        const milestone = await tx.paymentMilestone.findUniqueOrThrow({
          where: { id: attempt.milestoneId },
          include: { proposal: true },
        });
        // Serialize against proposal revisions, reservations, and work gates.
        await tx.project.update({
          where: { id: milestone.proposal.projectId },
          data: { version: { increment: 1 } },
        });
        const current = await tx.paymentAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        });
        validate(checkout, current);
        const nextStatus =
          current.status === "PAID" || checkout.paid
            ? "PAID"
            : checkout.status === "expired"
              ? "EXPIRED"
              : checkout.status === "complete"
                ? "PROCESSING"
                : "OPEN";
        const refunded = Math.max(
          current.refundedCents,
          checkout.refundedCents,
        );
        const eventCurrent = Boolean(
          dispute && dispute.created >= current.disputeEventCreated,
        );
        const observedAt = dispute
          ? Math.min(
              dispute.observedAt,
              checkout.observedAt ?? dispute.observedAt,
            )
          : (checkout.observedAt ?? 0);
        // Any authoritative hold wins. Every clearing path, including webhooks,
        // must have started after the last committed reconciliation.
        const held =
          checkout.disputed === true || (eventCurrent && dispute!.held)
            ? true
            : observedAt > current.updatedAt.getTime() &&
                (eventCurrent ? !dispute!.held : checkout.disputed === false)
              ? false
              : current.disputed;
        await tx.paymentAttempt.update({
          where: { id: current.id },
          data: {
            status: nextStatus,
            stripeSessionId: checkout.id,
            ...(checkout.paymentIntentId
              ? { stripePaymentIntentId: checkout.paymentIntentId }
              : {}),
            checkoutUrl: checkout.url,
            receiptUrl: checkout.receiptUrl ?? current.receiptUrl,
            refundedCents: refunded,
            disputed: held,
            ...(dispute && dispute.created >= current.disputeEventCreated
              ? { disputeEventCreated: dispute.created }
              : {}),
          },
        });
        const attempts = await tx.paymentAttempt.findMany({
          where: { milestoneId: milestone.id, status: "PAID" },
        });
        const paidCents = attempts.reduce(
          (sum, row) => sum + row.amountCents,
          0,
        );
        const refundedCents = attempts.reduce(
          (sum, row) => sum + row.refundedCents,
          0,
        );
        const disputed = attempts.some((row) => row.disputed);
        await tx.paymentMilestone.update({
          where: { id: milestone.id },
          data: {
            paidCents,
            refundedCents,
            disputed,
            paidAt: paidCents > 0 ? (milestone.paidAt ?? new Date()) : null,
          },
        });
        if (current.status !== "PAID" && nextStatus === "PAID")
          await update(
            tx,
            milestone.proposal.projectId,
            `Payment confirmed: ${milestone.label}`,
            `${attempt.currency} ${(attempt.amountCents / 100).toFixed(2)} confirmed by Stripe${attempt.mode === "test" ? " in test mode (no real money)" : ""}.`,
          );
        if (refunded > current.refundedCents || held !== current.disputed)
          await update(
            tx,
            milestone.proposal.projectId,
            held
              ? "Payment disputed — work needs review"
              : refunded > current.refundedCents
                ? "Payment refund recorded — work needs review"
                : "Payment dispute updated",
            "Check the payment plan and speak with the team before advancing delivery.",
          );
        return { status: nextStatus };
      });
    } catch (error) {
      if (
        event &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        (await prisma.paymentEvent.findUnique({ where: { id: event.id } }))
      )
        return { duplicate: true };
      throw error;
    }
  }
  app.post(
    "/v1/projects/:id/payments/:milestoneId/checkout",
    async (request) => {
      const account = await actor(request);
      z.object({}).strict().parse(request.body);
      ensureEnabled();
      const { milestoneId } = params(request.params);
      const reservation = await prisma.$transaction(async (tx) => {
        const project = await projectFor(
          account,
          projectId(request),
          false,
          tx,
        );
        if (!project.currentProposalId)
          throw new AppError(
            409,
            "APPROVAL_REQUIRED",
            "Agree the proposal before payment.",
          );
        await touch(tx, project, project.version);
        const milestone = await tx.paymentMilestone.findFirst({
          where: { id: milestoneId, proposalId: project.currentProposalId },
          include: { proposal: true },
        });
        if (
          !milestone?.proposal.approvedAt ||
          !milestone.releasedAt ||
          !["APPROVED", "BUILDING", "VERIFYING"].includes(project.stage)
        )
          throw new AppError(
            409,
            "PAYMENT_NOT_DUE",
            "This installment hasn't been requested under the approved proposal.",
          );
        if (paid(milestone))
          throw new AppError(
            409,
            "ALREADY_PAID",
            "This installment is already paid. Refresh the project.",
          );
        if (
          milestone.paidCents > 0 ||
          milestone.disputed ||
          milestone.refundedCents > 0
        )
          throw new AppError(
            409,
            "PAYMENT_REVIEW_REQUIRED",
            "A refund or dispute needs a team review; a second charge is not available.",
          );
        const earlier = await tx.paymentMilestone.findMany({
          where: {
            proposalId: project.currentProposalId,
            position: { lt: milestone.position },
          },
          include: { attempts: true },
        });
        if (earlier.some((row) => !paidInMode(row, provider.mode)))
          throw new AppError(
            409,
            "EARLIER_PAYMENT_REQUIRED",
            "Complete the earlier installment first.",
          );
        const latest = await tx.paymentAttempt.findFirst({
          where: { milestoneId: milestone.id },
          orderBy: { createdAt: "desc" },
        });
        const attempt =
          latest && !["EXPIRED", "FAILED"].includes(latest.status)
            ? latest
            : await tx.paymentAttempt.create({
                data: {
                  milestoneId: milestone.id,
                  amountCents: milestone.amountCents,
                  currency: milestone.proposal.currency,
                  mode: provider.mode,
                },
              });
        if (attempt.mode !== provider.mode)
          throw new AppError(
            409,
            "PAYMENT_MODE_CHANGED",
            "The team must reconcile the existing Checkout before changing payment mode.",
          );
        return { project, milestone, attempt };
      });
      const { attempt, project, milestone } = reservation;
      if (
        !attempt.stripeSessionId &&
        Date.now() - attempt.createdAt.getTime() > 23 * 3600_000
      )
        throw new AppError(
          409,
          "CHECKOUT_RECOVERY_REQUIRED",
          "The team must recover this unfinished Checkout from Stripe before retrying. Contact them in the conversation.",
        );
      const checkout = attempt.stripeSessionId
        ? await provider.retrieve(attempt.stripeSessionId)
        : await provider.create({
            attemptId: attempt.id,
            projectId: project.id,
            projectName: project.name,
            label: milestone.label,
            amountCents: attempt.amountCents,
            currency: attempt.currency,
            email: project.contactEmail,
          });
      const result = await reconcile(checkout, attempt);
      if ("status" in result && result.status === "PAID") return { paid: true };
      if (checkout.status === "expired")
        throw new AppError(
          409,
          "CHECKOUT_EXPIRED",
          "Checkout expired. Try again to open a fresh payment page.",
        );
      if (checkout.status !== "open" || !checkout.url)
        throw new AppError(
          409,
          "PAYMENT_PROCESSING",
          "Stripe is confirming this payment. Refresh its status before retrying.",
        );
      const url = new URL(checkout.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
        throw new AppError(
          502,
          "CHECKOUT_URL",
          "Stripe returned an unavailable payment page. Contact the team.",
        );
      return { url: checkout.url };
    },
  );
  for (const team of [false, true]) {
    const prefix = team ? "/v1/operator/projects" : "/v1/projects";
    app.post(`${prefix}/:id/payments/:milestoneId/sync`, async (request) => {
      const account = await actor(request, team);
      z.object({}).strict().parse(request.body);
      ensureEnabled();
      const project = await projectFor(account, projectId(request), team);
      const milestone = await milestoneFor(
        params(request.params).milestoneId,
        project,
      );
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { milestoneId: milestone.id },
        orderBy: { createdAt: "desc" },
      });
      if (attempt?.stripeSessionId)
        await reconcile(
          await provider.retrieve(attempt.stripeSessionId),
          attempt,
        );
      return { refreshed: true };
    });
  }
  app.post(
    "/v1/operator/projects/:id/payments/:milestoneId/request",
    async (request) => {
      const account = await actor(request, true);
      const input = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(request.body);
      return prisma.$transaction(async (tx) => {
        const project = await projectFor(account, projectId(request), true, tx);
        await touch(tx, project, input.version);
        const milestone = await tx.paymentMilestone.findFirst({
          where: {
            id: params(request.params).milestoneId,
            proposalId:
              project.currentProposalId ??
              "00000000-0000-0000-0000-000000000000",
          },
          include: { proposal: true },
        });
        if (
          !milestone ||
          milestone.proposal.projectId !== project.id ||
          !milestone.proposal.approvedAt
        )
          throw new AppError(
            409,
            "APPROVAL_REQUIRED",
            "Agree the current payment schedule first.",
          );
        if (
          !(
            {
              BEFORE_BUILD: ["APPROVED", "BUILDING"],
              BEFORE_VERIFY: ["BUILDING"],
              BEFORE_HANDOVER: ["VERIFYING"],
            }[milestone.dueWhen] ?? []
          ).includes(project.stage)
        )
          throw new AppError(
            409,
            "PAYMENT_STAGE",
            "Request this installment when its agreed delivery stage is reached.",
          );
        if (milestone.releasedAt) return { requested: true };
        const earlier = await tx.paymentMilestone.findMany({
          where: {
            proposalId: milestone.proposalId,
            position: { lt: milestone.position },
          },
          include: { attempts: true },
        });
        if (earlier.some((row) => !paidInMode(row, provider.mode)))
          throw new AppError(
            409,
            "EARLIER_PAYMENT_REQUIRED",
            "Confirm the preceding installment before requesting this one.",
          );
        await tx.paymentMilestone.update({
          where: { id: milestone.id },
          data: { releasedAt: new Date() },
        });
        await update(
          tx,
          project.id,
          `Payment requested: ${milestone.label}`,
          "The agreed installment is ready in your payment plan. Pay through Stripe Checkout when you're ready.",
        );
        return { requested: true };
      });
    },
  );
  app.post(
    "/v1/operator/projects/:id/payments/:milestoneId/expire",
    async (request) => {
      const account = await actor(request, true);
      z.object({}).strict().parse(request.body);
      ensureEnabled();
      const project = await projectFor(account, projectId(request), true);
      const milestone = await milestoneFor(
        params(request.params).milestoneId,
        project,
      );
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { milestoneId: milestone.id },
        orderBy: { createdAt: "desc" },
      });
      if (!attempt) return { expired: true };
      if (!attempt.stripeSessionId)
        throw new AppError(
          409,
          "CHECKOUT_RECOVERY_REQUIRED",
          "Checkout is still being prepared. Refresh, or recover its session ID from Stripe.",
        );
      let checkout = await provider.retrieve(attempt.stripeSessionId);
      if (checkout.status === "open") {
        await provider.expire(checkout.id);
        checkout = await provider.retrieve(checkout.id);
      }
      await reconcile(checkout, attempt);
      if (checkout.status !== "expired" || checkout.paid)
        throw new AppError(
          409,
          "PAYMENT_NOT_CANCELLABLE",
          "This payment is completed or processing. Its agreed scope cannot be replaced.",
        );
      return { expired: true };
    },
  );
  app.post(
    "/v1/operator/projects/:id/payments/:milestoneId/recover",
    async (request) => {
      const account = await actor(request, true);
      ensureEnabled();
      const { sessionId } = z
        .object({
          sessionId: z.string().regex(/^cs_(test_|live_)?[A-Za-z0-9_]{8,200}$/),
        })
        .strict()
        .parse(request.body);
      const project = await projectFor(account, projectId(request), true);
      const milestone = await milestoneFor(
        params(request.params).milestoneId,
        project,
      );
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { milestoneId: milestone.id },
        orderBy: { createdAt: "desc" },
      });
      if (!attempt)
        throw new AppError(
          404,
          "PAYMENT_UNAVAILABLE",
          "No Checkout attempt needs recovery.",
        );
      await reconcile(await provider.retrieve(sessionId), attempt);
      return { recovered: true };
    },
  );
  await app.register(async (webhook) => {
    webhook.removeContentTypeParser("application/json");
    webhook.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
    webhook.post(
      "/v1/stripe/webhook",
      { bodyLimit: 1_000_000 },
      async (request) => {
        ensureEnabled();
        const signature = request.headers["stripe-signature"];
        if (typeof signature !== "string" || !Buffer.isBuffer(request.body))
          throw new AppError(
            400,
            "INVALID_PAYMENT_SIGNATURE",
            "Payment event signature is missing.",
          );
        const event = provider.verify(request.body, signature);
        if (event.livemode !== (provider.mode === "live"))
          throw new AppError(
            400,
            "PAYMENT_MODE_MISMATCH",
            "Payment event mode is invalid.",
          );
        if (await prisma.paymentEvent.findUnique({ where: { id: event.id } }))
          return { received: true };
        const object = event.data.object as unknown as {
          id: string;
          metadata?: { attemptId?: string };
          payment_intent?: string | { id: string };
        };
        let attempt: PaymentAttempt | null = null;
        let dispute:
          | { held: boolean; created: number; observedAt: number }
          | undefined;
        if (
          [
            "checkout.session.completed",
            "checkout.session.async_payment_succeeded",
            "checkout.session.async_payment_failed",
            "checkout.session.expired",
          ].includes(event.type)
        ) {
          attempt = await prisma.paymentAttempt.findFirst({
            where: {
              OR: [
                { stripeSessionId: object.id },
                ...(object.metadata?.attemptId
                  ? [{ id: object.metadata.attemptId }]
                  : []),
              ],
            },
          });
          if (attempt)
            await reconcile(await provider.retrieve(object.id), attempt, {
              id: event.id,
              type: event.type,
            });
        } else if (
          event.type === "charge.refunded" ||
          event.type === "charge.dispute.created" ||
          event.type === "charge.dispute.closed"
        ) {
          let intentId =
            typeof object.payment_intent === "string"
              ? object.payment_intent
              : object.payment_intent?.id;
          if (event.type.startsWith("charge.dispute.")) {
            const observedAt = Date.now();
            const state = await provider.dispute(object.id);
            intentId = state.paymentIntentId ?? undefined;
            dispute = { held: state.held, created: event.created, observedAt };
          }
          if (intentId)
            attempt = await prisma.paymentAttempt.findUnique({
              where: { stripePaymentIntentId: intentId },
            });
          if (attempt?.stripeSessionId)
            await reconcile(
              await provider.retrieve(attempt.stripeSessionId),
              attempt,
              { id: event.id, type: event.type },
              dispute,
            );
        }
        return { received: true };
      },
    );
  });
}
