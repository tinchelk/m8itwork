import { test, expect } from "@playwright/test";
import { mockWorkspace, publishProposal } from "./fixtures/workspace";

test("blocks customer access to the admin desk before requesting private team data", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.goto("http://127.0.0.1:3131/");
  await expect(
    page.getByRole("heading", { name: "The backoffice is for the team." }),
  ).toBeVisible();
  expect(state.operatorRequests).toBe(0);
  await expect(
    page.getByRole("link", { name: "Open your dashboard" }),
  ).toHaveAttribute("href", "http://127.0.0.1:3130/dashboard");
});
test("keeps a failed message draft and explains unavailable payment collection", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  publishProposal(state);
  state.project.proposals[0]!.milestones = [
    {
      id: "8b3f8de8-5118-4a54-8506-78372585f410",
      position: 0,
      label: "Project payment",
      amountCents: 125000,
      dueWhen: "BEFORE_BUILD",
      releasedAt: new Date().toISOString(),
      paidAt: null,
      paidCents: 0,
      refundedCents: 0,
      disputed: false,
    },
  ];
  state.project.proposals[0]!.approvedAt = new Date().toISOString();
  state.project.stage = "APPROVED";
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page.getByRole("link", { name: "Conversation", exact: true }).click();
  await page
    .getByLabel("Message to the team")
    .fill("Can you confirm the deposit includes the recurring booking work?");
  state.failMessage = true;
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Message wasn’t saved" }),
  ).toBeInViewport();
  await expect(page.getByLabel("Message to the team")).toHaveValue(
    "Can you confirm the deposit includes the recurring booking work?",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Message saved" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  state.failCheckout = true;
  await page
    .getByRole("button", { name: "Pay Project payment with Stripe" })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "collection is being set up" }),
  ).toBeInViewport();
  expect(state.project.proposals[0]!.milestones[0]!.paidCents).toBe(0);
});
test("customer and admin agree installments, converse, pay, track work and complete handover", async ({
  page,
}, testInfo) => {
  const state = await mockWorkspace(page);
  state.project.stage = "IN_REVIEW";
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page
    .getByLabel("Message to the team")
    .fill(
      "Please include recurring bookings and confirm what the deposit covers.",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText(
      "Please include recurring bookings and confirm what the deposit covers.",
      { exact: true },
    ),
  ).toBeVisible();
  state.operator = true;
  await page.goto("http://127.0.0.1:3131/");
  await expect(
    page.getByRole("heading", { name: "Help the next app move forward." }),
  ).toBeVisible();
  await expect(
    page.getByText("New customer message", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Bloom bookings.*New customer message/ })
    .click();
  await page.getByRole("link", { name: "Conversation", exact: true }).click();
  await page
    .getByLabel("Message to the customer")
    .fill(
      "Yes. I’ll propose a deposit and a final payment, with those booking checks included.",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByLabel("Review summary")
    .fill(
      "The existing booking app is a good foundation. We’ll add recurring bookings and verify the customer checkout journey.",
    );
  await page.getByRole("button", { name: "Publish review" }).click();
  await page
    .getByRole("button", { name: "Scope & estimate", exact: true })
    .click();
  await page
    .getByLabel("Proposed scope")
    .fill("Add recurring bookings and repair the customer checkout journey.");
  await page
    .getByLabel("Acceptance checks")
    .fill(
      "Customers can create and cancel recurring bookings and complete checkout.",
    );
  await page.getByLabel("Project cost", { exact: true }).fill("1250");
  await page
    .getByRole("combobox", { name: "Payment schedule", exact: true })
    .selectOption("DEPOSIT_FINAL");
  await page.getByLabel("Estimated delivery date").fill("2099-12-01");
  await page
    .getByLabel("Assumptions & conditions")
    .fill(
      "Starts after access and deposit payment. Final payment follows verification before handover.",
    );
  await page.getByRole("button", { name: "Publish new proposal" }).click();
  expect(
    state.project.proposals[0]!.milestones!.map((m) => m.amountCents),
  ).toEqual([62500, 62500]);
  await page
    .getByLabel("Private note", { exact: true })
    .fill("Internal: check builder export constraints before implementation.");
  await page.getByRole("button", { name: "Save private note" }).click();
  state.operator = false;
  await page.goto(`/dashboard?project=${state.project.id}`);
  await expect(
    page.getByText(
      "Internal: check builder export constraints before implementation.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Review proposal" }).click();
  await page.getByRole("checkbox", { name: /reviewed this version/ }).check();
  await page.getByRole("button", { name: "Approve scope v1" }).click();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  await page.getByRole("button", { name: "Pay Deposit with Stripe" }).click();
  await expect(
    page.locator("#payments").getByText("Paid", { exact: true }),
  ).toHaveCount(1);
  state.operator = true;
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await page
    .getByRole("button", { name: "Progress update", exact: true })
    .click();
  await page.getByLabel("Project stage").selectOption("BUILDING");
  await page.getByLabel("Update title").fill("Recurring bookings are underway");
  await page
    .getByLabel("What changed / what happens next")
    .fill(
      "We’re implementing the agreed booking rules and checkout improvements.",
    );
  await page.getByRole("button", { name: "Publish update" }).click();
  await page.getByText("Add a delivery item", { exact: true }).click();
  await page
    .getByLabel("Delivery item title")
    .fill("Recurring booking journey");
  await page
    .getByLabel("Outcome / acceptance check")
    .fill(
      "Customers can create and cancel a recurring booking and complete checkout.",
    );
  await page
    .getByRole("button", { name: "Add delivery item", exact: true })
    .click();
  await page.getByText("Update this item", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("DONE");
  await page
    .getByLabel("Checks and result")
    .fill(
      "Weekly booking creation, cancellation, and checkout passed against the agreed examples.",
    );
  await page.getByRole("button", { name: "Save delivery item" }).click();
  await page.getByLabel("Project stage").selectOption("VERIFYING");
  await page.getByLabel("Update title").fill("Acceptance checks passed");
  await page
    .getByLabel("What changed / what happens next")
    .fill(
      "The agreed customer workflows passed. Preparing final handover after the last installment.",
    );
  await page.getByRole("button", { name: "Publish update" }).click();
  await page
    .getByRole("button", { name: "Request Final payment", exact: true })
    .click();
  state.operator = false;
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  await page
    .getByRole("button", { name: "Pay Final payment with Stripe" })
    .click();
  await expect(
    page.locator("#payments").getByText("Paid", { exact: true }),
  ).toHaveCount(2);
  state.operator = true;
  await page.goto(`http://127.0.0.1:3131/?project=${state.project.id}`);
  await page
    .getByRole("button", { name: "Progress update", exact: true })
    .click();
  await page.getByLabel("Project stage").selectOption("COMPLETE");
  await page.getByLabel("Update title").fill("Ready for handover");
  await page
    .getByLabel("What changed / what happens next")
    .fill(
      "The approved booking and checkout work is verified and ready for the customer.",
    );
  await page
    .getByLabel("Verification & handover evidence")
    .fill(
      "Weekly bookings, cancellation and checkout all passed. The delivery links and next steps are recorded here.",
    );
  await page.getByRole("button", { name: "Publish update" }).click();
  state.operator = false;
  await page.goto(`/dashboard?project=${state.project.id}`);
  await expect(
    page.getByText("Ready for your next chapter.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Verification & handover", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (testInfo.project.name === "desktop")
    await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("link", { name: "m8itwork home" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`delivery-customer-${testInfo.project.name}.png`),
    fullPage: false,
  });
  state.operator = true;
  await page.goto("http://127.0.0.1:3131/");
  await expect(
    page.getByRole("heading", { name: "Help the next app move forward." }),
  ).toBeVisible();
  await expect(
    page.getByText("$0.00 outstanding", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`delivery-admin-${testInfo.project.name}.png`),
    fullPage: false,
  });
});

test("preserves loaded history after a new message and acknowledges only visible incoming rows", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  for (let index = 0; index < 51; index++)
    state.messages.push({
      id: crypto.randomUUID(),
      authorRole: "TEAM",
      authorName: "team",
      body: `Review decision ${String(index + 1).padStart(3, "0")}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    });
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page.getByRole("link", { name: "Conversation", exact: true }).click();
  await expect(
    page.getByText("Review decision 002", { exact: true }),
  ).toBeVisible();
  expect(state.readMessageIds).not.toContain(state.messages.at(-1)!.id);
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(
    page.getByText("Review decision 001", { exact: true }),
  ).toBeVisible();
  state.messages.push({
    id: crypto.randomUUID(),
    authorRole: "TEAM",
    authorName: "team",
    body: "Review decision 052",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 52)).toISOString(),
  });
  await page.getByRole("button", { name: "Refresh conversation" }).click();
  await expect(
    page.getByRole("list", { name: "Project messages" }).locator("li"),
  ).toHaveCount(52);
  await expect(
    page.getByText("Review decision 002", { exact: true }),
  ).toHaveCount(1);
  expect(state.readMessageIds).not.toContain(state.messages.at(-1)!.id);
  await page.getByRole("button", { name: "Jump to latest message" }).click();
  await expect
    .poll(() => state.readMessageIds.includes(state.messages.at(-1)!.id))
    .toBe(true);
});

test("recovers a lost message response and sends edited text as a new message", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.goto(`/dashboard?project=${state.project.id}`);
  await page.getByLabel("Message to the team").fill("Original scope question.");
  state.loseMessageResponse = true;
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "couldn't reach" })).toBeVisible();
  expect(state.messages).toHaveLength(1);
  await page
    .getByLabel("Message to the team")
    .fill("Updated scope question with another acceptance check.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "earlier message was already saved" }),
  ).toBeVisible();
  expect(state.messages).toHaveLength(2);
  expect(state.messages[0]!.id).not.toBe(state.messages[1]!.id);
  await expect(
    page.getByText("Original scope question.", { exact: true }),
  ).toBeVisible();
});

function readyPayment(state: Awaited<ReturnType<typeof mockWorkspace>>) {
  publishProposal(state);
  state.project.stage = "APPROVED";
  state.project.proposals[0]!.approvedAt = new Date().toISOString();
  state.project.proposals[0]!.milestones = [
    {
      id: crypto.randomUUID(),
      position: 0,
      label: "Deposit",
      amountCents: 125000,
      dueWhen: "BEFORE_BUILD",
      releasedAt: new Date().toISOString(),
      paidAt: null,
      paidCents: 0,
      refundedCents: 0,
      disputed: false,
      attempts: [{ mode: "test", status: "PROCESSING" }],
    },
  ];
}
test("checks Stripe after Checkout return without crediting pending confirmation", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  readyPayment(state);
  await page.goto(`/dashboard?project=${state.project.id}&payment=returned`);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Payment confirmation is pending" }),
  ).toBeVisible();
  await expect.poll(() => state.syncCalls).toBe(1);
  await expect(
    page.getByRole("button", { name: "Pay Deposit with Stripe" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Confirmation pending · check status", { exact: true }),
  ).toBeVisible();
  const milestone = state.project.proposals[0]!.milestones![0]!;
  milestone.paidCents = milestone.amountCents;
  milestone.attempts![0]!.status = "PAID";
  await page
    .getByRole("button", { name: "Check payment status", exact: true })
    .click();
  await expect(
    page.locator("#payments").getByText("Paid", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Stripe has confirmed the recorded payments" }),
  ).toBeVisible();
  state.project.proposals = [];
  state.project.currentProposalId = null;
  state.project.stage = "DRAFT";
  await page.goto(`/dashboard?project=${state.project.id}&payment=returned`);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "No confirmed payment is recorded" }),
  ).toBeVisible();
  await expect(
    page.getByText("Stripe has confirmed the recorded payments. Thank you.", {
      exact: true,
    }),
  ).toHaveCount(0);
});
test("explains cancelled Checkout and prevents sandbox money being presented as live payment", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  readyPayment(state);
  state.project.proposals[0]!.milestones![0]!.attempts![0]!.status = "OPEN";
  await page.goto(`/dashboard?project=${state.project.id}&payment=cancelled`);
  await expect(
    page.getByRole("status").filter({ hasText: "Checkout was closed" }),
  ).toBeVisible();
  expect(state.syncCalls).toBe(0);
  const milestone = state.project.proposals[0]!.milestones![0]!;
  milestone.paidCents = milestone.amountCents;
  milestone.attempts![0]!.status = "PAID";
  state.project.billing!.mode = "live";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Different payment mode · team review required", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator("#payments").getByText("Paid", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pay Deposit with Stripe" }),
  ).toHaveCount(0);
});
