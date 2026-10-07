import { test, expect, type Page } from "@playwright/test";
import { chooseOption } from "./fixtures/fields";

const card = {
  id: "pm_owned",
  brand: "visa",
  last4: "4242",
  expMonth: 12,
  expYear: 2030,
};
const payment = {
  id: "payment-one",
  label: "Deposit",
  project: { id: "project-one", name: "Booking app" },
  amountCents: 40000,
  currency: "USD",
  mode: "test",
  status: "PAID",
  refundedCents: 0,
  disputed: false,
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-10-01T12:00:00Z",
  paidAt: "2026-10-01T12:00:00Z",
  receiptUrl: "https://pay.stripe.com/receipts/fixture",
  invoiceUrl: "https://invoice.stripe.com/i/fixture",
  invoicePdf: null,
};
async function fixture(page: Page) {
  const calls: {
    path: string;
    body: Record<string, unknown>;
    search: string;
  }[] = [];
  const state = {
    signedIn: true,
    cards: [card],
    enabled: true,
    saved: true,
    setupFails: false,
    removeFails: false,
    logoutFails: false,
    verifyFails: false,
    setupFinished: false,
    passwordFails: false,
    processing: false,
    dueReview: false,
    historyFails: false,
    listFails: false,
    expired: false,
    paginated: false,
    empty: false,
  };
  await page.route("http://localhost:3121/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const body =
      route.request().method() === "POST"
        ? (route.request().postDataJSON() as Record<string, unknown>)
        : {};
    calls.push({ path, body, search: url.search });
    const send = (json: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", json });
    if (path === "/v1/auth/notifications") return send({ enabled: true, email: "builder@example.invalid", verified: true, projectUpdates: true });
    if (path === "/v1/auth/session")
      return send({
        account: state.signedIn
          ? {
              id: "customer",
              email: "builder@example.invalid",
              displayName: "Email Builder",
              googleConnected: true,
              isOperator: false,
            }
          : null,
        emailEnabled: true,
        googleEnabled: true,
        connectEnabled: true,
      });
    if (path === "/v1/auth/login") {
      state.signedIn = true;
      return send({ signedIn: true });
    }
    if (path === "/v1/auth/logout") {
      if (state.logoutFails)
        return send({ error: { message: "Could not sign out." } }, 503);
      state.signedIn = false;
      return send({ signedOut: true });
    }
    if (path === "/v1/projects") return send({ projects: [] });
    if (path === "/v1/session")
      return send({
        repositories: [],
        connectEnabled: true,
        connectionError: null,
      });
    if (state.expired)
      return send({ error: { message: "Sign in again." } }, 401);
    if (path === "/v1/billing/cards") {
      if (state.listFails) {
        return send(
          { error: { message: "Card list couldn’t be loaded." } },
          503,
        );
      }
      return send({
        cards: url.searchParams.has("after")
          ? [{ ...card, id: "pm_second", last4: "1111" }]
          : state.cards,
        next:
          state.paginated && !url.searchParams.has("after") ? "pm_owned" : null,
        enabled: state.enabled,
        mode: state.enabled ? "test" : "unconfigured",
      });
    }
    if (path === "/v1/billing/cards/setup") {
      if (state.setupFails) {
        state.setupFails = false;
        return send(
          {
            error: {
              message: "Stripe connection interrupted. Retry Add card.",
            },
          },
          503,
        );
      }
      if (state.setupFinished) {
        state.setupFinished = false;
        return send({ finished: true });
      }
      return send({ url: "https://checkout.stripe.com/c/setup/fixture" });
    }
    if (path === "/v1/auth/password-reset/request")
      return state.passwordFails
        ? send({ error: { message: "Could not send reset email." } }, 503)
        : send({ message: "Check your email for a reset link." });
    if (path === "/v1/billing/cards/verify") {
      if (state.verifyFails)
        return send(
          { error: { message: "Could not confirm setup. Retry." } },
          503,
        );
      if (body.sessionId === "cs_foreign")
        return send(
          {
            error: {
              message: "This billing record isn’t available to your account.",
            },
          },
          404,
        );
      return send({ saved: state.saved });
    }
    if (path.endsWith("/remove")) {
      if (state.removeFails) {
        state.removeFails = false;
        return send(
          { error: { message: "Connection interrupted. Retry removal." } },
          503,
        );
      }
      state.cards = [];
      return send({ removed: true });
    }
    if (path === "/v1/billing") {
      if (state.historyFails) {
        return send(
          { error: { message: "Billing couldn’t be loaded. Please retry." } },
          503,
        );
      }
      const status = url.searchParams.get("status") || "ALL";
      const first = { ...payment },
        refund = {
          ...payment,
          id: "payment-two",
          label: "Final payment",
          amountCents: 60000,
          refundedCents: 10000,
          receiptUrl: "javascript:alert(1)",
          invoiceUrl: "https://evil.example/invoice",
        };
      const history = state.empty
        ? []
        : status === "FAILED"
          ? []
          : status === "REFUNDED"
            ? [refund]
            : url.searchParams.has("after")
              ? [{ ...payment, id: "payment-three", label: "Follow-on work" }]
              : [first, refund];
      return send({
        enabled: state.enabled,
        mode: state.enabled ? "test" : "unconfigured",
        totals: state.empty
          ? []
          : [
              {
                currency: "USD",
                mode: "test",
                paidCents: 100000,
                refundedCents: 10000,
              },
              {
                currency: "EUR",
                mode: "live",
                paidCents: 20000,
                refundedCents: 0,
              },
            ],
        history,
        next:
          state.paginated && !url.searchParams.has("after")
            ? "cursor-one"
            : null,
        due: state.empty
          ? []
          : [
              {
                id: "due-one",
                label: "Build checkpoint",
                amountCents: 40000,
                currency: "USD",
                needsReview: state.dueReview,
                processing: state.processing,
                project: payment.project,
              },
            ],
        dueNext: null,
      });
    }
    return send({ error: { message: "Unexpected fixture call" } }, 404);
  });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Secure Stripe test card setup</h1>",
    }),
  );
  return { state, calls };
}

