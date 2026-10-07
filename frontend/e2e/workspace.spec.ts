import { chooseOption } from "./fixtures/fields";
import { test, expect } from "@playwright/test";
import { mockWorkspace, publishProposal } from "./fixtures/workspace";

test("lands a new customer on the dashboard before explicitly starting a project", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page, { empty: true });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your apps. Their next chapter." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Let’s move your first app forward." })).toBeVisible();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Backoffice", exact: true })).toHaveCount(0);
  expect(state.operatorRequests).toBe(0);
  await page.screenshot({ path: testInfo.outputPath(`dashboard-empty-${testInfo.project.name}.png`) });
  await page.getByRole("button", { name: "Start a project", exact: true }).click();
  await expect(page.getByLabel("GitHub repository", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "← Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your apps. Their next chapter." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("shows load failures honestly and recovers customer and backoffice project lists", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true });
  for (const url of ["/dashboard", "http://127.0.0.1:3131/"]) {
    state.failList = true;
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Your projects couldn’t be loaded." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Let’s move your first app forward." })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start a project", exact: true })).toHaveCount(0);
    state.failList = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("heading", { name: url === "/dashboard" ? "Your apps. Their next chapter." : "Help the next app move forward." })).toBeVisible();
    await expect(page.getByRole("link", { name: /Bloom bookings.*Getting started|Getting started.*Bloom bookings/ }).first()).toBeVisible();
  }
});

test("shows a requested final payment and clears read messages on return to the dashboard", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page);
  publishProposal(state);
  state.project.stage = "VERIFYING";
  state.project.proposals[0]!.approvedAt = new Date().toISOString();
  state.project.proposals[0]!.milestones = [{ id: "8b3f8de8-5118-4a54-8506-78372585f422", position: 0, label: "Final", amountCents: 125000, dueWhen: "BEFORE_HANDOVER", releasedAt: new Date().toISOString(), paidAt: null, paidCents: 0, refundedCents: 0, disputed: false, attempts: [] }];
  state.project.teamLastMessageAt = new Date().toISOString();
  state.messages.push({ id: "team-message", authorRole: "TEAM", authorName: "m8itwork", body: "Your checks are ready. Please review the final installment before handover.", createdAt: state.project.teamLastMessageAt });
  await page.goto("/dashboard");
  await expect(page.getByText("Your final payment is requested. Review the payment plan.", { exact: true })).toBeVisible();
  await expect(page.getByText("New team message", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`dashboard-projects-${testInfo.project.name}.png`) });
  if (testInfo.project.name === "mobile") {
    await page.locator(".dashboard-project").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("dashboard-project-card-mobile.png") });
  }
  await page.getByRole("link", { name: /Verifying.*Bloom bookings.*Open project/ }).click();
  await page.getByRole("link", { name: "Conversation", exact: true }).click();
  await expect.poll(() => state.readMessageIds.length).toBe(1);
  await page.getByRole("link", { name: "← Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your apps. Their next chapter." })).toBeVisible();
  await expect(page.getByText("New team message", { exact: true })).toHaveCount(0);
  state.project.proposals[0]!.milestones[0]!.attempts = [{ status: "PROCESSING", mode: "test" }];
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Payment confirmation is pending. Check its status.", { exact: true })).toBeVisible();
  const milestone = state.project.proposals[0]!.milestones[0]!;
  milestone.paidCents = milestone.amountCents;
  milestone.refundedCents = 1000;
  milestone.attempts = [{ status: "PAID", mode: "test" }];
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Payment needs team review. Open your payment plan.", { exact: true })).toBeVisible();
  milestone.paidCents = 0;
  milestone.refundedCents = 0;
  milestone.attempts = [{ status: "OPEN", mode: "live" }];
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Payment needs team review. Open your payment plan.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("keeps the operator's customer dashboard separate from the backoffice", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true });
  publishProposal(state);
  state.project.teamLastMessageAt = new Date().toISOString();
  await page.goto("/dashboard?view=team");
  await expect(page.getByRole("heading", { name: "Your apps. Their next chapter." })).toBeVisible();
  await expect(page.getByText("New team message", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Backoffice", exact: true })).toHaveAttribute("href", "http://127.0.0.1:3131/");
  expect(state.operatorRequests).toBe(0);
  await page.getByRole("link", { name: /Proposal ready.*Bloom bookings.*Open project/ }).click();
  await expect(page.getByRole("link", { name: "Review proposal" })).toBeVisible();
  await expect(page.getByLabel("Review summary")).toHaveCount(0);
  await page.getByRole("link", { name: "Backoffice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Help the next app move forward." })).toBeVisible();
  expect(state.operatorRequests).toBeGreaterThan(0);
});

