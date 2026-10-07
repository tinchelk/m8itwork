import { test, expect, type Page } from "@playwright/test";
import { mockWorkspace } from "./fixtures/workspace";

async function authFixture(page: Page, emailEnabled = true) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let signedIn = false, failLogin = true, recoveryDisabled = false;
  await page.route("http://localhost:3121/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === "POST" ? route.request().postDataJSON() as Record<string, unknown> : {};
    calls.push({ path, body });
    const send = (json: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", json });
    if (path === "/v1/auth/session") return send({ emailEnabled, googleEnabled: true, connectEnabled: true, account: signedIn ? { id: "email-account", displayName: "Email Builder", email: recoveryDisabled ? null : "builder@example.invalid", githubLogin: null, googleConnected: recoveryDisabled, isOperator: false } : null });
    if (path === "/v1/auth/login") { if (failLogin) { failLogin = false; return send({ error: { message: "Email or password is incorrect." } }, 401); } signedIn = true; return send({ signedIn: true }); }
    if (path === "/v1/auth/register") return send({ message: "Check your inbox to verify your email." }, 202);
    if (path.endsWith("/request")) return send({ message: "If an account exists for that email, check your inbox." }, 202);
    if (path.endsWith("/confirm")) return send({ verified: true, reset: true });
    if (path === "/v1/projects") return send({ projects: [] });
    if (path === "/v1/session") return send({ connectEnabled: true, githubLogin: null, repositories: [], connectionError: null });
    return send({ error: { message: "Unexpected fixture request." } }, 404);
  });
  return { calls, signIn: () => { signedIn = true; }, disableRecovery: () => { recoveryDisabled = true; signedIn = true; } };
}

test("signs up with email before GitHub and gives verification feedback", async ({ page }, info) => {
  const state = await authFixture(page);
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Start your next chapter." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "http://localhost:3121/v1/auth/google/connect?flow=login");
  await page.getByLabel("Your name").fill("Email Builder");
  await page.getByLabel("Email address").fill("builder@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("a long fixture password");
  if (info.project.name === "mobile") expect(await page.getByLabel("Email address").evaluate(element => getComputedStyle(element).fontSize)).toBe("16px");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page.screenshot({ path: info.outputPath(`signup-${info.project.name}.png`) });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");
  await expect(page.getByRole("status")).toBeInViewport();
  await page.screenshot({ path: info.outputPath(`signup-confirmed-${info.project.name}.png`) });
  expect(state.calls.find(c => c.path === "/v1/auth/register")?.body).toMatchObject({ displayName: "Email Builder", email: "builder@example.invalid", consent: true });
  expect(state.calls.some(c => c.path.includes("github"))).toBe(false);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("fixture password");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("recovers a failed email sign-in and opens the dashboard without GitHub", async ({ page }) => {
  await authFixture(page);
  await page.goto("/login");
  await page.getByLabel("Email address").fill("builder@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("a long fixture password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".customer-auth").getByRole("alert")).toContainText("Email or password is incorrect.");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Your apps. Their next chapter." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Backoffice", exact: true })).toHaveCount(0);
});

test("uses explicit fragment-token confirmation and supports password recovery", async ({ page }) => {
  const state = await authFixture(page);
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill("builder@example.invalid");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  const token = "x".repeat(43);
  await page.goto(`/verify-email#token=${token}`);
  expect(state.calls.filter(c => c.path.endsWith("/confirm"))).toHaveLength(0);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Email verified");
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto(`/reset-password#token=${token}`);
  await page.getByLabel("Password", { exact: true }).fill("new fixture password");
  await page.getByLabel("Confirm password").fill("different fixture password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.locator(".customer-auth").getByRole("alert")).toContainText("passwords don’t match");
  await page.getByLabel("Confirm password").fill("new fixture password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("Password updated");
  await expect(page).toHaveURL(/\/reset-password$/);
  expect(state.calls.find(c => c.path === "/v1/auth/password-reset/confirm")?.body.token).toBe(token);
});

test("shows missing tokens and unavailable email honestly", async ({ page }) => {
  await authFixture(page, false);
  await page.goto("/signup");
  await expect(page.getByText("Email verification is being set up.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  await page.goto("/reset-password");
  await expect(page.locator(".customer-auth").getByRole("alert")).toContainText("Open the link from your email");
  await expect(page.getByRole("button", { name: "Update password" })).toBeDisabled();
});

test("lets an existing customer link Google while preserving the account", async ({ page }) => {
  const state = await authFixture(page); state.signIn();
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Email Builder" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Google" })).toHaveAttribute("href", "http://localhost:3121/v1/auth/google/connect?flow=link");
  await page.getByRole("button", { name: "Send password reset email" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
});

test("submits a demo-first customer project for review without GitHub", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true, emailOnly: true });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Start a project", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Demo-first app");
  await page.getByLabel("Contact email").fill("builder@example.invalid");
  await page.getByLabel("Started with").selectOption("Lovable");
  await page.getByLabel(/Demo link/).fill("https://example.invalid/demo");
  await page.getByLabel("What would you like to fix or add?").fill("Add an export workflow to the current demo.");
  await page.getByRole("checkbox", { name: /authorized to share/ }).check();
  await page.getByRole("button", { name: "Start project", exact: true }).click();
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeEnabled();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("heading", { name: "We’re reviewing your next step." })).toBeVisible();
  expect(state.project.repositoryUrl).toBeNull();
  expect(state.project.stage).toBe("IN_REVIEW");
});

test("shows Google link recovery and success on Account settings", async ({ page }) => {
  const state = await authFixture(page); state.signIn();
  await page.goto("/account?google=link-mismatch");
  await expect(page.locator(".customer-auth").getByRole("alert")).toContainText("Choose the same Google email");
  await page.goto("/account?google=connected");
  await expect(page.getByRole("status")).toContainText("Google is connected");
  state.disableRecovery();
  await page.goto("/account?google=recovery-conflict");
  await expect(page.locator(".customer-auth").getByRole("alert")).toContainText("recovery to the old email is disabled");
  await page.goto("/account");
  await expect(page.getByText("Email password recovery is disabled.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "hello@m8itwork.com" })).toHaveAttribute("href", "mailto:hello@m8itwork.com");
  await expect(page.getByRole("link", { name: "Connect Google" })).toHaveCount(0);
});
