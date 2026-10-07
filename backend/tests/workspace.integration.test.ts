import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { hash } from "../src/crypto.js";

const dbUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!dbUrl)("owned customer workspace", () => {
  const prisma = new PrismaClient({
    datasourceUrl:
      dbUrl ?? "postgresql://unused:unused@localhost:5432/m8itwork_test",
  });
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: dbUrl,
    GITHUB_CLIENT_ID: "workspace-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    GITHUB_APP_SLUG: "workspace-test",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
    OPERATOR_GITHUB_IDS: "900001",
    STRIPE_SECRET_KEY: "sk_test_fixture_only",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture_only",
  });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let identity = { id: 900002, login: "customer", name: "Customer" };
  let exchangeHook = async () => {};
  let inspectHook = async () => {};
  const accountIds = new Set<string>();
  const reviewIds: string[] = [];
  const nextUserId = () =>
    10_000_000 + Math.floor(Math.random() * 1_000_000_000);
  beforeAll(async () => {
    if (!dbUrl || !new URL(dbUrl).pathname.endsWith("/m8itwork_test"))
      throw new Error("Use the dedicated m8itwork_test database.");
    app = await buildApp({
      env,
      prisma,
      logger: false,
      rateLimiting: false,
      fetcher: async (url) => {
        const target =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url;
        const path = new URL(target).pathname;
        if (path === "/apps/workspace-test")
          return Response.json({
            client_id: "workspace-client",
            permissions: { contents: "read", metadata: "read" },
          });
        if (path === "/login/oauth/access_token") {
          await exchangeHook();
          return Response.json({
            access_token: "workspace-provider-fixture",
            expires_in: 28800,
          });
        }
        if (path === "/user") return Response.json(identity);
        if (path === "/user/installations")
          return Response.json({ installations: [], total_count: 0 });
        if (path === "/repos/customer/private-app")
          return Response.json({
            full_name: "customer/private-app",
            html_url: "https://github.com/customer/private-app",
            private: true,
            default_branch: "main",
            language: "TypeScript",
            archived: false,
          });
        if (path.includes("/branches/"))
          return Response.json({ commit: { sha: "a".repeat(40) } });
        if (path.includes("/git/trees/")) {
          await inspectHook();
          return Response.json({
            truncated: false,
            tree: [
              {
                path: "src/private.ts",
                type: "blob",
                sha: "b".repeat(40),
                size: 10,
              },
            ],
          });
        }
        throw new Error("Unexpected fixture request: " + path);
      },
    });
  });
  afterAll(async () => {
    if (reviewIds.length)
      await prisma.reviewSession.deleteMany({
        where: { id: { in: reviewIds } },
      });
    if (accountIds.size)
      await prisma.account.deleteMany({
        where: { id: { in: [...accountIds] } },
      });
    if (app) await app.close();
    else await prisma.$disconnect();
  });
  function cookies(response: { headers: Record<string, unknown> }) {
    const raw = response.headers["set-cookie"];
    return (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map((value: string) => value.split(";", 1)[0]!)
      .join("; ");
  }
  async function browser() {
    const response = await app.inject({ url: "/v1/session" });
    const cookie = cookies(response);
    reviewIds.push(hash(cookie.split("=")[1]!));
    return cookie;
  }
  async function signIn(
    userId = nextUserId(),
    login = "customer",
    existingReview?: string,
    flow: "login" | "admin" = "login",
  ) {
    identity = { id: userId, login, name: "Test Customer" };
    const review = existingReview ?? (await browser());
    const start = await app.inject({
      url: `/v1/github/connect?flow=${flow}`,
      headers: { cookie: review },
    });
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers.location!).searchParams.get("state")!;
    const callback = await app.inject({
      url: `/v1/github/callback?state=${state}&code=test`,
      headers: { cookie: review },
    });
    expect(callback.headers.location).toContain(
      `${flow === "admin" ? env.ADMIN_ORIGIN + "/" : env.FRONTEND_ORIGIN + "/dashboard"}?github=connected`,
    );
    const cookie = `${review}; ${cookies(callback)}`;
    const result = (
      await app.inject({ url: "/v1/auth/session", headers: { cookie } })
    ).json<{
      account: { id: string; githubLogin: string; isOperator: boolean };
    }>();
    expect(result.account).not.toBeNull();
    accountIds.add(result.account.id);
    return { cookie, review, account: result.account, callback };
  }
  const post = (url: string, cookie: string, payload: unknown) =>
    app.inject({
      method: "POST",
      url,
      headers: {
        cookie,
        origin: env.FRONTEND_ORIGIN,
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });
  async function newProject(cookie: string, overrides = {}) {
    const input = {
      id: randomUUID(),
      name: "Scheduling app",
      contactEmail: "customer@example.invalid",
      platform: "Lovable",
      summary: "Add recurring bookings and fix the checkout journey.",
      accessNote: "The repository export is pending; review the demo first.",
      consent: true,
      ...overrides,
    };
    const response = await post("/v1/projects", cookie, input);
    expect(response.statusCode).toBe(201);
    return { id: response.json<{ id: string }>().id, input };
  }
  const detail = async (id: string, cookie: string, team = false) =>
    (
      await app.inject({
        url: `${team ? "/v1/operator/projects" : "/v1/projects"}/${id}`,
        headers: { cookie },
      })
    ).json<{
      id: string;
      version: number;
      stage: string;
      currentProposalId: string | null;
      reviewSummary: string | null;
      proposals: { id: string; version: number; approvedAt: string | null }[];
      verificationSummary: string | null;
    }>();
  const proposal = (version: number) => ({
    version,
    scope: "Build recurring bookings and repair the agreed checkout steps.",
    acceptance: "A customer can create a weekly booking and complete checkout.",
    amountCents: 125000,
    currency: "USD",
    deliveryDate: "2099-12-01",
    assumptions:
      "Starts after access and payment are agreed. Includes only the listed acceptance checks.",
  });
  async function inspectRepository(cookie: string) {
    const result = await post("/v1/github/inspect", cookie, { repositoryUrl: "https://github.com/customer/private-app" });
    expect(result.statusCode).toBe(200);
    return result.json<{ id: string }>().id;
  }
  it("creates one review-queue project from only an owned repository and request, including concurrent retries", async () => {
    const customer = await signIn();
    const contactEmail = `${randomUUID()}@example.invalid`;
    await prisma.account.update({ where: { id: customer.account.id }, data: { email: contactEmail, emailVerifiedAt: new Date() } });
    const input = { id: randomUUID(), inspectionId: await inspectRepository(customer.cookie), summary: "Add dark mode", consent: true };
    const results = await Promise.all([post("/v1/projects", customer.cookie, input), post("/v1/projects", customer.cookie, input)]);
    expect(results.map(r => r.statusCode)).toEqual([201, 201]);
    expect(results[0].json()).toEqual(results[1].json());
    const project = await prisma.project.findUniqueOrThrow({ where: { id: input.id }, include: { updates: true } });
    expect(project).toMatchObject({ name: "private-app", contactEmail, accountId: customer.account.id, platform: "GitHub", summary: "Add dark mode", stage: "IN_REVIEW", repositoryUrl: "https://github.com/customer/private-app", demoUrl: null, accessNote: null });
    expect(project.updates).toHaveLength(1);
    expect(project.inspectionReport).toMatchObject({ repository: "customer/private-app", commit: "a".repeat(40) });
    const operator = await signIn(900001, "operator", undefined, "admin");
    const queue = await app.inject({ url: "/v1/operator/projects", headers: { cookie: operator.cookie } });
    expect(queue.json<{ projects: { id: string }[] }>().projects.some(p => p.id === project.id)).toBe(true);
    const visible = await app.inject({ url: `/v1/operator/projects/${project.id}`, headers: { cookie: operator.cookie } });
    expect(visible.json()).toMatchObject({ summary: input.summary, repositoryUrl: project.repositoryUrl, stage: "IN_REVIEW" });
  });
  it("preserves the saved request and rejects edited retries after an uncertain response", async () => {
    const customer = await signIn();
    const input = { id: randomUUID(), inspectionId: await inspectRepository(customer.cookie), summary: "Add useful reports to this app.", consent: true };
    expect((await post("/v1/projects", customer.cookie, input)).statusCode).toBe(201);
    input.inspectionId = await inspectRepository(customer.cookie);
    const changed = await post("/v1/projects", customer.cookie, { ...input, summary: "Add another feature instead of the original request." });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ error: { code: "REQUEST_ALREADY_SAVED" } });
    expect((await post("/v1/projects", customer.cookie, input)).statusCode).toBe(201);
    input.inspectionId = await inspectRepository(customer.cookie);
    const inspection = await prisma.inspection.findUniqueOrThrow({ where: { id: input.inspectionId } });
    await prisma.inspection.update({ where: { id: input.inspectionId }, data: { report: { ...(inspection.report as object), repository: "customer/another-app", url: "https://github.com/customer/another-app" } } });
    expect((await post("/v1/projects", customer.cookie, input)).statusCode).toBe(409);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: input.id }, include: { updates: true } });
    expect(project).toMatchObject({ summary: input.summary, repositoryUrl: "https://github.com/customer/private-app" });
    expect(project.updates).toHaveLength(1);
  });
  it("does not invent a contact email for a GitHub-only request", async () => {
    const customer = await signIn();
    const input = { id: randomUUID(), inspectionId: await inspectRepository(customer.cookie), summary: "Add a new reporting dashboard.", consent: true };
    expect((await post("/v1/projects", customer.cookie, input)).statusCode).toBe(201);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: input.id } })).contactEmail).toBe("");
  });
  it("rejects foreign inspections and request IDs without creating or revealing a project", async () => {
    const owner = await signIn();
    const foreign = await signIn();
    const inspectionId = await inspectRepository(owner.cookie);
    const input = { id: randomUUID(), inspectionId, summary: "Add useful custom reports.", consent: true };
    expect((await post("/v1/projects", foreign.cookie, input)).statusCode).toBe(400);
    expect(await prisma.project.findUnique({ where: { id: input.id } })).toBeNull();
    expect((await post("/v1/projects", owner.cookie, input)).statusCode).toBe(201);
    expect((await post("/v1/projects", foreign.cookie, input)).statusCode).toBe(404);
    expect((await post("/v1/projects", "", { ...input, id: randomUUID() })).statusCode).toBe(401);
  });
  it("rejects cleared and disconnected repository selections while retaining no partial project", async () => {
    const customer = await signIn();
    const input = { id: randomUUID(), inspectionId: await inspectRepository(customer.cookie), summary: "Add a feature to this repository.", consent: true };
    await post("/v1/inspection-selection/remove", customer.cookie, { inspectionId: input.inspectionId });
    expect((await post("/v1/projects", customer.cookie, input)).statusCode).toBe(409);
    input.inspectionId = await inspectRepository(customer.cookie);
    await post("/v1/github/disconnect", customer.cookie, {});
    expect((await post("/v1/projects", customer.cookie, input)).statusCode).toBe(400);
    expect(await prisma.project.findUnique({ where: { id: input.id } })).toBeNull();
  });
  it("rejects expired repository access before saving a request", async () => {
    const customer = await signIn();
    const input = { id: randomUUID(), inspectionId: await inspectRepository(customer.cookie), summary: "Build an integration with our CRM.", consent: true };
    const inspection = await prisma.inspection.findUniqueOrThrow({ where: { id: input.inspectionId } });
    await prisma.reviewSession.update({ where: { id: inspection.sessionId }, data: { tokenExpiresAt: new Date(0) } });
    expect((await post("/v1/projects", customer.cookie, input)).statusCode).toBe(400);
    expect(await prisma.project.findUnique({ where: { id: input.id } })).toBeNull();
  });
  it("persists stable identity across username changes and uses a separate opaque session", async () => {
    const userId = nextUserId();
    const first = await signIn(userId, "first-name");
    const second = await signIn(userId, "renamed-user");
    expect(second.account.id).toBe(first.account.id);
    expect(second.account.githubLogin).toBe("renamed-user");
    expect(second.callback.headers["set-cookie"]).toContain("HttpOnly");
    const stored = await prisma.accountSession.findMany({
      where: { accountId: second.account.id },
    });
    expect(stored).toHaveLength(2);
    expect(stored.every((item) => item.id.length === 64)).toBe(true);
    expect(JSON.stringify(second.account)).not.toContain(
      "workspace-provider-fixture",
    );
  });
  it("returns backoffice login to admin without granting customers operator access", async () => {
    const customer = await signIn(nextUserId(), "customer", undefined, "admin");
    expect(customer.account.isOperator).toBe(false);
    expect((await app.inject({
      url: "/v1/operator/projects",
      headers: { cookie: customer.cookie },
    })).statusCode).toBe(403);
    const operator = await signIn(900001, "operator", undefined, "admin");
    expect(operator.account.isOperator).toBe(true);
    expect((await app.inject({
      url: "/v1/operator/projects",
      headers: { cookie: operator.cookie },
    })).statusCode).toBe(200);
  });
  it("accepts the exact backoffice origin for authenticated work while rejecting other origins", async () => {
    const customer = await signIn();
    const project = await newProject(customer.cookie);
    expect((await post(`/v1/projects/${project.id}/submit`, customer.cookie, { version: 1 })).statusCode).toBe(200);
    const operator = await signIn(900001, "operator", undefined, "admin");
    const input = { version: 2, summary: "The foundation is ready for a scoped review and the requested workflow checks." };
    const request = (origin: string) => app.inject({
      method: "POST",
      url: `/v1/operator/projects/${project.id}/review`,
      headers: { cookie: operator.cookie, origin, "content-type": "application/json" },
      payload: JSON.stringify(input),
    });
    expect((await request("https://untrusted.example")).statusCode).toBe(403);
    expect((await request(env.ADMIN_ORIGIN)).statusCode).toBe(200);
    const response = await app.inject({
      url: "/v1/auth/session",
      headers: { cookie: operator.cookie, origin: env.ADMIN_ORIGIN },
    });
    expect(response.headers["access-control-allow-origin"]).toBe(env.ADMIN_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
  it("isolates accounts, refuses customer operator access, and retries creation without duplicates", async () => {
    const a = await signIn();
    const b = await signIn(nextUserId(), "operator-looking-name");
    const project = await newProject(a.cookie);
    expect(
      (await post("/v1/projects", a.cookie, project.input)).json(),
    ).toEqual({ id: project.id });
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(1);
    expect(
      (
        await app.inject({
          url: `/v1/projects/${project.id}`,
          headers: { cookie: b.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(`/v1/projects/${project.id}/requests`, b.cookie, {
          id: randomUUID(),
          version: 1,
          kind: "PRD",
          title: "Another owner",
          detail: "Not an authorized change.",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: "/v1/operator/projects",
          headers: { cookie: b.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: "/v1/projects" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/projects/${project.id}/submit`,
          headers: { cookie: a.cookie },
          payload: { version: 1 },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("keeps repository snapshots owned after the browser session expires and rejects another session's inspection", async () => {
    const a = await signIn();
    const b = await signIn();
    const project = await newProject(a.cookie, { accessNote: "" });
    const report = {
      url: "https://github.com/customer/private-app",
      repository: "customer/private-app",
      commit: "a".repeat(40),
      branch: "main",
      stack: ["Next.js"],
      fileCount: 10,
      complete: true,
      limitations: ["Static inventory only"],
    };
    const otherInspection = await prisma.inspection.create({
      data: {
        sessionId: hash(b.review.split("=")[1]!),
        accountId: b.account.id,
        report,
      },
    });
    expect(
      (
        await post(`/v1/projects/${project.id}/repository`, a.cookie, {
          version: 1,
          inspectionId: otherInspection.id,
        })
      ).statusCode,
    ).toBe(400);
    const ownInspection = await prisma.inspection.create({
      data: {
        sessionId: hash(a.review.split("=")[1]!),
        accountId: a.account.id,
        report,
      },
    });
    expect(
      (
        await post(`/v1/projects/${project.id}/repository`, a.cookie, {
          version: 1,
          inspectionId: ownInspection.id,
        })
      ).statusCode,
    ).toBe(200);
    await prisma.reviewSession.delete({
      where: { id: hash(a.review.split("=")[1]!) },
    });
    const saved = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(saved.inspectionReport).toEqual(report);
    expect(
      (
        await app.inject({
          url: `/v1/projects/${project.id}`,
          headers: { cookie: a.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("persists PRD requests, keeps estimates pending, and follows review/approval/build/verification", async () => {
    const customer = await signIn();
    const operator = await signIn(900001, "team");
    const { id } = await newProject(customer.cookie);
    const initial = await detail(id, customer.cookie);
    expect(initial.proposals).toEqual([]);
    expect(initial.reviewSummary).toBeNull();
    expect(
      (
        await post(`/v1/projects/${id}/requests`, customer.cookie, {
          id: randomUUID(),
          version: 1,
          kind: "PRD",
          title: "Recurring booking requirements",
          detail:
            "Every week a customer should be able to reuse their preferred appointment slot.",
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await post(`/v1/projects/${id}/submit`, customer.cookie, { version: 2 }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await post(`/v1/operator/projects/${id}/progress`, operator.cookie, {
          version: 3,
          stage: "BUILDING",
          title: "Starting work",
          detail: "Work must wait for approved scope.",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post(
          `/v1/operator/projects/${id}/proposals`,
          operator.cookie,
          proposal(3),
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post(`/v1/operator/projects/${id}/review`, operator.cookie, {
          version: 3,
          summary:
            "The scheduling foundation exists; recurring bookings and checkout need development and verification.",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(
          `/v1/operator/projects/${id}/proposals`,
          operator.cookie,
          proposal(4),
        )
      ).statusCode,
    ).toBe(201);
    const proposed = await detail(id, customer.cookie);
    expect(proposed.stage).toBe("AWAITING_APPROVAL");
    expect(
      (
        await post(`/v1/projects/${id}/approve`, customer.cookie, {
          version: proposed.version,
          proposalId: proposed.currentProposalId,
          consent: true,
        })
      ).statusCode,
    ).toBe(200);
    let current = await detail(id, customer.cookie);
    // Isolate workspace stage verification; Stripe confirmation is exercised
    // through signed events in delivery.integration.test.ts.
    const agreedMilestones = await prisma.paymentMilestone.findMany({
      where: { proposalId: proposed.currentProposalId! },
    });
    for (const milestone of agreedMilestones)
      await prisma.paymentMilestone.update({
        where: { id: milestone.id },
        data: {
          paidCents: milestone.amountCents,
          paidAt: new Date(),
          attempts: {
            create: {
              status: "PAID",
              mode: "test",
              amountCents: milestone.amountCents,
              currency: "USD",
            },
          },
        },
      });
    for (const stage of ["BUILDING", "VERIFYING"]) {
      expect(
        (
          await post(`/v1/operator/projects/${id}/progress`, operator.cookie, {
            version: current.version,
            stage,
            title: `Now ${stage}`,
            detail: "Shared progress on the agreed acceptance checks.",
          })
        ).statusCode,
      ).toBe(200);
      current = await detail(id, customer.cookie);
    }
    const complete = {
      version: current.version,
      stage: "COMPLETE",
      title: "Ready for handover",
      detail: "The agreed workflows are verified and documented.",
    };
    expect(
      (
        await post(
          `/v1/operator/projects/${id}/progress`,
          operator.cookie,
          complete,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(`/v1/operator/projects/${id}/progress`, operator.cookie, {
          ...complete,
          verificationSummary:
            "Recurring booking and checkout acceptance checks passed. Handover delivered to the customer.",
        })
      ).statusCode,
    ).toBe(200);
    expect((await detail(id, customer.cookie)).stage).toBe("COMPLETE");
  });
  it("rejects stale proposal approvals and serializes concurrent proposal revisions", async () => {
    const customer = await signIn();
    const operator = await signIn(900001, "team");
    const { id } = await newProject(customer.cookie);
    await post(`/v1/projects/${id}/submit`, customer.cookie, { version: 1 });
    await post(`/v1/operator/projects/${id}/review`, operator.cookie, {
      version: 2,
      summary:
        "The app and desired workflows have been reviewed for the proposed scope.",
    });
    const results = await Promise.all([
      post(
        `/v1/operator/projects/${id}/proposals`,
        operator.cookie,
        proposal(3),
      ),
      post(`/v1/operator/projects/${id}/proposals`, operator.cookie, {
        ...proposal(3),
        amountCents: 130000,
      }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      201, 409,
    ]);
    const old = await detail(id, customer.cookie);
    await post(`/v1/operator/projects/${id}/proposals`, operator.cookie, {
      ...proposal(old.version),
      amountCents: 160000,
    });
    expect(
      (
        await post(`/v1/projects/${id}/approve`, customer.cookie, {
          version: old.version,
          proposalId: old.currentProposalId,
          consent: true,
        })
      ).statusCode,
    ).toBe(409);
    const latest = await detail(id, customer.cookie);
    expect(latest.proposals).toHaveLength(2);
    expect(latest.proposals.every((item) => !item.approvedAt)).toBe(true);
    expect(
      (
        await post(`/v1/projects/${id}/approve`, customer.cookie, {
          version: latest.version,
          proposalId: latest.currentProposalId,
          consent: true,
        })
      ).statusCode,
    ).toBe(200);
    const approved = await detail(id, customer.cookie);
    expect(
      (
        await post(
          `/v1/operator/projects/${id}/proposals`,
          operator.cookie,
          proposal(approved.version),
        )
      ).statusCode,
    ).toBe(201);
    expect((await detail(id, customer.cookie)).stage).toBe("AWAITING_APPROVAL");
  });
  it("requires an updated proposal when its delivery estimate has passed", async () => {
    const customer = await signIn();
    const operator = await signIn(900001, "team");
    const { id } = await newProject(customer.cookie);
    await post(`/v1/projects/${id}/submit`, customer.cookie, { version: 1 });
    await post(`/v1/operator/projects/${id}/review`, operator.cookie, {
      version: 2,
      summary:
        "The app and requested journeys have been reviewed for a focused proposal.",
    });
    await post(
      `/v1/operator/projects/${id}/proposals`,
      operator.cookie,
      proposal(3),
    );
    const current = await detail(id, customer.cookie);
    await prisma.proposal.update({
      where: { id: current.currentProposalId! },
      data: { deliveryDate: new Date("2000-01-01T00:00:00Z") },
    });
    const response = await post(`/v1/projects/${id}/approve`, customer.cookie, {
      version: current.version,
      proposalId: current.currentProposalId,
      consent: true,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ESTIMATE_EXPIRED");
    expect((await detail(id, customer.cookie)).stage).toBe("AWAITING_APPROVAL");
  });
  it("requires repository evidence or access constraints before review", async () => {
    const customer = await signIn();
    const { id } = await newProject(customer.cookie, { accessNote: "" });
    expect(
      (await post(`/v1/projects/${id}/submit`, customer.cookie, { version: 1 }))
        .statusCode,
    ).toBe(400);
    expect((await detail(id, customer.cookie)).stage).toBe("DRAFT");
    expect(
      (
        await post(`/v1/projects/${id}/access`, customer.cookie, {
          version: 1,
          accessNote:
            "The code is still in the builder; start with a demo review.",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await post(`/v1/projects/${id}/submit`, customer.cookie, { version: 2 }))
        .statusCode,
    ).toBe(200);
  });
  it("rejects reconnecting a different GitHub identity", async () => {
    const customer = await signIn();
    identity = { id: nextUserId(), login: "different-user", name: "Different" };
    const start = await app.inject({
      url: "/v1/github/connect?flow=workspace",
      headers: { cookie: customer.cookie },
    });
    const state = new URL(start.headers.location!).searchParams.get("state")!;
    const callback = await app.inject({
      url: `/v1/github/callback?state=${state}&code=test`,
      headers: { cookie: customer.cookie },
    });
    expect(callback.headers.location).toContain("github=identity");
    expect(
      (
        await app.inject({
          url: "/v1/auth/session",
          headers: { cookie: customer.cookie },
        })
      ).json().account.id,
    ).toBe(customer.account.id);
  });
  it("logout cancels a delayed login exchange", async () => {
    const review = await browser();
    identity = { id: nextUserId(), login: "delayed-user", name: "Delayed" };
    const start = await app.inject({
      url: "/v1/github/connect?flow=login",
      headers: { cookie: review },
    });
    const state = new URL(start.headers.location!).searchParams.get("state")!;
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    exchangeHook = async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const callback = app.inject({
      url: `/v1/github/callback?state=${state}&code=test`,
      headers: { cookie: review },
    });
    await waiting;
    expect((await post("/v1/auth/logout", review, {})).statusCode).toBe(200);
    release();
    const response = await callback;
    exchangeHook = async () => {};
    expect(response.headers.location).toContain("github=error");
    expect(cookies(response)).not.toContain("m8_account_session");
  });
  it("logout revokes the browser-bound session even before its account cookie is received", async () => {
    const customer = await signIn();
    expect(
      (await post("/v1/auth/logout", customer.review, {})).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/v1/auth/session",
          headers: { cookie: customer.cookie },
        })
      ).json().account,
    ).toBeNull();
    const review = await prisma.reviewSession.findUniqueOrThrow({
      where: { id: hash(customer.review.split("=")[1]!) },
    });
    expect(review.tokenEncrypted).toBeNull();
    expect(review.accountSessionId).toBeNull();
  });
  it("revokes both completed login sessions even when their cookies arrive late", async () => {
    const first = await signIn();
    const second = await signIn(nextUserId(), "second", first.review);
    expect(
      (
        await app.inject({
          url: "/v1/auth/session",
          headers: { cookie: first.cookie },
        })
      ).json().account,
    ).toBeNull();
    expect((await post("/v1/auth/logout", first.review, {})).statusCode).toBe(
      200,
    );
    for (const cookie of [first.cookie, second.cookie])
      expect(
        (
          await app.inject({ url: "/v1/auth/session", headers: { cookie } })
        ).json().account,
      ).toBeNull();
  });
  it("does not expose or link a private inspection after switching accounts in the same browser", async () => {
    const first = await signIn();
    const scan = await post("/v1/github/inspect", first.cookie, {
      repositoryUrl: "https://github.com/customer/private-app",
    });
    expect(scan.statusCode).toBe(200);
    const inspectionId = scan.json().id;
    expect(
      (
        await prisma.inspection.findUniqueOrThrow({
          where: { id: inspectionId },
        })
      ).accountId,
    ).toBe(first.account.id);
    const second = await signIn(nextUserId(), "second", first.review);
    const project = await newProject(second.cookie);
    expect(
      (
        await post(`/v1/projects/${project.id}/repository`, second.cookie, {
          version: 1,
          inspectionId,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: "/v1/session",
          headers: { cookie: second.cookie },
        })
      ).json().inspection,
    ).toBeNull();
    const intake = await post("/v1/intakes", second.cookie, {
      name: "Second",
      email: "second@example.invalid",
      projectName: "Second project",
      platform: "Lovable",
      problem: "Review this app and its customer flows.",
      workflows: ["Payments"],
      consent: true,
      inspectionId,
    });
    expect(intake.statusCode).toBe(400);
    expect(intake.json().error.code).toBe("INSPECTION_UNAVAILABLE");
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: project.id } }))
        .inspectionReport,
    ).toBeNull();
  });
  it("discards an in-flight private inspection after logout or account rotation", async () => {
    for (const action of ["logout", "rotate"]) {
      const first = await signIn();
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      inspectHook = async () => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      };
      const scan = post("/v1/github/inspect", first.cookie, {
        repositoryUrl: "https://github.com/customer/private-app",
      });
      await waiting;
      try {
        if (action === "logout")
          await post("/v1/auth/logout", first.cookie, {});
        else await signIn(nextUserId(), "second", first.review);
      } finally {
        release();
        inspectHook = async () => {};
      }
      const response = await scan;
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("CONNECTION_CHANGED");
      expect(
        await prisma.inspection.count({
          where: { sessionId: hash(first.review.split("=")[1]!) },
        }),
      ).toBe(0);
    }
  });
});