test("uses separate backoffice sign-in and preserves legacy project return links", async ({ page }) => {
  const state = await mockWorkspace(page, { signedOut: true });
  await page.goto("http://127.0.0.1:3131/");
  await expect(page.getByRole("heading", { name: "Sign in to the backoffice." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with GitHub" })).toHaveAttribute("href", "http://localhost:3121/v1/github/connect?flow=admin");
  await expect(page.getByText("Starting a project is free.", { exact: false })).toHaveCount(0);
  state.signedOut = false;
  const response = await page.goto(`/workspace?project=${state.project.id}&payment=cancelled`);
  expect(response?.url()).toMatch(new RegExp(`/dashboard\\?project=${state.project.id}&payment=cancelled`));
  await expect(page.getByRole("heading", { name: "Bloom bookings", exact: true })).toBeVisible();
});

test("explains sign-in and blocked configuration without displaying customer data", async ({
  page,
}) => {
  await mockWorkspace(page, { signedOut: true, configured: false });
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Create an account", exact: true }).click();
  await expect(
    page.getByText("Email verification is being set up.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Email verification is being set up.", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bloom bookings" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("sends only a repository and request straight to review", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page, { empty: true });
  await page.goto("/dashboard?start=1");
  await expect(page.getByRole("heading", { name: "Your repo. Your next step." })).toBeVisible();
  await expect(page.getByLabel("GitHub repository", { exact: true })).toBeEnabled();
  for (const label of ["Project name", "Contact email", "Started with", "Demo link", "Tell us about access constraints"]) {
    await expect(page.getByLabel(label, { exact: false })).toHaveCount(0);
  }
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await chooseOption(page.getByLabel("GitHub repository", { exact: true }), "https://github.com/builder/private-app");
  await page.getByLabel("How can we help move it forward?", { exact: false }).fill("Add recurring bookings and improve the checkout journey.");
  await page.screenshot({ path: testInfo.outputPath(`simple-project-${testInfo.project.name}.png`), fullPage: true });
  const createRequest = page.waitForRequest(request => request.url().endsWith("/v1/projects") && request.method() === "POST");
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  expect(Object.keys((await createRequest).postDataJSON()).sort()).toEqual(["consent", "id", "inspectionId", "reviewConsent", "summary"]);
  await expect(page.getByRole("heading", { name: "We’re reviewing your next step." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "private-app", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
  expect(state.project.repositoryUrl).toBe("https://github.com/builder/private-app");
  expect(state.project.stage).toBe("IN_REVIEW");
  expect(state.project.contactEmail).toBe("");
  expect(state.inspectionCalls).toBe(1);
  state.operator = true;
  await page.goto("http://127.0.0.1:3131/");
  await page.getByRole("link", { name: /private-app/ }).first().click();
  await expect(page.getByText("Add recurring bookings and improve the checkout journey.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Review summary")).toBeVisible();
});

test("retains both inputs through inspection and save failures and a lost response", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true });
  await page.goto("/dashboard?start=1");
  const repository = page.getByLabel("GitHub repository", { exact: true });
  const request = page.getByLabel("How can we help move it forward?", { exact: false });
  await chooseOption(repository, "https://github.com/builder/private-app");
  await request.fill("Add custom reports and a new billing integration.");
  state.failInspection = true;
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.locator(".portal-error")).toContainText("Repository couldn't be checked");
  expect(state.empty).toBe(true);
  expect(state.creationCalls).toBe(0);
  await expect(repository).toHaveAttribute("data-value", "https://github.com/builder/private-app");
  await expect(request).toHaveValue("Add custom reports and a new billing integration.");
  state.failCreate = true;
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.locator(".portal-error")).toContainText("Request wasn't saved");
  await page.reload();
  await page.getByRole("button", { name: "Start a project", exact: true }).click();
  await expect(repository).toHaveAttribute("data-value", "https://github.com/builder/private-app");
  await expect(request).toHaveValue("Add custom reports and a new billing integration.");
  state.loseCreateResponse = true;
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.locator(".portal-error")).toContainText("couldn't reach");
  const savedId = state.project.id;
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "We’re reviewing your next step." })).toBeVisible();
  expect(state.project.id).toBe(savedId);
  expect(state.creationCalls).toBe(3);
});

