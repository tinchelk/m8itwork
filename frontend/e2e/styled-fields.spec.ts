import { test, expect } from "@playwright/test";
import { mockWorkspace } from "./fixtures/workspace";
import { chooseOption } from "./fixtures/fields";

test("repository menu uses web styling, keyboard navigation and focus return", async ({ page }, info) => {
  const state = await mockWorkspace(page, { empty: true });
  state.connection!.repositories.push({ name: "builder/another-app", url: "https://github.com/builder/another-app", private: false });
  await page.goto("/dashboard?start=1");
  const control = page.getByRole("combobox", { name: "GitHub repository", exact: true });
  if (info.project.name === "mobile") await expect(control).toHaveCSS("font-size", "16px");
  await control.focus();
  await control.press("ArrowDown");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("background-color", "rgb(16, 40, 55)");
  await expect(page.getByRole("option", { name: "builder/private-app private" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "builder/another-app public" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(control).toHaveAttribute("data-value", "https://github.com/builder/another-app");
  await expect(control).toBeFocused();
  await control.press("Space");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(control).toBeFocused();
  await control.click();
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: `../backend/var/preview-styled-fields-${info.project.name}.png` });
  await page.mouse.click(5, 5);
  await expect(menu).toHaveCount(0);
  await expect(control).toBeFocused();
  await expect(page.locator("select:visible, input[type=date]:visible")).toHaveCount(0);
});

test("required repository selection focuses the web control and reports an inline error", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true });
  await page.goto("/dashboard?start=1");
  await page.getByLabel("How can we help move it forward?", { exact: true }).fill("Improve the reporting workflow for our customers.");
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  const control = page.getByRole("combobox", { name: "GitHub repository", exact: true });
  await expect(control).toBeFocused();
  await expect(control).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert").filter({ hasText: "Choose an option to continue." })).toHaveText("Choose an option to continue.");
  expect(state.inspectionCalls).toBe(0);
  await chooseOption(control, "https://github.com/builder/private-app");
  await expect(control).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "We’re reviewing your next step." })).toBeVisible();
  expect(state.project.repositoryUrl).toBe("https://github.com/builder/private-app");
});

test("long repository names and many options stay scrollable on narrow screens", async ({ page }) => {
  const state = await mockWorkspace(page, { empty: true });
  state.connection!.repositories = Array.from({ length: 80 }, (_, index) => ({ name: `builder/team-project-${String(index).padStart(2, "0")}-with-a-very-long-repository-name`, url: `https://github.com/builder/project-${index}`, private: true }));
  await page.goto("/dashboard?start=1");
  const control = page.getByRole("combobox", { name: "GitHub repository", exact: true });
  await control.focus();
  await control.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(page.getByRole("option").last()).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(control).toHaveAttribute("data-value", "https://github.com/builder/project-79");
  await expect(page.locator("input[name=repositoryUrl]")).toHaveValue("https://github.com/builder/project-79");
  await page.getByRole("button", { name: "Refresh repositories", exact: true }).click();
  await expect(control).toHaveAttribute("data-value", "https://github.com/builder/project-79");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A saved selection that is no longer authorized must become empty.
  state.connection!.repositories = state.connection!.repositories.slice(0, 1);
  await page.getByRole("button", { name: "Refresh repositories", exact: true }).click();
  await expect(control).toHaveAttribute("data-value", "");
  await expect(page.locator("input[name=repositoryUrl]")).toHaveValue("");
});

test("request selector submits its value, restores a draft, and resets after success", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto(`/dashboard?project=${state.project.id}`);
  const control = page.getByRole("combobox", { name: "Request type", exact: true });
  await control.focus();
  await control.press("s");
  await expect(control).toHaveAttribute("data-value", "SUGGESTION");
  await page.getByLabel("Title", { exact: true }).fill("Improve the reporting tools");
  await page.getByLabel("Details", { exact: true }).fill("Let us filter results and export the reports from the dashboard.");
  await page.reload();
  await expect(control).toHaveAttribute("data-value", "SUGGESTION");
  await page.getByRole("button", { name: "Add request", exact: true }).click();
  await expect(control).toHaveAttribute("data-value", "ISSUE");
  expect(state.project.requests.at(-1)?.kind).toBe("SUGGESTION");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
  await page.reload();
  await expect(control).toHaveAttribute("data-value", "ISSUE");
});

