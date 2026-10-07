import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { hash, secret } from "../src/crypto.js";

const database = process.env.TEST_DATABASE_URL;
describe.skipIf(!database)("account closure", () => {
  const prisma = new PrismaClient({ datasourceUrl: database! });
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: database,
    OPERATOR_GITHUB_IDS: "870009901",
  });
  const accounts: string[] = [],
    reviews: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let operator: Awaited<ReturnType<typeof actor>>;
  beforeAll(async () => {
    if (!database || !new URL(database).pathname.endsWith("/m8itwork_test"))
      throw new Error("Use dedicated test database.");
    app = await buildApp({ env, prisma, logger: false, rateLimiting: false });
    operator = await actor("870009901");
  });
  afterAll(async () => {
    await prisma.account.deleteMany({ where: { id: { in: accounts } } });
    await prisma.reviewSession.deleteMany({ where: { id: { in: reviews } } });
    await app?.close();
    await prisma.$disconnect();
  });
  async function actor(githubId?: string) {
    const account = await prisma.account.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        emailVerifiedAt: new Date(),
        passwordHash: "retired-fixture",
        githubId: githubId ?? null,
      },
    });
    accounts.push(account.id);
    const raw = secret();
    await prisma.accountSession.create({
      data: {
        id: hash(raw),
        accountId: account.id,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return {
      ...account,
      cookie: `m8_account_session=${raw}`,
      session: hash(raw),
    };
  }
  const post = (
    path: string,
    payload: unknown,
    cookie = "",
    origin = env.FRONTEND_ORIGIN,
  ) =>
    app.inject({
      method: "POST",
      url: path,
      headers: { cookie, origin, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  const close = (a: { id: string; cookie: string }, requestId = randomUUID()) =>
    post(
      "/v1/auth/account/close",
      { accountId: a.id, requestId, confirmation: "CLOSE" },
      a.cookie,
    );
  async function project(accountId: string, stage = "IN_REVIEW") {
    return prisma.project.create({
      data: {
        accountId,
        name: "App to improve",
        contactEmail: "builder@example.invalid",
        platform: "Other",
        summary: "Help finish the app and review workflows.",
        stage,
        aiReviewConsentAt: new Date(),
        aiReviewConsentVersion: "fixture",
      },
    });
  }
  async function proposal(projectId: string, approved = false) {
    return prisma.proposal.create({
      data: {
        projectId,
        version: 1,
        scope: "Improve app",
        acceptance: "Verify it",
        assumptions: "Access needed",
        currency: "USD",
        amountCents: 10000,
        deliveryDate: new Date("2099-01-01"),
        approvedAt: approved ? new Date() : null,
        milestones: {
          create: {
            position: 0,
            label: "Project",
            amountCents: 10000,
            dueWhen: "BEFORE_BUILD",
          },
        },
      },
      include: { milestones: true },
    });
  }
  it("requires exact customer origin, current ownership and typed confirmation", async () => {
    const owner = await actor(),
      other = await actor();
    const payload = {
      accountId: owner.id,
      requestId: randomUUID(),
      confirmation: "CLOSE",
    };
    expect((await post("/v1/auth/account/close", payload)).statusCode).toBe(
      401,
    );
    expect(
      (await post("/v1/auth/account/close", payload, other.cookie)).statusCode,
    ).toBe(409);
    expect(
      (
        await post(
          "/v1/auth/account/close",
          payload,
          owner.cookie,
          "https://evil.invalid",
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          "/v1/auth/account/close",
          payload,
          owner.cookie,
          env.ADMIN_ORIGIN,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          "/v1/auth/account/close",
          { ...payload, confirmation: "close" },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: owner.id } }))
        .closedAt,
    ).toBeNull();
    expect(
      await prisma.accountSession.count({ where: { accountId: owner.id } }),
    ).toBe(1);
  });
  it("atomically retires all credentials, withdraws requests, cancels reviews and retains history", async () => {
    const owner = await actor(),
      first = await project(owner.id),
      complete = await project(owner.id, "COMPLETE");
    const raw = secret(),
      reviewId = hash(secret());
    reviews.push(reviewId);
    await prisma.accountSession.create({
      data: {
        id: hash(raw),
        accountId: owner.id,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await prisma.accountToken.create({
      data: {
        id: hash(secret()),
        accountId: owner.id,
        purpose: "RESET_PASSWORD",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await prisma.reviewSession.create({
      data: {
        id: reviewId,
        accountSessionId: hash(raw),
        oauthAccountId: owner.id,
        tokenEncrypted: "encrypted-fixture",
        verifierEncrypted: "encrypted-fixture",
        oauthStateHash: hash(secret()),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    for (const status of ["QUEUED", "RUNNING"])
      await prisma.reviewJob.create({
        data: {
          id: randomUUID(),
          projectId: first.id,
          provider: status === "QUEUED" ? "codex" : "claude",
          status,
          commit: "a".repeat(40),
          repositoryUrl: "https://github.com/fixture/app",
          inputDigest: "fixture",
          requestSnapshot: {},
          leaseExpiresAt: new Date(Date.now() + 60000),
        },
      });
    const saved = await proposal(complete.id, true);
    const payment = await prisma.paymentAttempt.create({
      data: {
        milestoneId: saved.milestones[0]!.id,
        status: "PAID",
        mode: "test",
        currency: "USD",
        amountCents: 10000,
      },
    });
    await prisma.billingCustomer.create({
      data: {
        accountId: owner.id,
        mode: "test",
        stripeCustomerId: `cus_${randomUUID()}`,
      },
    });
    const result = await close(owner);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ closed: true, accountId: owner.id });
    expect(
      result.cookies
        .filter((c) => c.value === "")
        .map((c) => c.name)
        .sort(),
    ).toEqual(["m8_account_session", "m8_review_session"]);
    expect(
      await prisma.accountSession.count({ where: { accountId: owner.id } }),
    ).toBe(0);
    expect(
      await prisma.accountToken.count({ where: { accountId: owner.id } }),
    ).toBe(0);
    expect(
      await prisma.reviewSession.findUniqueOrThrow({ where: { id: reviewId } }),
    ).toMatchObject({
      tokenEncrypted: null,
      verifierEncrypted: null,
      oauthStateHash: null,
      accountSessionId: null,
      oauthAccountId: null,
    });
    expect(
      (
        await prisma.reviewJob.findMany({ where: { projectId: first.id } })
      ).every(
        (j) =>
          j.status === "CANCELLED" &&
          j.errorCode === "ACCOUNT_CLOSED" &&
          j.leaseExpiresAt === null,
      ),
    ).toBe(true);
    expect(
      await prisma.project.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({ stage: "CLOSED", aiReviewConsentAt: null, version: 2 });
    expect(
      await prisma.project.findUniqueOrThrow({ where: { id: complete.id } }),
    ).toMatchObject({ stage: "COMPLETE", aiReviewConsentAt: null });
    expect(
      await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: payment.id },
      }),
    ).toMatchObject({ status: "PAID" });
    expect(
      await prisma.billingCustomer.count({ where: { accountId: owner.id } }),
    ).toBe(1);
    expect(
      (
        await app.inject({
          url: "/v1/auth/session",
          headers: { cookie: owner.cookie },
        })
      ).json().account,
    ).toBeNull();
    expect(
      (
        await post(
          "/v1/projects",
          {
            id: randomUUID(),
            name: "Another app",
            contactEmail: owner.email,
            platform: "Other",
            summary: "Help improve this other app please.",
            consent: true,
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(401);
  });
  it("uses a hashed bounded receipt for lost-response replay without exposing another account", async () => {
    const owner = await actor(),
      other = await actor(),
      requestId = randomUUID();
    const payload = { accountId: owner.id, requestId };
    const results = await Promise.all([
      close(owner, requestId),
      close(owner, requestId),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(
      await prisma.accountClosure.count({ where: { accountId: owner.id } }),
    ).toBe(1);
    const receipt = await prisma.accountClosure.findUniqueOrThrow({
      where: { accountId: owner.id },
    });
    expect(receipt.id).not.toBe(requestId);
    expect(receipt.id).toBe(hash(`account-close:${requestId}`));
    expect(
      (await post("/v1/auth/account/close/status", payload)).json(),
    ).toEqual({ closed: true });
    expect(
      (
        await post("/v1/auth/account/close/status", {
          ...payload,
          requestId: randomUUID(),
        })
      ).json(),
    ).toEqual({ closed: false });
    expect(
      (
        await post("/v1/auth/account/close/status", {
          ...payload,
          accountId: other.id,
        })
      ).json(),
    ).toEqual({ closed: false });
    expect(
      (
        await post("/v1/auth/account/close", {
          ...payload,
          confirmation: "CLOSE",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(
          "/v1/auth/account/close",
          { ...payload, confirmation: "CLOSE" },
          other.cookie,
        )
      ).statusCode,
    ).toBe(409);
    const check = await post(
      "/v1/auth/account/close/status",
      payload,
      other.cookie,
    );
    expect(check.cookies).toHaveLength(0);
    await prisma.accountClosure.update({
      where: { id: receipt.id },
      data: { expiresAt: new Date(1) },
    });
    expect(
      (await post("/v1/auth/account/close/status", payload)).json(),
    ).toEqual({ closed: false });
    expect(
      (
        await post("/v1/auth/account/close", {
          ...payload,
          confirmation: "CLOSE",
        })
      ).statusCode,
    ).toBe(401);
  });
  it.each(["APPROVED", "BUILDING", "VERIFYING"])(
    "blocks closure while %s work is agreed",
    async (stage) => {
      const owner = await actor();
      await project(owner.id, stage);
      expect((await close(owner)).statusCode).toBe(409);
      expect(
        await prisma.accountSession.count({ where: { accountId: owner.id } }),
      ).toBe(1);
    },
  );
  it.each(["CREATING", "OPEN", "PROCESSING", "DISPUTED"])(
    "blocks unresolved %s payments even after project completion",
    async (status) => {
      const owner = await actor(),
        p = await project(owner.id, "COMPLETE"),
        quote = await proposal(p.id, true);
      await prisma.paymentAttempt.create({
        data: {
          milestoneId: quote.milestones[0]!.id,
          status: status === "DISPUTED" ? "PAID" : status,
          disputed: status === "DISPUTED",
          mode: "test",
          amountCents: 10000,
          currency: "USD",
        },
      });
      const blocked = await close(owner);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe("ACCOUNT_ACTIVE_WORK");
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: owner.id } }))
          .closedAt,
      ).toBeNull();
    },
  );
  it("requires a team check for operators and active worker owners", async () => {
    const owner = await actor();
    await prisma.reviewWorker.create({
      data: {
        operatorId: owner.id,
        name: "Owned worker",
        tokenHash: hash(secret()),
      },
    });
    for (const a of [operator, owner]) {
      const result = await close(a);
      expect(result.statusCode).toBe(409);
      expect(result.json().error.code).toBe("ACCOUNT_TEAM_CHECK");
    }
  });
  it("serializes project creation with closure so stale authentication cannot create an active request", async () => {
    const owner = await actor();
    let release!: () => void,
      enter!: () => void,
      observed!: () => void,
      startingCreate = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const read = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const extended = prisma.$extends({
      query: {
        account: {
          async update({ args, query }) {
            if (args.where.id === owner.id && args.data.closedAt) {
              enter();
              await gate;
            }
            return query(args);
          },
        },
        accountSession: {
          async findUnique({ args, query }) {
            const result = await query(args);
            if (startingCreate) observed();
            return result;
          },
        },
      },
    });
    const raced = await buildApp({
      env,
      prisma: extended as unknown as PrismaClient,
      logger: false,
      rateLimiting: false,
    });
    try {
      const closing = raced.inject({
        method: "POST",
        url: "/v1/auth/account/close",
        headers: { cookie: owner.cookie, origin: env.FRONTEND_ORIGIN },
        payload: {
          accountId: owner.id,
          requestId: randomUUID(),
          confirmation: "CLOSE",
        },
      });
      await entered;
      startingCreate = true;
      const projectId = randomUUID();
      const creating = raced.inject({
        method: "POST",
        url: "/v1/projects",
        headers: { cookie: owner.cookie, origin: env.FRONTEND_ORIGIN },
        payload: {
          id: projectId,
          name: "Stale create",
          contactEmail: owner.email,
          platform: "Other",
          summary: "Improve this app and add more features.",
          consent: true,
        },
      });
      await read;
      release();
      const [closed, created] = await Promise.all([closing, creating]);
      expect(closed.statusCode).toBe(200);
      expect(created.statusCode).toBe(401);
      expect(
        await prisma.project.findUnique({ where: { id: projectId } }),
      ).toBeNull();
    } finally {
      release();
      await raced.close();
    }
  });
  it("serializes an in-flight message with closure and rejects subsequent messages", async () => {
    const owner = await actor(),
      p = await project(owner.id),
      messageId = randomUUID();
    let release!: () => void, enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const extended = prisma.$extends({
      query: {
        projectMessage: {
          async upsert({ args, query }) {
            if (args.where.id === messageId) {
              enter();
              await gate;
            }
            return query(args);
          },
        },
      },
    });
    const raced = await buildApp({
      env,
      prisma: extended as unknown as PrismaClient,
      logger: false,
      rateLimiting: false,
    });
    try {
      const sending = raced.inject({
        method: "POST",
        url: `/v1/projects/${p.id}/messages`,
        headers: { cookie: owner.cookie, origin: env.FRONTEND_ORIGIN },
        payload: {
          id: messageId,
          body: "A message already being sent before closure.",
        },
      });
      await entered;
      const closing = raced.inject({
        method: "POST",
        url: "/v1/auth/account/close",
        headers: { cookie: owner.cookie, origin: env.FRONTEND_ORIGIN },
        payload: {
          accountId: owner.id,
          requestId: randomUUID(),
          confirmation: "CLOSE",
        },
      });
      // Observe the database lock, not an arbitrary timer, before releasing the message.
      await expect
        .poll(async () => {
          const closed = (
            await prisma.account.findUniqueOrThrow({ where: { id: owner.id } })
          ).closedAt;
          if (closed) return "closed too early";
          const rows = await prisma.$queryRaw<
            { waiting: bigint }[]
          >`SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "Project" WHERE "accountId"%'`;
          return rows[0]!.waiting > 0n ? "serialized" : "starting";
        })
        .toBe("serialized");
      release();
      const [sent, closed] = await Promise.all([sending, closing]);
      expect(sent.statusCode).toBe(201);
      expect(closed.statusCode).toBe(200);
      const saved = await prisma.projectMessage.findUniqueOrThrow({
        where: { id: messageId },
      });
      const account = await prisma.account.findUniqueOrThrow({
        where: { id: owner.id },
      });
      expect(saved.createdAt.getTime()).toBeLessThanOrEqual(
        account.closedAt!.getTime(),
      );
      expect(
        (
          await post(
            `/v1/operator/projects/${p.id}/messages`,
            { id: randomUUID(), body: "New message after closure." },
            operator.cookie,
          )
        ).statusCode,
      ).toBe(409);
      expect(
        await prisma.projectMessage.count({ where: { projectId: p.id } }),
      ).toBe(1);
    } finally {
      release();
      await raced.close();
    }
  });
  it("retains backoffice history and rejects new work and notes after closure", async () => {
    const session = secret();
    await prisma.accountSession.create({
      data: {
        id: hash(session),
        accountId: operator.id,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const team = `m8_account_session=${session}`;
    const owner = await actor(),
      p = await project(owner.id);
    expect((await close(owner)).statusCode).toBe(200);
    const detail = await app.inject({
      url: `/v1/operator/projects/${p.id}`,
      headers: { cookie: team },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().accountClosedAt).toBeTruthy();
    expect(
      (
        await post(
          `/v1/operator/projects/${p.id}/notes`,
          { id: randomUUID(), body: "Attempt to add new work" },
          team,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post(
          `/v1/operator/projects/${p.id}/review`,
          {
            version: 2,
            summary: "Reviewing and adding new work after closure.",
          },
          team,
        )
      ).statusCode,
    ).toBe(409);
    expect(await prisma.teamNote.count({ where: { projectId: p.id } })).toBe(0);
  });
});