test("keeps an edited request after a lost response and links to the already saved request", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true });
  await page.goto("/dashboard?start=1");
  await chooseOption(page.getByLabel("GitHub repository", { exact: true }), "https://github.com/builder/private-app");
  const request = page.getByLabel("How can we help move it forward?", { exact: true });
  await request.fill("Add custom reports for our team.");
  state.loseCreateResponse = true;
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.locator(".portal-error")).toContainText("couldn't reach");
  await request.fill("Add an integration with our CRM instead.");
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.locator(".portal-error")).toContainText("Your earlier request is already saved");
  await expect(request).toHaveValue("Add an integration with our CRM instead.");
  await expect(page.getByRole("link", { name: "Open saved request ↗" })).toHaveAttribute("href", `/dashboard?project=${state.project.id}`);
  expect(state.project.summary).toBe("Add custom reports for our team.");
});

test("reconnects revoked repository access while keeping the customer signed in and their request", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true });
  await page.goto("/dashboard?start=1");
  await chooseOption(page.getByLabel("GitHub repository", { exact: true }), "https://github.com/builder/private-app");
  const request = page.getByLabel("How can we help move it forward?", { exact: true });
  await request.fill("Add custom reports for our team.");
  state.expireInspection = true;
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.locator(".simple-project-form").getByRole("alert")).toContainText("GitHub connection expired");
  await expect(page.getByRole("link", { name: "Reconnect GitHub" })).toBeVisible();
  await expect(request).toHaveValue("Add custom reports for our team.");
  await expect(page.getByRole("heading", { name: "Your repo. Your next step." })).toBeVisible();
  expect(state.creationCalls).toBe(0);
  await page.route("**/v1/github/connect?flow=repositories", route => route.fulfill({ status: 302, headers: { location: "http://127.0.0.1:3130/dashboard?github=connected" } }));
  await page.getByRole("link", { name: "Reconnect GitHub" }).click();
  await expect(request).toHaveValue("Add custom reports for our team.");
  await expect(page.getByLabel("GitHub repository", { exact: true })).toHaveAttribute("data-value", "https://github.com/builder/private-app");
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "We’re reviewing your next step." })).toBeVisible();
});

test("keeps repository selection and pasted links mutually exclusive and focuses missing input", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true });
  state.connection!.truncated = true;
  await page.goto("/dashboard?start=1");
  await page.getByLabel("How can we help move it forward?", { exact: true }).fill("Add custom reports for our team.");
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  const link = page.getByLabel("GitHub repository link", { exact: true });
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("aria-describedby", "repository-choice-error");
  await link.fill("https://github.com/builder/another-app");
  await page.getByText("Repository not listed?", { exact: true }).click();
  const repository = page.getByLabel("GitHub repository", { exact: true });
  await chooseOption(repository, "https://github.com/builder/private-app");
  await expect(link).toHaveValue("");
  const inspection = page.waitForRequest(request => request.url().endsWith("/v1/github/inspect") && request.method() === "POST");
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  expect((await inspection).postDataJSON()).toEqual({ repositoryUrl: "https://github.com/builder/private-app" });
  await expect(page.getByRole("heading", { name: "We’re reviewing your next step." })).toBeVisible();
});

