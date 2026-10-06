import { expect, test, type Page } from "@playwright/test";
const emptySession = {
  connectEnabled: false,
  installUrl: null,
  githubLogin: null,
  truncated: false,
  repositories: [],
  connectionError: null,
  inspection: null,
};
const report = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  repository: "builder/app",
  url: "https://github.com/builder/app",
  branch: "main",
  commit: "a".repeat(40),
  stack: ["Next.js"],
  fileCount: 12,
  complete: true,
  assessmentEffort: {
    minDays: 0.5,
    maxDays: 1,
    confidence: "low",
    basis: "A planning allowance based on the sampled repository size.",
  },
  evidence: [
    {
      title: "Workflow tests",
      detail: "Tests still need to run.",
      paths: ["tests/checkout.test.ts"],
      kind: "observed",
    },
  ],
  limitations: ["No code, build, or tests were executed."],
  nextSteps: ["Reproduce the broken journeys."],
};
async function fillBrief(page: Page) {
  await page.getByLabel("Your name", { exact: true }).fill("Pilot Builder");
  await page.getByLabel("Email", { exact: true }).fill("pilot@example.invalid");
  await page.getByLabel("App or project name").fill("Booking App");
  await page.getByLabel("Started with").selectOption("Lovable");
  await page.getByLabel("Payments", { exact: true }).check();
  await page
    .getByLabel("What would you like to fix or add?")
    .fill(
      "Checkout should accept payment, but it returns the user to the home page.",
    );
  await page.getByRole("checkbox", { name: "I’m authorized" }).check();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/v1/session", (route) =>
    route.fulfill({ json: emptySession }),
  );
  await page.route("**/v1/inspection-selection/remove", (route) =>
    route.fulfill({ json: { removed: true } }),
  );
});
test("manual brief preserves values after failure and confirms only a successful save", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/v1/intakes", async (route) => {
    attempts++;
    await route.fulfill(
      attempts === 1
        ? {
            status: 503,
            json: {
              error: {
                message: "Please try again; the database is unavailable.",
              },
            },
          }
        : {
            status: 201,
            json: {
              id: "saved-brief",
              message: "Your brief is saved for review.",
            },
          },
    );
  });
  await page.goto("/#review");
  await fillBrief(page);
  await page.getByRole("button", { name: "Send my app for review" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "database is unavailable" }),
  ).toContainText("database is unavailable");
  await expect(page.getByLabel("App or project name")).toHaveValue(
    "Booking App",
  );
  await page.getByRole("button", { name: "Send my app for review" }).click();
  await expect(
    page.getByRole("heading", { name: "You’ve taken the next step." }),
  ).toBeFocused();
  await expect(page.getByText("Reference: saved-brief")).toBeVisible();
});
test("inspects an authorized connected repo and attaches its report to the brief", async ({
  page,
}) => {
  await page.route("**/v1/session", (route) =>
    route.fulfill({
      json: {
        ...emptySession,
        connectEnabled: true,
        githubLogin: "builder",
        repositories: [{ name: "builder/app", url: report.url, private: true }],
      },
    }),
  );
  await page.route("**/v1/github/inspect", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      repositoryUrl: report.url,
    });
    await route.fulfill({ json: report });
  });
  await page.route("**/v1/intakes", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      inspectionId: report.id,
      consent: true,
    });
    await route.fulfill({
      status: 201,
      json: { id: "with-inspection", message: "Your brief is saved." },
    });
  });
  await page.goto("/#review");
  await page
    .getByLabel("Choose a connected repository")
    .selectOption(report.url);
  await page.getByRole("button", { name: "Inspect repository" }).click();
  await expect(
    page.getByRole("heading", { name: "builder/app", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Project ETA needs workflow review.", { exact: false }),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "Workflow tests" }).click();
  await expect(
    page.getByRole("link", { name: "tests/checkout.test.ts" }),
  ).toHaveAttribute(
    "href",
    `https://github.com/builder/app/blob/${report.commit}/tests/checkout.test.ts`,
  );
  await fillBrief(page);
  await page.getByRole("button", { name: "Send my app for review" }).click();
  await expect(page.getByText("Reference: with-inspection")).toBeVisible();
});
test("removing an inspection survives connection refresh and a page reload", async ({
  page,
}) => {
  let selected: typeof report | null = report;
  await page.route("**/v1/session", (route) =>
    route.fulfill({
      json: {
        ...emptySession,
        connectEnabled: true,
        githubLogin: "builder",
        inspection: selected,
      },
    }),
  );
  await page.route("**/v1/inspection-selection/remove", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ inspectionId: report.id });
    selected = null;
    await route.fulfill({ json: { removed: true } });
  });
  await page.route("**/v1/github/disconnect", (route) =>
    route.fulfill({ json: { disconnected: true } }),
  );
  await page.goto("/#review");
  await expect(
    page.getByText("Inspection attached:", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove inspection from this brief" })
    .click();
  await expect(
    page.getByText("Inspection attached:", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("GitHub repository link")).toHaveValue("");
  await expect(
    page.getByText("Inspection attached:", { exact: false }),
  ).toHaveCount(0);
});
test("accepts a new-feature brief without a broken workflow", async ({
  page,
}) => {
  await page.route("**/v1/intakes", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      workflows: ["New features"],
      problem:
        "We want team accounts with shared dashboards and a CRM integration.",
    });
    await route.fulfill({
      status: 201,
      json: { id: "feature-request", message: "Your brief is saved." },
    });
  });
  await page.goto("/#review");
  await fillBrief(page);
  await page.getByLabel("Payments", { exact: true }).uncheck();
  await page.getByLabel("New features", { exact: true }).check();
  await page
    .getByLabel("What would you like to fix or add?")
    .fill(
      "We want team accounts with shared dashboards and a CRM integration.",
    );
  await page.getByRole("button", { name: "Send my app for review" }).click();
  await expect(page.getByText("Reference: feature-request")).toBeVisible();
});
test("a changed repository removes the old inspection, and scan failure still permits manual intake", async ({
  page,
}) => {
  await page.route("**/v1/session", (route) =>
    route.fulfill({ json: { ...emptySession, inspection: report } }),
  );
  await page.route("**/v1/github/inspect", (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: { message: "Repository not found. Send your brief manually." },
      },
    }),
  );
  await page.route("**/v1/intakes", async (route) => {
    expect(route.request().postDataJSON()).not.toHaveProperty("inspectionId");
    await route.fulfill({
      status: 201,
      json: { id: "manual-fallback", message: "Your brief is saved." },
    });
  });
  await page.goto("/#review");
  await expect(
    page.getByText("Inspection attached:", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("GitHub repository link")
    .fill("https://github.com/builder/other");
  await expect(
    page.getByText("Inspection attached:", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect repository" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Repository not found" }),
  ).toContainText("Repository not found");
  await fillBrief(page);
  await page.getByRole("button", { name: "Send my app for review" }).click();
  await expect(page.getByText("Reference: manual-fallback")).toBeVisible();
});
test("has no horizontal overflow, labels form fields, and supports keyboard FAQ access", async ({
  page,
}) => {
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByText("Will you rebuild my whole app?", { exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("We start with what you have.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Your name", { exact: true })).toHaveAttribute(
    "autocomplete",
    "name",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});
test("shows partial scan coverage before the assessment allowance", async ({
  page,
}) => {
  await page.route("**/v1/session", (route) =>
    route.fulfill({
      json: { ...emptySession, inspection: { ...report, complete: false } },
    }),
  );
  await page.goto("/#review");
  await expect(
    page.getByText("Partial file inventory.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Assessment allowance", { exact: true }),
  ).toBeVisible();
});
test("explains required workflow selection and focuses the group after a missing choice", async ({
  page,
}) => {
  let submissions = 0;
  await page.route("**/v1/intakes", async (route) => {
    submissions++;
    await route.fulfill({
      status: 201,
      json: { id: "selected-feature", message: "Your brief is saved." },
    });
  });
  await page.goto("/#review");
  await fillBrief(page);
  await page.getByLabel("Payments", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Send my app for review" }).click();
  await expect(
    page.getByRole("group", { name: "What needs help? (choose at least one)" }),
  ).toBeFocused();
  await expect(
    page.getByRole("alert").filter({ hasText: "Choose at least one workflow" }),
  ).toBeVisible();
  expect(submissions).toBe(0);
  await page.getByLabel("New features", { exact: true }).check();
  await page.getByRole("button", { name: "Send my app for review" }).click();
  await expect(page.getByText("Reference: selected-feature")).toBeVisible();
});
