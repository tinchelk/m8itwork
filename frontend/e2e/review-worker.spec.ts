import { expect, test } from "@playwright/test";
import { mockWorkspace } from "./fixtures/workspace";
const report = { summary: "Authentication needs verified sessions before launch.", findings: [{ severity: "high", detail: "Session validation is missing from the sample.", evidence: ["src/auth.ts"] }], scope: "Implement signed sessions and route protection.", acceptance: "Verify valid login, invalid credentials, logout and protected access.", assumptions: "Static sample; no workflows were run.", questions: ["Which provider should handle identity?"], effort: { minHours: 8, maxHours: 16, confidence: "low" } };
test("queues a private review, adds editable drafts and plans cost without publishing", async ({ page }, info) => {
  const state = await mockWorkspace(page, { operator: true });
  state.project.stage = "IN_REVIEW"; state.project.repositoryUrl = "https://github.com/builder/private-app"; state.project.aiReviewConsentAt = new Date().toISOString();
  let job: Record<string, unknown> | null = null;
  await page.route("**/review-jobs", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { id: string };
      job = { id: body.id, status: "SUCCEEDED", provider: "codex", commit: "a".repeat(40), createdAt: new Date().toISOString(), stale: false, result: report, coverage: { readFiles: 2, eligibleFiles: 4, limitations: ["Static sample only."] } };
      state.project.version++;
      await route.fulfill({ json: { id: body.id } });
    } else await route.fulfill({ json: { jobs: job ? [job] : [], onlineWorkers: 1 } });
  });
  await page.goto("http://127.0.0.1:3131/");
  await page.locator(".portal-project-link").filter({ hasText: "Bloom bookings" }).click();
  await page.getByRole("button", { name: "Queue review", exact: true }).click();
  await expect(page.getByText("Draft ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Open full reply from/ }).click();
  await expect(page.getByRole("heading", { name: /Full reply/ })).toBeFocused();
  expect(await page.getByRole("heading", { name: /Full reply/ }).evaluate(el => el.getBoundingClientRect().top >= (document.querySelector(".portal-alerts")?.getBoundingClientRect().bottom ?? 0))).toBe(true);
  expect(state.project.reviewSummary).toBeNull(); expect(state.project.proposals).toHaveLength(0);
  await page.getByLabel("Review summary", { exact: true }).fill("My existing operator observations.");
  await page.getByRole("button", { name: "Add to review draft" }).click();
  await expect(page.getByLabel("Review summary", { exact: true })).toHaveValue(/My existing operator observations[\s\S]*Authentication needs/);
  await page.getByRole("button", { name: "Add to scope draft" }).click();
  await expect(page.locator("textarea[name=scope]")).toHaveValue(report.scope);
  await expect(page.locator("input[name=amount]")).toHaveValue("");
  await page.getByText("Plan cost & working time", { exact: true }).click();
  await page.getByLabel("Your hourly rate").fill("100");
  await expect(page.getByText(/\$960–\$1,920/)).toBeVisible();
  await page.locator(".review-assistant").screenshot({ path: info.outputPath(`review-assistant-${info.project.name}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.project.proposals).toHaveLength(0);
});
test("permission is owned by the customer and can be withdrawn", async ({ page }) => {
  const state = await mockWorkspace(page);
  state.project.stage = "IN_REVIEW";
  await page.goto("/dashboard");
  await page.locator(".dashboard-project").click();
  await page.getByText("AI-assisted review permission", { exact: true }).click();
  await page.getByRole("button", { name: "Allow AI-assisted review" }).click();
  await expect(page.getByRole("button", { name: "Withdraw permission" })).toBeVisible();
  await page.getByRole("button", { name: "Withdraw permission" }).click();
  await expect(page.getByRole("button", { name: "Allow AI-assisted review" })).toBeVisible();
  expect(state.operatorRequests).toBe(0);
});
test("stale AI drafts cannot be imported and manual review remains available", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true }); state.project.stage = "IN_REVIEW";
  await page.route("**/review-jobs", route => route.fulfill({ json: { onlineWorkers: 0, jobs: [{ id: "fixture", status: "SUCCEEDED", provider: "codex", commit: "a".repeat(40), stale: true, createdAt: new Date().toISOString(), result: report, coverage: { readFiles: 2, eligibleFiles: 4, limitations: ["Static sample only."] } }] } }));
  await page.goto("http://127.0.0.1:3131/"); await page.locator(".portal-project-link").filter({ hasText: "Bloom bookings" }).click();
  await expect(page.getByRole("button", { name: "Add to review draft" })).toBeDisabled();
  await expect(page.getByText(/Requests or repository evidence changed/)).toBeVisible();
  await page.getByLabel("Review summary", { exact: true }).fill("Manual review completed. Next we should agree on verified session support.");
  await page.getByRole("button", { name: "Publish review", exact: true }).click();
  await expect(page.getByText("Review published.", { exact: true })).toBeVisible();
});

test("submitted projects reconnect credentials and return to the saved project", async ({ page }) => {
  const state = await mockWorkspace(page); state.project.stage = "IN_REVIEW";
  state.project.repositoryUrl = "https://github.com/builder/private-app";
  state.connection!.githubLogin = null;
  await page.goto(`/dashboard?project=${state.project.id}`);
  const connection = page.getByRole("link", { name: "Connect GitHub" });
  await expect(connection).toBeVisible();
  await page.route("**/v1/github/connect?flow=repositories", route => route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:3130/dashboard?github=connected` } }));
  await connection.click();
  await expect(page.getByRole("heading", { name: "Bloom bookings", exact: true })).toBeVisible();
  expect(state.project.repositoryUrl).toBe("https://github.com/builder/private-app");
});

