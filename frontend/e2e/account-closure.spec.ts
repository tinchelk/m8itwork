import { expect, test, type Page } from "@playwright/test";
import { mockWorkspace, publishProposal } from "./fixtures/workspace";

const accountId = "8b3f8de8-5118-4a54-8506-78372585f450";
async function fixture(page: Page) {
  const state = {
    signedIn: true,
    closed: false,
    mode: "ok",
    checks: 0,
    closes: 0,
    accountId,
  };
  await page.route("http://localhost:3121/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown, status = 200) =>
      route.fulfill({ status, json });
    if (path === "/v1/auth/session")
      return send({
        account: state.signedIn
          ? {
              id: state.accountId,
              email: "builder@example.invalid",
              displayName: "Builder",
              isOperator: false,
              googleConnected: true,
            }
          : null,
        emailEnabled: true,
        googleEnabled: true,
        connectEnabled: true,
      });
    if (path === "/v1/auth/account/close/status") {
      state.checks++;
      return state.mode === "check-fails"
        ? send({ error: { message: "Interrupted." } }, 503)
        : send({ closed: state.closed });
    }
    if (path === "/v1/auth/account/close") {
      state.closes++;
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ accountId, confirmation: "CLOSE" });
      expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
      if (state.mode === "blocked")
        return send(
          {
            error: {
              message:
                "You have agreed work or a payment that needs attention. Contact hello@m8itwork.com to settle it before closing your account.",
            },
          },
          409,
        );
      if (state.mode === "unknown") return route.abort();
      state.closed = true;
      state.signedIn = false;
      if (state.mode === "lost") return route.abort();
      return send({ closed: true, accountId });
    }
    if (path === "/v1/billing/cards")
      return send({ cards: [], next: null, enabled: true, mode: "test" });
    if (path === "/v1/projects") return send({ projects: [] });
    if (path === "/v1/session")
      return send({ repositories: [], connectEnabled: true });
    throw new Error(`Unmocked closure API: ${path}`);
  });
  return state;
}
async function open(page: Page) {
  await page.goto("/account");
  await page
    .locator("#close-account")
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Close your account?" });
}
test("keeps closure secondary, identifies the account and supports keyboard cancel/focus return", async ({
  page,
}, testInfo) => {
  const state = await fixture(page),
    dialog = await open(page);
  await expect(
    dialog.getByText("builder@example.invalid", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep account" }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Close account", exact: true }),
  ).toBeDisabled();
  const titleBox = await dialog
    .getByRole("heading", { name: "Close your account?" })
    .boundingBox();
  const keepBox = await dialog
    .getByRole("button", { name: "Keep account" })
    .boundingBox();
  expect(titleBox!.y).toBeGreaterThanOrEqual(0);
  expect(keepBox!.y + keepBox!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await page.screenshot({
    path: testInfo.outputPath(`close-account-${testInfo.project.name}.png`),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .locator("#close-account")
      .getByRole("button", { name: "Close account", exact: true }),
  ).toBeFocused();
  expect(state.closes).toBe(0);
});
test("requires explicit confirmation then clears private UI and per-account drafts", async ({
  page,
}) => {
  const state = await fixture(page),
    dialog = await open(page);
  await page.evaluate((id) => {
    sessionStorage.setItem(
      `m8-workspace-draft:${id}:intake`,
      "sensitive draft",
    );
    sessionStorage.setItem("m8-workspace-draft:other:intake", "other account");
  }, accountId);
  await dialog.getByLabel("Type CLOSE to confirm").fill("close");
  await expect(
    dialog.getByRole("button", { name: "Close account", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Type CLOSE to confirm").fill("CLOSE");
  await dialog
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your account is closed." }),
  ).toBeVisible();
  await expect(
    page.getByText("builder@example.invalid", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add card", exact: true }),
  ).toHaveCount(0);
  expect(state.closes).toBe(1);
  expect(
    await page.evaluate(
      (id) => sessionStorage.getItem(`m8-workspace-draft:${id}:intake`),
      accountId,
    ),
  ).toBeNull();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("m8-workspace-draft:other:intake"),
    ),
  ).toBe("other account");
});
test("shows blocked closure in the dialog and keeps the account usable", async ({
  page,
}) => {
  const state = await fixture(page);
  state.mode = "blocked";
  const dialog = await open(page);
  await dialog.getByLabel("Type CLOSE to confirm").fill("CLOSE");
  await dialog
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Contact hello@m8itwork.com",
  );
  await dialog.getByRole("button", { name: "Keep account" }).click();
  await expect(
    page.getByRole("heading", { name: "Account settings" }),
  ).toBeVisible();
  expect(state.closed).toBe(false);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("m8-account-close-receipt"),
    ),
  ).toBeNull();
});
test("recovers a committed closure after a lost response and reload without resubmitting", async ({
  page,
}) => {
  const state = await fixture(page);
  state.mode = "lost";
  const dialog = await open(page);
  await dialog.getByLabel("Type CLOSE to confirm").fill("CLOSE");
  await dialog
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "connection was interrupted",
  );
  await expect(
    dialog.getByRole("button", { name: "Check closure result" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your account is closed." }),
  ).toBeVisible();
  expect(state.checks).toBeGreaterThan(0);
  expect(state.closes).toBe(1);
});
test("checking later after a dropped response confirms closure without claiming cancellation", async ({
  page,
}) => {
  const state = await fixture(page);
  state.mode = "lost";
  const dialog = await open(page);
  await dialog.getByLabel("Type CLOSE to confirm").fill("CLOSE");
  await dialog
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Leaving this dialog won’t cancel",
  );
  await expect(
    dialog.getByRole("button", { name: "Keep account" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Check later" }).click();
  await expect(
    page.getByRole("heading", { name: "Your account is closed." }),
  ).toBeVisible();
  expect(state.closes).toBe(1);
  expect(state.checks).toBeGreaterThan(0);
});
test("creates a fresh recovery receipt after a known rejection and a later retry", async ({
  page,
}) => {
  await page.clock.install({ time: new Date() });
  const state = await fixture(page);
  state.mode = "blocked";
  const dialog = await open(page);
  await dialog.getByLabel("Type CLOSE to confirm").fill("CLOSE");
  await dialog
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("agreed work");
  await page.clock.setFixedTime(new Date(Date.now() + 31 * 60000));
  state.mode = "lost";
  await dialog
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "connection was interrupted",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your account is closed." }),
  ).toBeVisible();
  expect(state.closes).toBe(2);
});
test("reports an uncertain closure honestly and checks status before offering a retry", async ({
  page,
}) => {
  const state = await fixture(page);
  state.mode = "unknown";
  const dialog = await open(page);
  await dialog.getByLabel("Type CLOSE to confirm").fill("CLOSE");
  await dialog
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Check closure result" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Closure isn’t confirmed",
  );
  expect(state.closes).toBe(1);
  expect(state.checks).toBe(1);
  state.mode = "ok";
  await dialog
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your account is closed." }),
  ).toBeVisible();
});
test("does not claim closure from a query string or recover another signed-in account's receipt", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/account?closed=1");
  await expect(
    page.getByRole("heading", { name: "Account settings" }),
  ).toBeVisible();
  await page.evaluate(() =>
    sessionStorage.setItem(
      "m8-account-close-receipt",
      JSON.stringify({
        accountId: "other-account",
        requestId: crypto.randomUUID(),
        expires: Date.now() + 60000,
      }),
    ),
  );
  state.closed = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Account settings" }),
  ).toBeVisible();
  expect(state.checks).toBe(0);
  expect(state.closes).toBe(0);
});
test("reports status-check failure on reload and lets the customer check again", async ({
  page,
}) => {
  const state = await fixture(page);
  const dialog = await open(page);
  state.mode = "unknown";
  await dialog.getByLabel("Type CLOSE to confirm").fill("CLOSE");
  await dialog
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  state.signedIn = false;
  state.mode = "check-fails";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Check account closure" }),
  ).toBeVisible();
  await expect(page.locator(".portal-error[role=alert]")).toContainText(
    "couldn’t check",
  );
  state.mode = "ok";
  state.closed = true;
  await page.getByRole("button", { name: "Check closure result" }).click();
  await expect(
    page.getByRole("heading", { name: "Your account is closed." }),
  ).toBeVisible();
  expect(state.closes).toBe(1);
});
test("shows retained closed-customer records read-only in backoffice", async ({
  page,
}) => {
  const state = await mockWorkspace(page, { operator: true });
  publishProposal(state);
  state.project.stage = "COMPLETE";
  const proposal = state.project.proposals[0]!;
  proposal.approvedAt = new Date().toISOString();
  proposal.milestones = [
    {
      id: "completed-payment",
      position: 0,
      label: "Project fee",
      amountCents: 125000,
      dueWhen: "BEFORE_BUILD",
      releasedAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
      paidCents: 125000,
      refundedCents: 0,
      disputed: false,
      attempts: [{ status: "PAID", mode: "test" }],
    },
  ];
  state.project.accountClosedAt = new Date().toISOString();
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await expect(
    page.getByRole("heading", { name: "This project is read-only" }),
  ).toBeVisible();
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByText("Current scope", { exact: false })).toBeVisible();
  for (const action of [
    "Check payment status",
    "Expire pending Checkout",
    "Recover Checkout",
    "Recover an unfinished Checkout",
  ])
    await expect(page.getByText(action, { exact: true })).toHaveCount(0);
  for (const label of [
    "Message to the customer",
    "Review summary",
    "New request",
    "Team note",
  ])
    await expect(page.getByLabel(label)).toHaveCount(0);
  await expect(
    page.getByText("Saved project and payment records remain available here.", {
      exact: false,
    }),
  ).toBeVisible();
});