test("handles missing repositories and a failed connection refresh", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true });
  state.connection!.repositories = [];
  await page.goto("/dashboard?start=1");
  await expect(page.getByText("No repositories shared yet.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("GitHub repository", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send for review", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Choose repositories in GitHub ↗" })).toHaveAttribute("href", state.connection!.installUrl!);
  state.connection!.connectionError = "GitHub connection expired.";
  await page.getByRole("button", { name: "Refresh repositories" }).click();
  await expect(page.locator(".simple-project-form").getByRole("alert")).toContainText("GitHub connection expired");
  await expect(page.getByRole("link", { name: "Reconnect GitHub" })).toHaveAttribute("href", "http://localhost:3121/v1/github/connect?flow=repositories");
  state.connection!.connectionError = null;
  state.connection!.repositories = [{ name: "builder/private-app", url: "https://github.com/builder/private-app", private: true }];
  await page.getByRole("button", { name: "Refresh repositories" }).click();
  await expect(page.getByLabel("GitHub repository", { exact: true })).toBeEnabled();
  await expect(page.locator(".simple-project-form").getByRole("alert")).toHaveCount(0);
});

test("links a private repository, preserves a failed PRD save, then shows the reviewed proposal", async ({
  page,
}, testInfo) => {
  const state = await mockWorkspace(page);
  await page.goto(`/dashboard?project=${state.project.id}`);
  await chooseOption(page
    .getByLabel("Available repositories"), "https://github.com/builder/private-app");
  await page.getByRole("button", { name: "Inspect & link repository" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Repository inventory linked",
  );
  await page.getByText("Saved repository inventory", { exact: false }).click();
  await expect(
    page.getByText("Partial inventory", { exact: false }),
  ).toBeVisible();
  await chooseOption(page.getByLabel("Request type"), "PRD");
  await page
    .getByLabel("Title", { exact: true })
    .fill("Recurring booking requirements");
  await page
    .getByLabel("Details", { exact: true })
    .fill("Customers should be able to book the same slot every week.");
  state.failRequest = true;
  await page.getByRole("button", { name: "Add request", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "wasn’t saved" }),
  ).toBeInViewport();
  await expect(page.getByLabel("Details", { exact: true })).toHaveValue(
    "Customers should be able to book the same slot every week.",
  );
  await page.getByRole("button", { name: "Add request", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Request saved");
  await expect(page.getByRole("status")).toBeInViewport();
  expect(state.requestCalls).toBe(2);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(
    page.getByText("We’re reviewing your next step.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Pending review", { exact: true })).toBeVisible();
  publishProposal(state);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.locator("#proposal").getByText("$1,250.00", { exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /reviewed this version/ }).check();
  await page.getByRole("button", { name: "Approve scope v1" }).click();
  await expect(
    page.getByText("Scope agreed. Let’s get ready to build.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (testInfo.project.name === "desktop")
    await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("link", { name: "m8itwork dashboard" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`workspace-${testInfo.project.name}.png`),
    fullPage: false,
  });
  if (testInfo.project.name === "mobile") {
    await page.locator("#proposal").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("workspace-mobile-proposal.png"),
      fullPage: false,
    });
  }
});
test("recovers a PRD after reauthentication only for its original account", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.goto(`/dashboard?project=${state.project.id}`);
  await chooseOption(page.getByLabel("Request type"), "PRD");
  await page
    .getByLabel("Title", { exact: true })
    .fill("Detailed booking requirements");
  await page
    .getByLabel("Details", { exact: true })
    .fill(
      "A long PRD should survive signing in again without leaking to another account.",
    );
  state.expireRequest = true;
  await page.getByRole("button", { name: "Add request", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" }),
  ).toBeVisible();
  state.signedOut = false;
  state.accountId = "different-customer";
  await page.reload();
  await expect(page.getByLabel("Details", { exact: true })).toHaveValue("");
  state.accountId = "customer";
  await page.reload();
  await expect(page.getByLabel("Details", { exact: true })).toHaveValue(
    "A long PRD should survive signing in again without leaking to another account.",
  );
  await expect(page.getByLabel("Request type")).toHaveAttribute("data-value", "PRD");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Continue with GitHub" })).toBeVisible();
  state.signedOut = false;
  await page.reload();
  await page.getByRole("link", { name: /Getting started.*Bloom bookings.*Open project/ }).click();
  await expect(page.getByLabel("Details", { exact: true })).toHaveValue("");
});
test("jumps directly to a proposal and requires fresh acknowledgment after revision", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  publishProposal(state);
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page.getByRole("link", { name: "Review proposal" }).click();
  await expect(
    page.getByRole("heading", { name: "Scope & estimate", exact: true }),
  ).toBeInViewport();
  await page.getByRole("checkbox", { name: /reviewed this version/ }).check();
  state.project.proposals.unshift({
    ...state.project.proposals[0]!,
    id: "8b3f8de8-5118-4a54-8506-78372585f499",
    version: 2,
  });
  state.project.currentProposalId = state.project.proposals[0]!.id;
  state.project.version++;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve scope v2" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /reviewed this version/ }),
  ).not.toBeChecked();
});
test("stale approval is visible and logout clears private project content", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  publishProposal(state);
  state.staleApproval = true;
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page.getByRole("checkbox", { name: /reviewed this version/ }).check();
  await page.getByRole("button", { name: "Approve scope v1" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "project changed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" }),
  ).toHaveAttribute(
    "href",
    "http://localhost:3121/v1/github/connect?flow=login",
  );
  await expect(
    page.getByRole("heading", { name: "Bloom bookings", exact: true }),
  ).toHaveCount(0);
});
test("team publishes a human review, scope and cost before work updates", async ({
  page,
}) => {
  const state = await mockWorkspace(page, { operator: true });
  state.project.stage = "IN_REVIEW";
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await page
    .getByLabel("Review summary")
    .fill(
      "The booking app foundation exists. Recurring bookings and checkout need focused work and verification.",
    );
  await page.getByRole("button", { name: "Publish review" }).click();
  await expect(page.getByRole("status")).toContainText("Review published");
  await page
    .getByRole("button", { name: "Scope & estimate", exact: true })
    .click();
  await page
    .getByLabel("Proposed scope")
    .fill("Add recurring bookings and repair the agreed checkout journey.");
  await page
    .getByLabel("Acceptance checks")
    .fill("Customers can create recurring bookings and complete checkout.");
  await page.getByLabel("Project cost", { exact: true }).fill("1250");
  await page.getByLabel("Estimated delivery date").fill("2099-12-01");
  await page
    .getByLabel("Assumptions & conditions")
    .fill(
      "Work starts after access and payment are agreed, with the listed acceptance checks.",
    );
  await page.getByRole("button", { name: "Publish new proposal" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Customer approval is required",
  );
  expect(state.project.proposals[0]!.amountCents).toBe(125000);
  state.project.stage = "APPROVED";
  state.project.proposals[0]!.approvedAt = new Date().toISOString();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Progress update", exact: true })
    .click();
  await chooseOption(page.getByLabel("Project stage"), "BUILDING");
  await page.getByLabel("Update title").fill("Recurring bookings are underway");
  await page
    .getByLabel("What changed / what happens next")
    .fill(
      "Implementing the booking rules, then checking the customer journey.",
    );
  await page.getByRole("button", { name: "Publish update" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Progress update published",
  );
  await expect(
    page.getByText("Recurring bookings are underway", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
