import { test, expect } from "@playwright/test";
import { mockWorkspace, publishProposal } from "./fixtures/workspace";

const noOverflow = async (page: import("@playwright/test").Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
test("project links support history and new tabs, while proposal anchors retain their target", async ({
  page,
  context,
}) => {
  const state = await mockWorkspace(page);
  publishProposal(state);
  await page.goto("/dashboard");
  const card = page.locator(".dashboard-project");
  await expect(card).toHaveAttribute(
    "href",
    `/dashboard?project=${state.project.id}`,
  );
  const opened = await context.newPage();
  await mockWorkspace(opened);
  await opened.goto((await card.getAttribute("href")) ?? "");
  await expect(
    opened.getByRole("heading", { name: "Bloom bookings", exact: true }),
  ).toBeVisible();
  await opened.close();
  await card.click();
  await expect(page).toHaveURL(new RegExp(state.project.id));
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Your apps. Their next chapter." }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Bloom bookings", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Review proposal", exact: true })
    .click();
  await expect(page.locator("#proposal h2")).toBeInViewport();
  const button = page.getByRole("link", {
    name: "Review proposal",
    exact: true,
  });
  await button.hover();
  const colors = await button.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.color, style.backgroundColor];
  });
  expect(colors[0]).toBe("rgb(20, 32, 43)");
});
test("conversation initial failure is honest and refresh recovers without a stale parent error", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  let fail = true;
  await page.route("**/v1/projects/*/messages", async (route) => {
    if (fail && route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        json: { error: { message: "Conversation temporarily unavailable." } },
      });
    else await route.fallback();
  });
  await page.goto(`/dashboard?project=${state.project.id}`);
  await expect(
    page.getByText("Conversation temporarily unavailable."),
  ).toBeVisible();
  await expect(
    page.getByText("Loading conversation…", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Message to the team")
    .fill("Keep my draft while the conversation recovers.");
  fail = false;
  await page.getByRole("button", { name: "Refresh conversation" }).click();
  await expect(
    page.getByText("Conversation temporarily unavailable."),
  ).toHaveCount(0);
  await expect(page.getByLabel("Message to the team")).toHaveValue(
    "Keep my draft while the conversation recovers.",
  );
});
test("lost added-request response survives reload and retries the same operation without a duplicate", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  let lost = true;
  const ids: string[] = [];
  await page.route("**/v1/projects/*/requests", async (route) => {
    const body = route.request().postDataJSON();
    ids.push(body.id);
    const prior = state.project.requests.find((item) => item.id === body.id);
    if (!prior) {
      state.project.requests.push({
        ...body,
        referenceUrl: null,
        createdAt: new Date().toISOString(),
      });
      state.project.version++;
    }
    if (lost) {
      lost = false;
      await route.abort("connectionreset");
    } else await route.fulfill({ status: 201, json: { id: body.id } });
  });
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page.getByLabel("Title", { exact: true }).fill("Add team calendar");
  await page
    .getByLabel("Details", { exact: true })
    .fill("Show the team calendar and upcoming booking dates.");
  await page.getByRole("button", { name: "Add request", exact: true }).click();
  await expect(
    page.getByText("Your original request is saved.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Add team calendar",
  );
  await page.getByRole("button", { name: "Add request", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(state.project.requests).toHaveLength(1);
});
test("withdrawal shows local failure in the modal, preserves reason, and closed pages promise no future work", async ({
  page,
}, info) => {
  const state = await mockWorkspace(page);
  state.project.stage = "IN_REVIEW";
  await page.route("**/v1/projects/*/cancel", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Result could not be confirmed." } },
    }),
  );
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page
    .getByRole("button", { name: "Withdraw request", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Keep project", exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("I want to pause and check this request first.");
  await dialog.getByRole("button", { name: "Confirm request" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Result could not be confirmed",
  );
  await expect(dialog.getByRole("alert")).toBeInViewport();
  await expect(dialog.getByLabel("Reason", { exact: true })).toHaveValue(
    "I want to pause and check this request first.",
  );
  await page.screenshot({
    path: info.outputPath(`lifecycle-${info.project.name}.png`),
  });
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Withdraw request", exact: true }),
  ).toBeFocused();
  state.project.stage = "WITHDRAWN";
  state.project.closedReason =
    "Customer withdrew the request before scope approval.";
  state.project.version++;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/Your history is here/)).toBeVisible();
  await expect(page.getByText(/Our findings are pending/)).toHaveCount(0);
  await expect(page.getByText(/No current scope was agreed/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add request", exact: true }),
  ).toHaveCount(0);
});
test("refreshed baselines expose one historical proposal including its checks and conditions", async ({
  page,
}, info) => {
  const state = await mockWorkspace(page);
  publishProposal(state);
  state.project.stage = "IN_REVIEW";
  state.project.currentProposalId = null;
  state.project.revisions = [
    {
      id: "history",
      commit: "a".repeat(40),
      report: {
        repository: "builder/private-app",
        url: "https://github.com/builder/private-app",
        commit: "a".repeat(40),
        branch: "main",
        stack: ["Next.js"],
        fileCount: 42,
        complete: false,
        limitations: [],
      },
      reviewSummary: "Earlier review with its evidence preserved.",
      createdAt: new Date().toISOString(),
    },
  ];
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page.getByText("Previous proposal versions", { exact: true }).click();
  await expect(
    page.getByText(
      "Retained history — this version cannot be approved as the current plan.",
    ),
  ).toBeVisible();
  await expect(
    page
      .locator(".portal-old-proposal")
      .getByRole("heading", { name: "Agreed checks" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath(`history-${info.project.name}.png`),
  });
  await noOverflow(page);
});
test("pending cancellation suppresses collection and checklist; revised terms require fresh acknowledgement", async ({
  page,
}, info) => {
  const state = await mockWorkspace(page);
  publishProposal(state);
  state.project.stage = "BUILDING";
  state.project.proposals[0]!.approvedAt = new Date().toISOString();
  state.project.cancellationRequestedAt = new Date().toISOString();
  state.project.settlementProposedAt = new Date().toISOString();
  state.project.settlementSummary =
    "Completed review retained; future development installments cancelled.";
  state.project.settlementRetainedCents = 10000;
  await page.goto(`/dashboard?project=${state.project.id}`);
  const checkbox = page.getByRole("checkbox", {
    name: "I agree to this written settlement and retained amount.",
  });
  await checkbox.check();
  state.project.settlementRetainedCents = 15000;
  state.project.settlementSummary =
    "Revised completion record requires a different retained amount.";
  state.project.version++;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole("button", { name: /^Pay / })).toHaveCount(0);
  await page.locator(".project-lifecycle").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath(`settlement-${info.project.name}.png`),
  });
  await noOverflow(page);
  state.operator = true;
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await expect(
    page.getByText("Add a delivery item", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Request this payment" }),
  ).toHaveCount(0);
});
test("published handover remains separate from customer acceptance and finishes every journey step", async ({
  page,
}, info) => {
  const state = await mockWorkspace(page);
  publishProposal(state);
  state.project.stage = "COMPLETE";
  state.project.handover = {
    summary: "Booking features delivered and verified.",
    artifacts: [
      {
        label: "Delivery pull request",
        url: "https://github.com/fixture/app/pull/1",
      },
    ],
    checks: "Agreed booking checks passed against recorded examples.",
    instructions:
      "Deploy the approved branch and configure the required service.",
    limitations: "No known limitations in the agreed acceptance checks.",
    deployment: "Production deployment is excluded from this agreement.",
    publishedAt: new Date().toISOString(),
  };
  await page.route("**/v1/projects/*/accept", async (route) => {
    state.project.acceptedAt = new Date().toISOString();
    state.project.version++;
    await route.fulfill({ json: { saved: true } });
  });
  await page.goto(`/dashboard?project=${state.project.id}`);
  await expect(
    page.getByText("Your handover is ready to review."),
  ).toBeVisible();
  await expect(page.locator(".portal-steps .current")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Delivery pull request" }),
  ).toHaveAttribute("target", "_blank");
  await page.locator("#handover").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath(`handover-${info.project.name}.png`),
  });
  await noOverflow(page);
  await page
    .getByRole("checkbox", { name: /I reviewed the artifacts/ })
    .check();
  await page
    .getByRole("button", { name: "Accept delivery", exact: true })
    .click();
  await expect(
    page.getByText("Delivery accepted. Aftercare remains available."),
  ).toBeVisible();
});
test("backoffice operations exposes online login attention, contact guidance and persistent rejected retries", async ({
  page,
}, info) => {
  await mockWorkspace(page, { operator: true });
  await page.route("**/v1/operator/operations", (route) =>
    route.fulfill({
      json: {
        paymentEvents: [],
        emailEvents: [
          {
            id: "email",
            projectId: null,
            kind: "PROJECT_UPDATE",
            attempts: 0,
            lastError: "CONTACT_REQUIRED",
            skippedAt: null,
            createdAt: new Date().toISOString(),
          },
          {
            id: "failed",
            projectId: null,
            kind: "PROJECT_UPDATE",
            attempts: 3,
            lastError: "EMAIL_UNAVAILABLE",
            skippedAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
        workers: [
          {
            id: "worker",
            name: "Review host",
            offline: false,
            lastSeenAt: new Date().toISOString(),
            providerStatus: [{ provider: "codex", state: "NEEDS_LOGIN" }],
          },
        ],
        failedJobs: [],
        processing: "Events retry every minute.",
      },
    }),
  );
  await page.route("**/v1/operator/operations/email/retry", (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: { message: "Retry window expired. Check delivery history." },
      },
    }),
  );
  await page.goto("http://127.0.0.1:3131/");
  await page
    .getByText("Service health & recovery", { exact: true })
    .first()
    .click();
  await expect(
    page.getByText(/sign-in required — open Worker setup/),
  ).toBeVisible();
  await expect(page.getByText(/Ask the customer to verify/)).toBeVisible();
  await page
    .getByRole("button", { name: "Retry email delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh operations", exact: true })
    .click();
  await expect(
    page.locator(".operations-panel").getByRole("alert"),
  ).toContainText("Retry window expired");
  await page.screenshot({
    path: info.outputPath(`operations-${info.project.name}.png`),
  });
  await noOverflow(page);
});

