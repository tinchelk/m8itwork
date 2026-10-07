import { test, expect } from "@playwright/test";
import { mockWorkspace } from "./fixtures/workspace";

test("recovers a sign-in identity conflict through repository authorization and keeps the customer's request", async ({ page }, info) => {
  const state = await mockWorkspace(page, { empty: true, emailOnly: true });
  const repositories = state.connection!.repositories;
  state.connection!.repositories = [];
  await page.goto("/dashboard?start=1&github=identity");
  await expect(page.locator(".portal-error[role=alert]")).toContainText("You can still share repositories with this account using Connect GitHub below");
  const connect = page.getByRole("link", { name: "Connect GitHub", exact: true });
  await expect(connect).toHaveAttribute("href", "http://localhost:3121/v1/github/connect?flow=repositories");
  await expect(page.getByLabel("GitHub repository", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send for review", exact: true })).toBeDisabled();
  const request = page.getByLabel("How can we help move it forward?", { exact: true });
  await request.fill("Add exports and improve the dashboard in our current app.");
  await page.getByRole("button", { name: "Refresh connection", exact: true }).click();
  await expect(page.locator(".simple-project-form").getByRole("status")).toContainText("GitHub isn’t connected yet. Use Connect GitHub");
  await expect(request).toHaveValue("Add exports and improve the dashboard in our current app.");
  await page.screenshot({ path: info.outputPath(`connection-recovery-${info.project.name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route("**/v1/github/connect?flow=repositories", route => {
    state.connection!.githubLogin = "repository-owner";
    state.connection!.repositories = repositories;
    return route.fulfill({ status: 302, headers: { location: "http://127.0.0.1:3130/dashboard?github=connected" } });
  });
  await connect.click();
  await expect(page.getByRole("heading", { name: "Your repo. Your next step." })).toBeVisible();
  await expect(request).toHaveValue("Add exports and improve the dashboard in our current app.");
  await expect(page.locator(".portal-error[role=alert]")).toHaveCount(0);
  await expect(page.getByText("Connected as @repository-owner", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Backoffice", exact: true })).toHaveCount(0);
  await page.getByLabel("GitHub repository", { exact: true }).selectOption(repositories[0]!.url);
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "We’re reviewing your next step." })).toBeVisible();
  expect(state.project.contactEmail).toBe("builder@example.invalid");
  expect(state.creationCalls).toBe(1);
});

test("shows progress and a completed result when refreshing a disconnected GitHub session", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true, emailOnly: true });
  state.connection!.repositories = [];
  await page.goto("/dashboard?start=1");
  const refresh = page.getByRole("button", { name: "Refresh connection", exact: true });
  await expect(refresh).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/v1/session", async route => { await gate; await route.fulfill({ json: state.connection }); });
  await refresh.click();
  try {
    await expect(refresh).toBeDisabled();
    await expect(page.locator(".simple-project-form").getByRole("status")).toHaveText("Checking GitHub connection…");
    await expect(page.getByRole("button", { name: "Send for review", exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.locator(".simple-project-form").getByRole("status")).toContainText("GitHub isn’t connected yet");
  await expect(refresh).toBeEnabled();
  await expect(page.getByRole("link", { name: "Connect GitHub", exact: true })).toBeVisible();
  await expect(page.getByLabel("GitHub repository", { exact: true })).toHaveCount(0);
});

test("recovers failed status loading and expired credentials without losing input", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true, emailOnly: true });
  state.connection!.repositories = [];
  let fail = true;
  await page.route("**/v1/session", route => fail
    ? route.fulfill({ status: 503, json: { error: { message: "Connection status could not be loaded. Try again." } } })
    : route.fallback());
  await page.goto("/dashboard?start=1");
  const form = page.locator(".simple-project-form");
  await expect(form.getByRole("alert")).toContainText("Connection status could not be loaded");
  const request = page.getByLabel("How can we help move it forward?", { exact: true });
  await request.fill("Extend our app with an export workflow.");
  fail = false;
  state.connection!.connectionError = "Connect GitHub again to choose your repositories. Your request is still here.";
  await page.getByRole("button", { name: "Refresh connection", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("Connect GitHub again to choose your repositories");
  await expect(page.getByRole("link", { name: "Connect GitHub", exact: true })).toBeVisible();
  await expect(request).toHaveValue("Extend our app with an export workflow.");
  await expect(page.getByLabel("GitHub repository", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send for review", exact: true })).toBeDisabled();
});

test("reports progress and the connection result on an existing submitted project", async ({ page }) => {
  const state = await mockWorkspace(page, { emailOnly: true });
  state.project.stage = "IN_REVIEW";
  state.project.repositoryUrl = "https://github.com/builder/private-app";
  state.connection!.repositories = [];
  await page.goto(`/dashboard?project=${state.project.id}`);
  const panel = page.locator(".portal-connect");
  await expect(panel.getByRole("link", { name: "Connect GitHub", exact: false })).toHaveAttribute("href", "http://localhost:3121/v1/github/connect?flow=repositories");
  const refresh = panel.getByRole("button", { name: "Refresh connection", exact: true });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/v1/session", async route => { await gate; await route.fulfill({ json: state.connection }); });
  await refresh.click();
  try {
    await expect(page.getByRole("status")).toHaveText("Refreshing workspace…");
    await expect(refresh).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole("status")).toContainText("GitHub isn’t connected yet. Use Connect GitHub");
  await expect(refresh).toBeEnabled();
  await expect(page).toHaveURL(new RegExp(`project=${state.project.id}`));
});

test("returns to a legacy draft project after repository authorization and preserves its request draft", async ({ page }) => {
  const state = await mockWorkspace(page, { emailOnly: true });
  state.connection!.repositories = [];
  await page.goto(`/dashboard?project=${state.project.id}`);
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Add useful exports");
  await page.getByLabel("Details", { exact: true }).fill("Let customers export their app data as a spreadsheet.");
  await page.getByRole("button", { name: "Refresh repositories", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("GitHub isn’t connected yet");
  await expect(title).toHaveValue("Add useful exports");
  await page.route("**/v1/github/connect?flow=repositories", route => {
    state.connection!.githubLogin = "repository-owner";
    return route.fulfill({ status: 302, headers: { location: "http://127.0.0.1:3130/dashboard?github=connected" } });
  });
  await page.getByRole("link", { name: "Connect GitHub", exact: false }).click();
  await expect(page).toHaveURL(new RegExp(`project=${state.project.id}`));
  await expect(title).toHaveValue("Add useful exports");
  await expect(page.getByLabel("Details", { exact: true })).toHaveValue("Let customers export their app data as a spreadsheet.");
});

for (const provider of ["email", "google"] as const) {
  for (const existingProject of [false, true]) {
    test(`recovers an expired account through ${provider} sign-in and restores the ${existingProject ? "existing project" : "new request"} before GitHub authorization`, async ({ page }) => {
      const state = await mockWorkspace(page, { empty: !existingProject, emailOnly: true });
      state.connection!.repositories = [];
      await page.route("**/v1/auth/session", route => route.fulfill({ json: {
        connectEnabled: true, googleEnabled: true, emailEnabled: true,
        account: state.signedOut ? null : { id: state.accountId, githubLogin: null, email: "builder@example.invalid", displayName: "Builder", isOperator: false },
      } }));
      await page.goto(existingProject ? `/dashboard?project=${state.project.id}` : "/dashboard?start=1");
      const input = existingProject ? page.getByLabel("Title", { exact: true }) : page.getByLabel("How can we help move it forward?", { exact: true });
      const value = "Add an export workflow to our current app.";
      await input.fill(value);
      let authorizationStarts = 0;
      await page.route("**/v1/github/connect?flow=repositories", route => {
        authorizationStarts++;
        state.signedOut = true;
        return route.fulfill({ status: 302, headers: { location: "http://127.0.0.1:3130/dashboard?github=signin-required" } });
      });
      await page.getByRole("link", { name: "Connect GitHub", exact: false }).click();
      await expect(page.locator(".portal-error[role=alert]")).toContainText("Your session expired. Sign in again with the same account");
      await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
      if (provider === "email") {
        await page.route("**/v1/auth/login", route => { state.signedOut = false; return route.fulfill({ json: { signedIn: true } }); });
        await page.getByLabel("Email address", { exact: true }).fill("builder@example.invalid");
        await page.getByLabel("Password", { exact: true }).fill("a long fixture password");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
      } else {
        await page.route("**/v1/auth/google/connect?flow=login", route => {
          state.signedOut = false;
          return route.fulfill({ status: 302, headers: { location: "http://127.0.0.1:3130/dashboard?google=connected" } });
        });
        await page.getByRole("link", { name: "Continue with Google", exact: true }).click();
      }
      await expect(input).toHaveValue(value);
      await expect(page.getByRole("link", { name: "Connect GitHub", exact: false })).toBeVisible();
      if (existingProject) await expect(page).toHaveURL(new RegExp(`project=${state.project.id}`));
      else await expect(page.getByRole("heading", { name: "Your repo. Your next step." })).toBeVisible();
      expect(authorizationStarts).toBe(1);
      expect(state.creationCalls).toBe(0);
    });
  }
}

test("keeps an expired connection's return intent and saved request private when another account signs in", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true, emailOnly: true });
  state.connection!.repositories = [];
  await page.goto("/dashboard?start=1");
  const request = page.getByLabel("How can we help move it forward?", { exact: true });
  await request.fill("A request belonging to the original account only.");
  await page.route("**/v1/github/connect?flow=repositories", route => {
    state.signedOut = true;
    return route.fulfill({ status: 302, headers: { location: "http://127.0.0.1:3130/dashboard?github=signin-required" } });
  });
  await page.getByRole("link", { name: "Connect GitHub", exact: true }).click();
  await page.route("**/v1/auth/login", route => { state.accountId = "other-customer"; state.signedOut = false; return route.fulfill({ json: { signedIn: true } }); });
  await page.getByLabel("Email address", { exact: true }).fill("other@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("a long fixture password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your apps. Their next chapter." })).toBeVisible();
  await page.getByRole("button", { name: "Start a project", exact: true }).click();
  await expect(request).toHaveValue("");
  state.accountId = "customer";
  await page.goto("/dashboard");
  await expect(request).toHaveValue("A request belonging to the original account only.");
});