test("backoffice date calendar validates, restores ISO dates and publishes styled payment choices", async ({ page }, info) => {
  const state = await mockWorkspace(page, { operator: true });
  state.project.stage = "IN_REVIEW";
  state.project.reviewSummary = "Reviewed the app and ready to propose a scoped improvement.";
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await page.getByRole("button", { name: "Scope & estimate", exact: true }).click();
  await expect(page.getByLabel("Estimated delivery date", { exact: true })).toBeVisible();
  await page.getByLabel("Proposed scope", { exact: true }).fill("Build a useful report export workflow in the current app.");
  await page.getByLabel("Acceptance checks", { exact: true }).fill("The customer can export a filtered report with the correct data.");
  await page.getByLabel("Project cost", { exact: true }).fill("1250");
  await chooseOption(page.getByRole("combobox", { name: "Currency", exact: true }).last(), "GBP");
  await chooseOption(page.getByRole("combobox", { name: "Payment schedule", exact: true }), "DEPOSIT_FINAL");
  await page.getByLabel("Assumptions & conditions", { exact: true }).fill("The work starts after the customer grants access and pays the deposit.");
  const date = page.getByLabel("Estimated delivery date", { exact: true });
  await date.fill("2026-02-30");
  await page.getByRole("button", { name: "Publish new proposal", exact: true }).click();
  await expect(date).toBeFocused();
  await expect(page.getByText("Enter a valid date as YYYY-MM-DD.", { exact: true })).toBeVisible();
  await expect(date).toHaveCSS("border-color", "rgb(237, 153, 135)");
  expect(state.project.proposals).toHaveLength(0);
  await date.fill("2020-01-01");
  await page.getByRole("button", { name: "Publish new proposal", exact: true }).click();
  await expect(page.getByText("Choose today or a later date.", { exact: true })).toBeVisible();
  await date.fill("");
  await page.getByRole("button", { name: "Open delivery date calendar", exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "Delivery date calendar", exact: true });
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveCSS("background-color", "rgb(16, 40, 55)");
  await expect(calendar.getByRole("grid")).toBeVisible();
  await page.screenshot({ path: `../backend/var/preview-styled-calendar-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(date).toBeFocused();
  await page.getByRole("button", { name: "Open delivery date calendar", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(calendar).toHaveCount(0);
  await expect(date).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(date).toBeFocused();
  await date.fill("2099-12-01");
  await page.reload();
  await page.getByRole("button", { name: "Scope & estimate", exact: true }).click();
  await expect(date).toHaveValue("2099-12-01");
  await expect(page.getByRole("combobox", { name: "Payment schedule", exact: true })).toHaveAttribute("data-value", "DEPOSIT_FINAL");
  await page.getByRole("button", { name: "Publish new proposal", exact: true }).click();
  await expect(page.getByText("Proposal published. Customer approval is required.", { exact: true })).toBeVisible();
  expect(state.project.proposals[0]!.currency).toBe("GBP");
  expect(state.project.proposals[0]!.deliveryDate).toBe("2099-12-01");
  expect(state.project.proposals[0]!.milestones?.map(m => m.amountCents)).toEqual([62500, 62500]);
  await expect(date).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Payment schedule", exact: true })).toHaveAttribute("data-value", "UPFRONT");
  await expect(page.locator("select:visible, input[type=date]:visible")).toHaveCount(0);
});

test("signup checkbox is web styled while retaining label and keyboard behavior", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/signup");
  const checkbox = page.getByRole("checkbox");
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).toHaveCSS("appearance", "none");
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await page.getByText("Creating an account does not grant repository access.", { exact: false }).click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a cold calendar cannot block restoring or submitting the required date field", async ({ page }) => {
  const state = await mockWorkspace(page, { operator: true });
  state.project.stage = "IN_REVIEW";
  state.project.reviewSummary = "Ready for a scoped proposal after reviewing the app.";
  await page.addInitScript(({ key }) => sessionStorage.setItem(key, JSON.stringify({ expires: Date.now() + 3600000, fields: {
    scope: "Add a verified export workflow to the customer dashboard.",
    acceptance: "The customer can export a report with the correct records.",
    amount: "1250", currency: "GBP", paymentMode: "UPFRONT", deliveryDate: "2099-12-01",
    assumptions: "Work starts after access and payment; customer feedback is required.",
  } })), { key: `m8-workspace-draft:customer:operator:${state.project.id}:proposal` });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let bodyRequests = 0;
  await page.route(/date-calendar.*\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    // Turbopack's registration stub is needed for hydration; only the actual
    // optional calendar body is held to simulate a slow first download.
    if (!(await response.text()).includes("async loader")) { bodyRequests++; await gate; }
    await route.fulfill({ response });
  });
  try {
    await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
    await page.getByRole("button", { name: "Scope & estimate", exact: true }).click();
    const date = page.getByLabel("Estimated delivery date", { exact: true });
    await expect(date).toHaveValue("2099-12-01");
    await expect(date).toHaveAttribute("required", "");
    await expect(page.getByRole("combobox", { name: "Currency", exact: true }).last()).toHaveAttribute("data-value", "GBP");
    expect(bodyRequests).toBe(0);
    await page.getByRole("button", { name: "Open delivery date calendar", exact: true }).click();
    await expect(page.getByText("Loading calendar…", { exact: true })).toBeVisible();
    await expect.poll(() => bodyRequests).toBe(1);
    await page.keyboard.press("Escape");
    await expect(date).toBeFocused();
    await date.fill("2099-12-02");
    await page.getByRole("button", { name: "Publish new proposal", exact: true }).click();
    await expect(page.getByText("Proposal published. Customer approval is required.", { exact: true })).toBeVisible();
    expect(state.project.proposals[0]!.deliveryDate).toBe("2099-12-02");
    expect(state.project.proposals[0]!.currency).toBe("GBP");
    await expect(date).toHaveValue("");
  } finally { release(); }
});