test("account has styled card management and complete customer navigation", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Account settings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Website", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Customer navigation" })
      .getByRole("link", { name: "Billing", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".saved-card-list")).toContainText("4242");
  await expect(page.getByRole("button", { name: "Add card" })).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath(`account-${info.project.name}.png`),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Remove visa ending in 4242" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep card" })).toBeFocused();
  await page.screenshot({
    path: info.outputPath(`card-removal-${info.project.name}.png`),
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove visa ending in 4242" }),
  ).toBeFocused();
});
test("removal requires confirmation and recovers an interrupted request", async ({
  page,
}) => {
  const { state, calls } = await fixture(page);
  state.removeFails = true;
  await page.goto("/account");
  await page
    .getByRole("button", { name: "Remove visa ending in 4242" })
    .click();
  expect(calls.some((c) => c.path.endsWith("/remove"))).toBe(false);
  await page.getByRole("button", { name: "Remove card", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Connection interrupted",
  );
  await page.getByRole("button", { name: "Remove card", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#payment-methods").getByRole("status")).toContainText("4242 was removed");
  await expect(
    page.getByRole("heading", { name: "No saved cards yet" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add card" })).toBeFocused();
});
test("Add card keeps a stable retry ID across reload and opens hosted setup", async ({
  page,
}) => {
  const { state, calls } = await fixture(page);
  state.setupFails = true;
  await page.goto("/account");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Stripe connection interrupted",
  );
  await page.reload();
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/setup/fixture");
  const setups = calls.filter((c) => c.path.endsWith("/setup"));
  expect(setups).toHaveLength(2);
  expect(setups[0].body.requestId).toBe(setups[1].body.requestId);
  expect(JSON.stringify(setups)).not.toContain("4242");
});
test("only authoritative setup confirmation declares saved and pending setup can retry", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.saved = false;
  await page.goto("/account?card=returned&session_id=cs_owned#payment-methods");
  await expect(page.locator("#payment-methods").getByRole("status")).toContainText(
    "hasn’t finished saving",
  );
  await expect(page.locator("#payment-methods").getByRole("status")).not.toContainText(
    "Stripe completed card setup",
  );
  state.saved = true;
  await page.getByRole("button", { name: "Check card setup" }).click();
  await expect(page.locator("#payment-methods").getByRole("status")).toContainText(
    "Stripe completed card setup",
  );
  await expect(page).toHaveURL(/\/account#payment-methods$/);
});
test("cancel and foreign setup returns give honest feedback", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/account?card=cancelled#payment-methods");
  await expect(page.locator(".portal-notice[role=status]")).toContainText(
    "cancelled",
  );
  await page.goto(
    "/account?card=returned&session_id=cs_foreign#payment-methods",
  );
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "isn’t available",
  );
  await expect(page.locator("#payment-methods").getByRole("status")).toHaveCount(0);
});
test("card list failure retries, pagination and provider unavailable states work", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.listFails = true;
  state.paginated = true;
  await page.goto("/account");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "couldn’t be loaded",
  );
  state.listFails = false;
  await page.getByRole("button", { name: "Refresh payment methods" }).click();
  await page.getByRole("button", { name: "Load more cards" }).click();
  await expect(page.locator(".saved-card-list")).toContainText("1111");
  state.enabled = false;
  state.cards = [];
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Payment methods are currently unavailable",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add card" })).toBeDisabled();
});
test("Billing has separate totals, due payments, styled filters and safe documents", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto("/billing");
  await expect(
    page.getByRole("heading", { name: "Billing", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Website", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".billing-summary")).toContainText("$1,000.00");
  await expect(page.locator(".billing-summary")).toContainText("€200.00");
  await expect(
    page.getByRole("link", { name: "View payment" }),
  ).toHaveAttribute("href", "/dashboard?project=project-one#payments");
  await expect(
    page.getByRole("link", { name: /Receipt for Deposit/ }),
  ).toHaveAttribute("href", payment.receiptUrl);
  expect(
    await page.locator('.billing-documents a[href*="evil.example"]').count(),
  ).toBe(0);
  await page.getByLabel("Status", { exact: true }).click();
  await page.screenshot({
    path: info.outputPath(`billing-filter-${info.project.name}.png`),
  });
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: info.outputPath(`billing-${info.project.name}.png`),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.locator("select:visible").count()).toBe(0);
  await chooseOption(page.getByLabel("Status", { exact: true }), "REFUNDED");
  await expect(page.locator(".billing-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".billing-table")).toContainText(
    "Partially refunded",
  );
  await chooseOption(page.getByLabel("Status", { exact: true }), "FAILED");
  await expect(
    page.getByRole("heading", { name: "No payments match this status" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all payments" }).click();
  await expect(page.locator(".billing-table tbody tr")).toHaveCount(2);
});
test("Billing empty state and interrupted loads are actionable, pagination keeps earlier records", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.historyFails = true;
  await page.goto("/billing");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "couldn’t be loaded",
  );
  state.paginated = true;
  state.historyFails = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".billing-table tbody tr")).toHaveCount(2);
  state.historyFails = true;
  await page
    .getByRole("button", { name: "Load more payments", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.locator(".billing-table tbody tr")).toHaveCount(2);
  state.historyFails = false;
  await page
    .getByRole("button", { name: "Load more payments", exact: true })
    .click();
  await expect(page.locator(".billing-table tbody tr")).toHaveCount(3);
  state.empty = true;
  state.paginated = false;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "You’re all caught up" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your first payment starts a record" }),
  ).toBeVisible();
});
test("an expired card or billing session clears private content and signs back into the right page", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await page.goto("/account");
  await expect(page.locator(".saved-card-list")).toBeVisible();
  state.expired = true;
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible();
  await expect(page.locator(".saved-card-list")).toHaveCount(0);
  state.expired = false;
  state.signedIn = false;
  await page.goto("/billing");
  await page.getByRole("link", { name: "Sign in to your account" }).click();
  await expect(page).toHaveURL(/\/login\?return=billing$/);
  await page.getByLabel("Email address").fill("builder@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("fixture password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/billing$/);
  await expect(
    page.getByRole("heading", { name: "Payment history" }),
  ).toBeVisible();
});
test("OAuth remembers only allowed account routes and invalid email returns stay in dashboard", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.signedIn = false;
  await page.route(
    "http://localhost:3121/v1/auth/google/connect?flow=login",
    (route) => {
      state.signedIn = true;
      return route.fulfill({
        status: 302,
        headers: {
          location: "http://127.0.0.1:3130/dashboard?google=connected",
        },
      });
    },
  );
  await page.goto("/login?return=account");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("heading", { name: "Account settings" }),
  ).toBeVisible();
  state.signedIn = false;
  await page.goto("/login?return=https://evil.example");
  await page.getByLabel("Email address").fill("builder@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("fixture password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a completed setup with a missed return rotates the acknowledged request before Add card", async ({
  page,
}) => {
  const { state, calls } = await fixture(page);
  state.setupFinished = true;
  await page.goto("/account");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/setup/fixture");
  const requests = calls.filter((c) => c.path.endsWith("/setup"));
  expect(requests).toHaveLength(2);
  expect(requests[0].body.requestId).not.toBe(requests[1].body.requestId);
});
test("setup verification error clears after a successful retry and feedback stays in view", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.saved = false;
  await page.goto("/account?card=returned&session_id=cs_owned#payment-methods");
  await expect(page.locator(".portal-notice[role=status]")).toBeInViewport();
  state.verifyFails = true;
  await page
    .getByRole("button", { name: "Check card setup", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not confirm",
  );
  state.verifyFails = false;
  state.saved = true;
  await page
    .getByRole("button", { name: "Check card setup", exact: true })
    .click();
  await expect(page.locator(".portal-notice[role=status]")).toContainText(
    "Stripe completed card setup",
  );
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".portal-notice[role=status]")).toBeInViewport();
});
test("failed sign out stays visible in Billing and successful retry clears private records", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await page.goto("/billing");
  state.logoutFails = true;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Sign out wasn’t completed",
  );
  await expect(page.locator("main").getByRole("alert")).toBeInViewport();
  await expect(page.locator(".billing-table")).toBeVisible();
  state.logoutFails = false;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".billing-table")).toHaveCount(0);
});
test("pending and reviewed installments explain the next action and full agreed amount", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.processing = true;
  await page.goto("/billing");
  await expect(page.locator(".billing-due")).toContainText(
    "Confirmation pending",
  );
  await expect(
    page.getByRole("link", { name: "Check payment status" }),
  ).toBeVisible();
  state.dueReview = true;
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Review in project" }),
  ).toBeVisible();
  await expect(page.locator(".billing-due-amount")).toContainText(
    "Agreed installment",
  );
  await expect(page.getByRole("note")).toContainText("New Checkout sessions");
});
test("password reset feedback and pagination errors are beside the action", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await page.goto("/account");
  state.passwordFails = true;
  await page.getByRole("button", { name: "Send password reset email" }).click();
  await expect(
    page.locator("#sign-in-methods").getByRole("alert"),
  ).toBeInViewport();
  state.passwordFails = false;
  await page.getByRole("button", { name: "Send password reset email" }).click();
  await expect(
    page.locator("#sign-in-methods").getByRole("status"),
  ).toBeInViewport();
  await expect(page.locator("#sign-in-methods").getByRole("alert")).toHaveCount(
    0,
  );
  state.paginated = true;
  await page.goto("/billing");
  await expect(
    page.getByRole("button", { name: "Load more payments", exact: true }),
  ).toBeVisible();
  state.historyFails = true;
  await page
    .getByRole("button", { name: "Load more payments", exact: true })
    .click();
  await expect(
    page.locator(".billing-history").getByRole("alert"),
  ).toBeInViewport();
});