test("previous successful drafts remain available after a newer quota failure", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true }); state.project.stage = "IN_REVIEW"; state.project.aiReviewConsentAt = new Date().toISOString();
  await page.route("**/review-jobs", route => route.fulfill({ json: { onlineWorkers: 0, jobs: [
    { id: "new", status: "FAILED", provider: "codex", commit: "a".repeat(40), createdAt: new Date().toISOString(), stale: false, result: null, errorCode: "QUOTA" },
    { id: "old", status: "SUCCEEDED", provider: "codex", commit: "a".repeat(40), createdAt: new Date().toISOString(), stale: false, result: report, coverage: { readFiles: 2, eligibleFiles: 4, limitations: ["Static sample only."] } },
  ] } }));
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await expect(page.locator(".review-assistant > .portal-notice").filter({ hasText: "Subscription limit reached" })).toBeVisible();
  await page.getByLabel("Review history").selectOption("old");
  await expect(page.getByRole("button", { name: "Add to review draft" })).toBeEnabled();
  await page.getByRole("button", { name: "Add to review draft" }).click();
  await expect(page.getByLabel("Review summary", { exact: true })).toHaveValue(/Authentication needs verified sessions/);
});

test("a confirmed lost queue response does not reuse its ID for a fresh review", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true }); state.project.stage = "IN_REVIEW"; state.project.aiReviewConsentAt = new Date().toISOString(); state.project.repositoryUrl = "https://github.com/builder/private-app";
  const ids: string[] = []; const jobs: Record<string, unknown>[] = [];
  await page.route("**/review-jobs", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { id: string; provider: string }; ids.push(body.id);
      jobs.unshift({ id: body.id, status: "FAILED", provider: body.provider, commit: "a".repeat(40), createdAt: new Date().toISOString(), stale: false, result: null, errorCode: "QUOTA" });
      if (ids.length === 1) await route.abort("connectionreset"); else await route.fulfill({ json: { id: body.id } });
    } else await route.fulfill({ json: { jobs, onlineWorkers: 1 } });
  });
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await page.getByLabel("Follow-up question or review instructions (optional)", { exact: true }).fill("Acknowledge this saved prompt after polling.");
  await page.getByRole("button", { name: "Queue review", exact: true }).click();
  // Polling observes the committed job after its upload response was lost.
  await expect(page.getByRole("button", { name: "Run a fresh review", exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel("Follow-up question or review instructions (optional)", { exact: true })).toHaveValue("");
  await page.getByLabel("Coding agent").selectOption("claude");
  await page.getByRole("button", { name: "Run a fresh review", exact: true }).click();
  await expect.poll(() => ids.length).toBe(2); expect(ids[0]).not.toBe(ids[1]);
});