test("notification preferences explain unavailable delivery, verify separately and retain failures locally", async ({
  page,
}, info) => {
  await mockWorkspace(page, { operator: true });
  const prefs = {
    enabled: false,
    email: null as string | null,
    verified: false,
    projectUpdates: true,
    operatorAlerts: true,
  };
  await page.route("**/v1/billing/cards", (route) =>
    route.fulfill({
      json: { enabled: false, mode: "unconfigured", cards: [], next: null },
    }),
  );
  await page.route("**/v1/auth/notifications", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      Object.assign(prefs, body);
      await route.fulfill({ json: { saved: true } });
    } else await route.fulfill({ json: prefs });
  });
  await page.route("**/v1/auth/notifications/verify", async (route) => {
    prefs.email = "updates@example.invalid";
    prefs.verified = true;
    await route.fulfill({ json: { verified: true } });
  });
  await page.goto("/account#notifications");
  await expect(page.getByText(/Email delivery is unavailable/)).toBeVisible();
  expect(
    await page
      .locator("#notifications .portal-check")
      .first()
      .evaluate((node) => getComputedStyle(node).flexDirection),
  ).toBe("row");
  await page
    .getByRole("checkbox", { name: "Email me project updates", exact: true })
    .uncheck();
  await expect(page.getByText(/Project emails paused/)).toBeVisible();
  expect(prefs.projectUpdates).toBe(false);
  await page.screenshot({
    path: info.outputPath(`notifications-${info.project.name}.png`),
  });
  await noOverflow(page);
  prefs.enabled = true;
  await page.goto("/account#contact=synthetic-verification-token");
  await page
    .getByRole("button", { name: "Verify notification email", exact: true })
    .click();
  await expect(
    page.getByText("Verified destination: updates@example.invalid"),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("checkbox", {
      name: "Email me customer requests and operational alerts",
      exact: true,
    }),
  ).toBeVisible();
});

