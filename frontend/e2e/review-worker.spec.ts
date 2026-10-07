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
  await page.route("**/v1/github/connect?flow=workspace", route => route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:3130/dashboard?github=connected` } }));
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
  await expect(page.getByText(/Subscription limit reached/)).toBeVisible();
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
  await page.getByRole("button", { name: "Queue review", exact: true }).click();
  // Polling observes the committed job after its upload response was lost.
  await expect(page.getByRole("button", { name: "Run a fresh review", exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Coding agent").selectOption("claude");
  await page.getByRole("button", { name: "Run a fresh review", exact: true }).click();
  await expect.poll(() => ids.length).toBe(2); expect(ids[0]).not.toBe(ids[1]);
});