test("provider problems and visible activity are actionable in backoffice", async ({ page }, info) => {
  const state = await mockWorkspace(page, { operator: true });
  state.project.stage = "IN_REVIEW"; state.project.aiReviewConsentAt = new Date().toISOString(); state.project.repositoryUrl = "https://github.com/builder/private-app";
  const now = new Date().toISOString();
  const workers = ["NEEDS_LOGIN", "LIMITED", "ERROR", "BUSY"].map((status, i) => ({ id: `worker-${i}`, name: `Review host ${i}`, lastSeenAt: now, statusAt: now, revokedAt: null, providerStatus: [{ provider: "codex", state: status }], jobs: status === "BUSY" ? [{ id: "running", projectId: state.project.id, provider: "codex" }] : [] }));
  await page.route("**/review-workers", route => route.fulfill({ json: { workers } }));
  await page.route("**/review-jobs", route => route.fulfill({ json: { onlineWorkers: 4, workers, jobs: [{ id: "running", status: "RUNNING", provider: "codex", commit: "a".repeat(40), createdAt: now, stale: false, instructions: "Check identity before we quote.", result: null, activity: [{ id: "progress", kind: "MESSAGE", text: "Visible decision: verify the session boundary.", at: now }] }] } }));
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await expect(page.getByText("Sign-in needed", { exact: true })).toBeVisible();
  await expect(page.getByText("Subscription limit reached", { exact: true })).toBeVisible();
  await expect(page.getByText("Provider error", { exact: true })).toBeVisible();
  await expect(page.getByText("Working", { exact: true })).toBeVisible();
  await expect(page.getByText(/worker login-codex/)).toBeVisible();
  await expect(page.getByText("Visible decision: verify the session boundary.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review in progress", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel review", exact: true })).toBeVisible();
  await page.locator(".review-assistant").screenshot({ path: info.outputPath(`remote-review-${info.project.name}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("http://127.0.0.1:3131/");
  await page.getByText("Worker setup", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Open the project codex is reviewing" })).toHaveAttribute("href", `/?project=${state.project.id}`);
  workers[0]!.lastSeenAt = workers[0]!.statusAt = "2000-01-01T00:00:00.000Z";
  await page.getByRole("button", { name: "Refresh worker status", exact: true }).click();
  await expect(page.getByText("Status stale / offline", { exact: true })).toBeVisible();
});

test("follow-up prompts retry unchanged and clear after acknowledgement", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true }); state.project.stage = "IN_REVIEW"; state.project.aiReviewConsentAt = new Date().toISOString(); state.project.repositoryUrl = "https://github.com/builder/private-app";
  const prior = { id: "prior", status: "SUCCEEDED", provider: "codex", commit: "a".repeat(40), createdAt: new Date().toISOString(), stale: false, instructions: "Review identity.", result: report, coverage: { readFiles: 2, eligibleFiles: 4, limitations: [] } };
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/review-jobs", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>; bodies.push(body);
      if (bodies.length === 1) return route.abort("connectionreset");
      state.project.version++; return route.fulfill({ json: { id: body.id } });
    }
    await route.fulfill({ json: { jobs: [prior], onlineWorkers: 1 } });
  });
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await page.getByLabel("Coding agent").selectOption("claude");
  await page.getByRole("button", { name: "Ask a follow-up", exact: true }).click();
  const question = page.getByLabel("Follow-up question or review instructions", { exact: true });
  await expect(question).toBeFocused(); await question.fill("What acceptance checks should we agree on?");
  await page.reload();
  await expect(page.getByLabel("Coding agent")).toHaveValue("claude"); await expect(question).toHaveValue("What acceptance checks should we agree on?");
  await page.getByRole("button", { name: "Send follow-up", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry queue request", exact: true })).toBeVisible();
  let failHistory = true;
  await page.route("**/review-jobs", async route => {
    if (route.request().method() === "GET") return failHistory ? route.fulfill({ status: 500, json: { error: { message: "Review history temporarily unavailable." } } }) : route.fulfill({ json: { jobs: [prior], onlineWorkers: 1 } });
    const body = route.request().postDataJSON() as Record<string, unknown>; bodies.push(body);
    state.signedOut = true; return route.fulfill({ status: 401, json: { error: { message: "Sign in again to recover this saved request." } } });
  });
  await page.reload();
  await expect(page.locator(".review-assistant").getByRole("alert")).toContainText("Review history temporarily unavailable.");
  await expect(page.getByRole("button", { name: "Retry queue request", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Coding agent")).toHaveValue("claude");
  let failLookup = true;
  await page.route("**/review-jobs/*", route => failLookup ? route.fulfill({ status: 500, json: { error: { message: "Saved review temporarily unavailable." } } }) : route.fulfill({ status: 404, json: { error: { message: "Request not saved yet." } } }));
  failHistory = false; await page.locator(".review-assistant").getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".review-assistant").getByRole("alert")).toContainText("Saved review temporarily unavailable.");
  await expect(page.getByRole("button", { name: "Retry queue request", exact: true })).toBeDisabled();
  failLookup = false; await page.locator(".review-assistant").getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry queue request", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Retry queue request", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to the backoffice.", exact: true })).toBeVisible();
  state.signedOut = false;
  await page.unroute("**/review-jobs");
  await page.route("**/review-jobs", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { jobs: [prior], onlineWorkers: 1 } });
    const body = route.request().postDataJSON() as Record<string, unknown>; bodies.push(body); state.project.version++; return route.fulfill({ json: { id: body.id } });
  });
  await page.reload(); await expect(page.getByRole("button", { name: "Retry queue request", exact: true })).toBeVisible();
  await expect(question).toBeDisabled(); await page.getByRole("button", { name: "Retry queue request", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(3); expect(bodies[0]).toEqual(bodies[1]); expect(bodies[0]).toEqual(bodies[2]);
  expect(bodies[1]).toMatchObject({ provider: "claude", parentJobId: "prior", instructions: "What acceptance checks should we agree on?" });
  await expect(page.getByLabel("Follow-up question or review instructions (optional)", { exact: true })).toHaveValue(""); await expect(page.getByRole("button", { name: "Run a fresh review", exact: true })).toBeVisible();
  expect(state.project.reviewSummary).toBeNull(); expect(state.project.proposals).toHaveLength(0);
});

test("older conversations remain available and changed evidence blocks continuation", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true }); state.project.stage = "IN_REVIEW"; state.project.aiReviewConsentAt = new Date().toISOString(); state.project.repositoryUrl = "https://github.com/builder/private-app";
  let digest = "current";
  const job = (id: string) => ({ id, status: "SUCCEEDED", provider: "codex", commit: "a".repeat(40), createdAt: new Date().toISOString(), stale: false, inputDigest: "current", result: report, instructions: `Saved prompt ${id}`, coverage: { readFiles: 2, eligibleFiles: 4, limitations: [] } });
  await page.route("**/review-jobs*", route => route.fulfill({ json: { onlineWorkers: 1, evidenceDigest: digest, jobs: Array.from({ length: 10 }, (_, i) => job(route.request().url().includes("cursor=") ? i === 0 ? "older" : `older-${i}` : i === 0 ? "newer" : `newer-${i}`)), nextCursor: route.request().url().includes("cursor=") ? null : "newer" } }));
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await page.getByRole("button", { name: "Load older reviews", exact: true }).click();
  await expect(page.getByText("Saved prompt older", { exact: true })).toBeVisible();
  await page.getByLabel("Review history").selectOption("older");
  await expect(page.getByRole("button", { name: "Ask a follow-up", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Open full reply from", exact: false }).first().click();
  await expect(page.getByRole("heading", { name: /Full reply/ })).toBeFocused();
  expect(await page.getByRole("heading", { name: /Full reply/ }).evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })).toBe(true);
  if (test.info().project.name === "mobile") expect(await page.getByLabel("Coding agent").evaluate(el => getComputedStyle(el).fontSize)).toBe("16px");
  digest = "changed"; state.project.version++;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ask a follow-up", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add to review draft", exact: true })).toBeDisabled();
  await expect(page.getByText("Saved prompt older", { exact: true })).toBeVisible();
});

test("completed cached activity cannot block the current queue", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true }); state.project.stage = "IN_REVIEW"; state.project.aiReviewConsentAt = new Date().toISOString(); state.project.repositoryUrl = "https://github.com/builder/private-app";
  let updated = false;
  const saved = { id: "cached", status: "RUNNING", provider: "codex", commit: "a".repeat(40), createdAt: "2026-10-01T12:00:00Z", stale: false, result: null as typeof report | null, coverage: { readFiles: 2, eligibleFiles: 4, limitations: [] } };
  await page.route("**/review-jobs*", route => route.fulfill({ json: { onlineWorkers: 1, jobs: route.request().url().includes("cursor=") ? [{ ...saved, status: "SUCCEEDED", result: report }] : updated ? [{ ...saved, id: "latest", status: "SUCCEEDED", createdAt: "2026-10-07T12:00:00Z", result: report }] : [saved], nextCursor: updated && !route.request().url().includes("cursor=") ? "latest" : null } }));
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await expect(page.getByRole("button", { name: "Review in progress", exact: true })).toBeDisabled();
  updated = true; state.project.version++; await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run a fresh review", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Load older reviews", exact: true }).click();
  await page.getByLabel("Review history").selectOption("cached");
  await expect(page.getByRole("button", { name: "Ask a follow-up", exact: true })).toBeEnabled();
});

test("a rejected queue request unlocks the saved question for correction", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true }); state.project.stage = "IN_REVIEW"; state.project.aiReviewConsentAt = new Date().toISOString(); state.project.repositoryUrl = "https://github.com/builder/private-app";
  await page.route("**/review-jobs", route => route.request().method() === "POST" ? route.fulfill({ status: 409, json: { error: { code: "STALE_CONVERSATION", message: "Start a fresh review after requests change." } } }) : route.fulfill({ json: { jobs: [], onlineWorkers: 1 } }));
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  const question = page.getByLabel("Follow-up question or review instructions (optional)", { exact: true }); await question.fill("Preserve this operator question.");
  await page.getByRole("button", { name: "Queue review", exact: true }).click();
  await expect(question).toBeEnabled(); await expect(question).toHaveValue("Preserve this operator question.");
  await page.reload(); await expect(question).toHaveValue("Preserve this operator question.");
});

test("follow-up recovery belongs to the original account through reauthentication", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true }); state.project.stage = "IN_REVIEW"; state.project.aiReviewConsentAt = new Date().toISOString(); state.project.repositoryUrl = "https://github.com/builder/private-app";
  await page.route("**/review-jobs", route => route.fulfill({ json: { onlineWorkers: 1, jobs: [{ id: "prior", status: "SUCCEEDED", provider: "codex", commit: "a".repeat(40), createdAt: new Date().toISOString(), stale: false, result: report, coverage: { readFiles: 2, eligibleFiles: 4, limitations: [] } }] } }));
  const url = `http://127.0.0.1:3131/?project=${state.project.id}`;
  await page.goto(url); await page.getByLabel("Coding agent").selectOption("claude"); await page.getByRole("button", { name: "Ask a follow-up", exact: true }).click();
  await page.getByLabel("Follow-up question or review instructions", { exact: true }).fill("Keep my selected agent and earlier reply.");
  state.signedOut = true; await page.reload(); await expect(page.getByRole("heading", { name: "Sign in to the backoffice.", exact: true })).toBeVisible();
  state.signedOut = false; state.accountId = "other-operator"; await page.goto(url);
  await expect(page.getByLabel("Coding agent")).toHaveValue("codex"); await expect(page.getByLabel("Follow-up question or review instructions (optional)", { exact: true })).toHaveValue("");
  state.accountId = "customer"; await page.goto(url);
  await expect(page.getByLabel("Coding agent")).toHaveValue("claude"); await expect(page.getByLabel("Follow-up question or review instructions", { exact: true })).toHaveValue("Keep my selected agent and earlier reply.");
});

test("reload reconciles a lost response even after its job leaves the recent page", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true }); state.project.stage = "IN_REVIEW"; state.project.aiReviewConsentAt = new Date().toISOString(); state.project.repositoryUrl = "https://github.com/builder/private-app";
  let calls = 0, saved: Record<string, unknown> | null = null;
  await page.route("**/review-jobs", async route => {
    if (route.request().method() === "POST") { calls++; const body = route.request().postDataJSON() as { id: string; instructions: string }; saved = { ...body, status: "SUCCEEDED", commit: "a".repeat(40), createdAt: "2026-10-01T12:00:00Z", stale: false, result: report, coverage: { readFiles: 2, eligibleFiles: 4, limitations: [] } }; return route.abort("connectionreset"); }
    return route.fulfill({ json: { onlineWorkers: 1, jobs: [] } });
  });
  await page.route("**/review-jobs/*", route => route.fulfill({ json: { job: saved } }));
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await page.getByLabel("Follow-up question or review instructions (optional)", { exact: true }).fill("Do not duplicate this committed request.");
  await page.getByRole("button", { name: "Queue review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry queue request", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole("button", { name: "Run a fresh review", exact: true })).toBeVisible();
  await expect(page.getByLabel("Follow-up question or review instructions (optional)", { exact: true })).toHaveValue(""); expect(calls).toBe(1);
});