test("a failed repository recheck removes the old candidate and operator forms follow refreshed delivery stage", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.project.stage = "IN_REVIEW";
  state.project.repositoryUrl = "https://github.com/builder/private-app";
  state.project.inspectionReport = {
    repository: "builder/private-app",
    url: state.project.repositoryUrl,
    commit: "b".repeat(40),
    branch: "main",
    stack: ["Next.js"],
    fileCount: 42,
    complete: false,
    limitations: [],
  };
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page
    .getByRole("button", {
      name: "Check latest repository commit",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Refresh baseline", exact: true }),
  ).toBeVisible();
  state.failInspection = true;
  await page
    .getByRole("button", {
      name: "Check latest repository commit",
      exact: true,
    })
    .click();
  await expect(page.getByText(/Repository couldn't be checked/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh baseline", exact: true }),
  ).toHaveCount(0);
  state.operator = true;
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await expect(
    page.getByLabel("Review summary", { exact: true }),
  ).toBeVisible();
  state.project.stage = "BUILDING";
  state.project.version++;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("Review summary", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Project stage", { exact: true })).toBeVisible();
});

for (const dismissal of ["Escape", "Close & check result"])
  test(`committed withdrawal with lost response recovers via ${dismissal} without replay`, async ({
    page,
  }) => {
    const state = await mockWorkspace(page);
    state.project.stage = "IN_REVIEW";
    let posts = 0;
    await page.route("**/v1/projects/*/cancel", async (route) => {
      posts++;
      state.project.stage = "WITHDRAWN";
      state.project.closedReason =
        "Saved customer withdrawal with retained history.";
      state.project.version++;
      await route.abort("connectionreset");
    });
    await page.goto(`/dashboard?project=${state.project.id}`);
    await page
      .getByRole("button", { name: "Withdraw request", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    expect(
      await dialog.evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgb(21, 44, 59)");
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Please withdraw this request and retain the history.");
    await dialog.getByRole("button", { name: "Confirm request" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "does not undo a submitted request",
    );
    await expect(
      dialog.getByRole("button", { name: "Keep project", exact: true }),
    ).toHaveCount(0);
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else
      await dialog
        .getByRole("button", { name: dismissal, exact: true })
        .click();
    await expect(page.getByText(/Your history is here/)).toBeVisible();
    expect(posts).toBe(1);
    await expect(
      page.getByRole("button", { name: "Withdraw request", exact: true }),
    ).toHaveCount(0);
  });

test("notification verification survives signed-out email sign-in and wrong-account failure", async ({
  page,
}) => {
  const state = await mockWorkspace(page, { signedOut: true, emailOnly: true });
  const contact = "synthetic-verification-token";
  const calls: string[] = [];
  await page.route("**/v1/auth/session", async (route) => {
    const signedOut = state.signedOut;
    await route.fulfill({
      json: {
        connectEnabled: true,
        googleEnabled: true,
        emailEnabled: true,
        account: signedOut
          ? null
          : {
              id: state.accountId,
              email: "builder@example.invalid",
              emailVerified: true,
              githubLogin: null,
              isOperator: false,
            },
      },
    });
  });
  await page.route("**/v1/auth/login", async (route) => {
    state.signedOut = false;
    await route.fulfill({ json: { signedIn: true } });
  });
  await page.route("**/v1/auth/notifications/verify", async (route) => {
    calls.push(route.request().postDataJSON().token);
    await route.fulfill(
      state.accountId === "customer"
        ? { json: { verified: true } }
        : {
            status: 400,
            json: {
              error: {
                message: "Open the verification link for this account.",
              },
            },
          },
    );
  });
  await page.goto(`/account#contact=${contact}`);
  await page
    .getByRole("link", { name: "Sign in to your account", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/login\\?return=account#contact=${contact}`),
  );
  await page
    .getByLabel("Email address", { exact: true })
    .fill("builder@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/account#contact=${contact}`));
  expect(calls).toHaveLength(0);
  state.accountId = "other-account";
  await page
    .getByRole("button", { name: "Verify notification email", exact: true })
    .click();
  await expect(page.locator("#notifications").getByRole("alert")).toContainText(
    "for this account",
  );
  await expect(page).toHaveURL(new RegExp(`contact=${contact}`));
  state.accountId = "customer";
  await page
    .getByRole("button", { name: "Verify notification email", exact: true })
    .click();
  await expect(page).toHaveURL(/\/account$/);
  expect(calls).toEqual([contact, contact]);
});
