import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config.js";
import { decrypt, hash } from "../src/crypto.js";
import type { InspectionReport } from "../src/github/client.js";

const dbUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!dbUrl)("durable intake and private GitHub connection", () => {
  const prisma = new PrismaClient({
    datasourceUrl:
      dbUrl ?? "postgresql://unused:unused@localhost:5432/m8itwork_test",
  });
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: dbUrl,
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    GITHUB_APP_SLUG: "test-review",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let exchangeCount = 0;
  let writePermission = false;
  let exchangeHook = async () => {};
  const sessionIds: string[] = [];
  const submissionIds: string[] = [];
  const token = "github-test-user-token";
  const commit = "a".repeat(40);
  const project = {
    name: "Test Builder",
    email: "test@example.invalid",
    projectName: "Booking App",
    platform: "Lovable",
    demoUrl: "",
    problem: "Customers cannot finish checkout after choosing a date.",
    workflows: ["Payments"],
    consent: true,
  };
  beforeAll(async () => {
    if (!dbUrl || !new URL(dbUrl).pathname.endsWith("/m8itwork_test"))
      throw new Error(
        "Integration tests require a dedicated m8itwork_test database.",
      );
    app = await buildApp({
      env,
      prisma,
      logger: false,
      rateLimiting: false,
      fetcher: async (url, options) => {
        const target =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url;
        const path = new URL(target).pathname;
        const headers = new Headers(options?.headers);
        if (path === "/apps/test-review")
          return Response.json({
            client_id: "test-client",
            permissions: {
              contents: writePermission ? "write" : "read",
              metadata: "read",
            },
          });
        if (path === "/login/oauth/access_token") {
          exchangeCount++;
          await exchangeHook();
          if (typeof options?.body !== "string")
            throw new Error("Expected JSON OAuth exchange body.");
          const body = JSON.parse(options.body) as Record<string, string>;
          expect(body.code_verifier?.length).toBe(43);
          expect(body.client_secret).toBe("test-secret");
          return Response.json({ access_token: token, expires_in: 28800 });
        }
        if (path === "/user") {
          expect(headers.get("authorization")).toBe(`Bearer ${token}`);
          return Response.json({ login: "builder", id: 123456 });
        }
        if (path === "/user/installations")
          return Response.json({ total_count: 1, installations: [{ id: 10 }] });
        if (path === "/user/installations/10/repositories")
          return Response.json({
            total_count: 1,
            repositories: [
              {
                full_name: "builder/private-app",
                html_url: "https://github.com/builder/private-app",
                private: true,
              },
            ],
          });
        if (
          path.includes("/repos/builder/private-app") &&
          headers.get("authorization") !== `Bearer ${token}`
        )
          return new Response(null, { status: 404 });
        if (path.includes("/branches/"))
          return Response.json({ commit: { sha: commit } });
        if (path.includes("/git/trees/"))
          return Response.json({
            truncated: false,
            tree: [
              {
                path: "package.json",
                type: "blob",
                sha: "b".repeat(40),
                size: 100,
              },
            ],
          });
        if (path.includes("/git/blobs/"))
          return Response.json({
            encoding: "base64",
            content: Buffer.from('{"dependencies":{"next":"16"}}').toString(
              "base64",
            ),
          });
        const repository = path.split("/").slice(2, 4).join("/");
        return Response.json({
          full_name: repository,
          html_url: `https://github.com/${repository}`,
          private: repository.endsWith("private-app"),
          default_branch: "main",
          language: "TypeScript",
          archived: false,
        });
      },
    });
  });
  afterAll(async () => {
    if (submissionIds.length)
      await prisma.submission.deleteMany({
        where: { id: { in: submissionIds } },
      });
    if (sessionIds.length)
      await prisma.reviewSession.deleteMany({
        where: { id: { in: sessionIds } },
      });
    if (app) await app.close();
    else await prisma.$disconnect();
  });
  async function browser() {
    const response = await app.inject({ url: "/v1/session" });
    expect(response.statusCode).toBe(200);
    const raw = response.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0]! : raw!).split(";", 1)[0]!;
    sessionIds.push(hash(cookie.split("=")[1]!));
    return cookie;
  }
  it("saves a manual brief durably and blocks cross-origin submission", async () => {
    const cookie = await browser();
    const response = await app.inject({
      method: "POST",
      url: "/v1/intakes",
      headers: { cookie },
      payload: project,
    });
    expect(response.statusCode).toBe(201);
    const result = response.json<{ id: string }>();
    submissionIds.push(result.id);
    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(stored.problem).toBe(project.problem);
    expect(stored.inspectionReport).toBeNull();
    const csrf = await app.inject({
      method: "POST",
      url: "/v1/intakes",
      headers: { cookie, origin: "https://evil.test" },
      payload: project,
    });
    expect(csrf.statusCode).toBe(403);
  });
  it("validates consent and meaningful brief fields", async () => {
    const cookie = await browser();
    for (const payload of [
      { ...project, consent: false },
      { ...project, problem: "broken" },
      { ...project, workflows: [] },
      { ...project, demoUrl: "https://user:password@example.com" },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/intakes",
            headers: { cookie },
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
  });
  it("remembers only the selected inspection, keeps removals private, and clears selection after submission", async () => {
    const cookie = await browser();
    const other = await browser();
    const inspect = async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/github/inspect",
        headers: { cookie },
        payload: { repositoryUrl: "https://github.com/builder/public-app" },
      });
      expect(response.statusCode).toBe(200);
      return response.json<{ id: string }>();
    };
    const selected = async () =>
      (await app.inject({ url: "/v1/session", headers: { cookie } })).json<{
        inspection: { id: string } | null;
      }>().inspection;
    const first = await inspect();
    expect((await selected())?.id).toBe(first.id);
    await app.inject({
      method: "POST",
      url: "/v1/inspection-selection/remove",
      headers: { cookie: other },
      payload: { inspectionId: first.id },
    });
    expect((await selected())?.id).toBe(first.id);
    const removed = await app.inject({
      method: "POST",
      url: "/v1/inspection-selection/remove",
      headers: { cookie },
      payload: { inspectionId: first.id },
    });
    expect(removed.statusCode).toBe(200);
    expect(await selected()).toBeNull();
    const second = await inspect();
    // A delayed removal of the previous report must not remove the new one.
    await app.inject({
      method: "POST",
      url: "/v1/inspection-selection/remove",
      headers: { cookie },
      payload: { inspectionId: first.id },
    });
    expect((await selected())?.id).toBe(second.id);
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/intakes",
      headers: { cookie },
      payload: {
        ...project,
        workflows: ["New features"],
        problem: "We want to add team accounts and CRM synchronization.",
        inspectionId: second.id,
      },
    });
    expect(submitted.statusCode).toBe(201);
    submissionIds.push(submitted.json<{ id: string }>().id);
    expect(await selected()).toBeNull();
  });
  it.each(["disconnect", "new connection"])(
    "does not restore access from a delayed callback after %s",
    async (action) => {
      const cookie = await browser();
      const start = await app.inject({
        url: "/v1/github/connect",
        headers: { cookie },
      });
      const state = new URL(start.headers.location!).searchParams.get("state")!;
      let entered!: () => void;
      const atExchange = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      exchangeHook = async () => {
        entered();
        await gate;
      };
      const callback = app
        .inject({
          url: `/v1/github/callback?code=test-code&state=${state}`,
          headers: { cookie },
        })
        .then((result) => result);
      try {
        await atExchange;
        if (action === "disconnect")
          await app.inject({
            method: "POST",
            url: "/v1/github/disconnect",
            headers: { cookie },
            payload: {},
          });
        else
          await app.inject({ url: "/v1/github/connect", headers: { cookie } });
      } finally {
        release();
        exchangeHook = async () => {};
      }
      expect((await callback).headers.location).toContain("github=error");
      const stored = await prisma.reviewSession.findUniqueOrThrow({
        where: { id: hash(cookie.split("=")[1]!) },
      });
      expect(stored.tokenEncrypted).toBeNull();
      expect(stored.githubLogin).toBeNull();
    },
  );
  it("blocks non-read-only GitHub App configuration", async () => {
    writePermission = true;
    const response = await app.inject({ url: "/v1/github/connect" });
    writePermission = false;
    expect(response.statusCode).toBe(503);
  });
  it("binds OAuth to the initiating browser, encrypts credentials, and rejects replay", async () => {
    const cookie = await browser();
    const other = await browser();
    const start = await app.inject({
      url: "/v1/github/connect",
      headers: { cookie },
    });
    const authorize = new URL(start.headers.location!);
    expect(authorize.searchParams.get("scope")).toBeNull();
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorize.searchParams.get("state")!;
    const callback = `/v1/github/callback?code=test-code&state=${state}`;
    const before = exchangeCount;
    const wrong = await app.inject({
      url: callback,
      headers: { cookie: other },
    });
    expect(wrong.headers.location).toContain("github=error");
    expect(exchangeCount).toBe(before);
    const success = await app.inject({ url: callback, headers: { cookie } });
    expect(success.headers.location).toContain("github=connected");
    expect(exchangeCount).toBe(before + 1);
    const stored = await prisma.reviewSession.findUniqueOrThrow({
      where: { id: hash(cookie.split("=")[1]!) },
    });
    expect(stored.tokenEncrypted).not.toContain(token);
    expect(decrypt(stored.tokenEncrypted!, env.TOKEN_ENCRYPTION_KEY)).toBe(
      token,
    );
    expect(stored.oauthStateHash).toBeNull();
    const replay = await app.inject({ url: callback, headers: { cookie } });
    expect(replay.headers.location).toContain("github=error");
    expect(exchangeCount).toBe(before + 1);
    const connected = (
      await app.inject({ url: "/v1/session", headers: { cookie } })
    ).json<{ githubLogin: string; repositories: unknown[] }>();
    expect(connected.githubLogin).toBe("builder");
    expect(connected.repositories).toHaveLength(1);
    const inspection = (
      await app.inject({
        method: "POST",
        url: "/v1/github/inspect",
        headers: { cookie },
        payload: { repositoryUrl: "https://github.com/builder/private-app" },
      })
    ).json<InspectionReport & { id: string }>();
    expect(inspection.repository).toBe("builder/private-app");
    const attach = await app.inject({
      method: "POST",
      url: "/v1/intakes",
      headers: { cookie },
      payload: { ...project, inspectionId: inspection.id },
    });
    expect(attach.statusCode).toBe(201);
    submissionIds.push(attach.json<{ id: string }>().id);
    const unauthorized = await app.inject({
      method: "POST",
      url: "/v1/intakes",
      headers: { cookie: other },
      payload: { ...project, inspectionId: inspection.id },
    });
    expect(unauthorized.statusCode).toBe(400);
    await app.inject({
      method: "POST",
      url: "/v1/github/disconnect",
      headers: { cookie },
      payload: {},
    });
    const disconnected = await prisma.reviewSession.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(disconnected.tokenEncrypted).toBeNull();
    const privateAccess = await app.inject({
      method: "POST",
      url: "/v1/github/inspect",
      headers: { cookie },
      payload: { repositoryUrl: "https://github.com/builder/private-app" },
    });
    expect(privateAccess.statusCode).toBe(404);
  });
});
