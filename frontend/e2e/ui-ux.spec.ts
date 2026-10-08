import { test, expect } from "@playwright/test";
import { mockWorkspace } from "./fixtures/workspace";

test("gives Google and GitHub equal sign-in controls with sequential keyboard focus", async ({ page }, info) => {
  await page.route("**/v1/auth/session", route => route.fulfill({ json: { account: null, googleEnabled: true, connectEnabled: true, emailEnabled: true } }));
  await page.goto("/login");
  const google = page.getByRole("link", { name: "Continue with Google", exact: true });
  const github = page.getByRole("link", { name: "Continue with GitHub", exact: true });
  await expect(google).toBeVisible();
  await expect(github).toBeVisible();
  const appearance = (element: Element) => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    return { width: box.width, height: box.height, color: style.color, background: style.backgroundColor, radius: style.borderRadius };
  };
  expect(await github.evaluate(appearance)).toEqual(await google.evaluate(appearance));
  expect((await github.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const googleBox = (await google.boundingBox())!, githubBox = (await github.boundingBox())!;
  expect(githubBox.y - googleBox.y - googleBox.height).toBe(12);
  await google.focus();
  await page.keyboard.press("Tab");
  await expect(github).toBeFocused();
  await page.screenshot({ path: info.outputPath(`sign-in-${info.project.name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("keeps the sign-in and signup dashboard link usable at narrow widths", async ({ page }, info) => {
  await page.route("**/v1/auth/session", route => route.fulfill({ json: { account: null, googleEnabled: true, connectEnabled: true, emailEnabled: true } }));
  for (const width of info.project.name === "mobile" ? [320, 390] : [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["login", "signup"]) {
      await page.goto(`/${path}`);
      const link = page.getByRole("navigation", { name: "Account navigation", exact: true }).getByRole("link", { name: "Your dashboard", exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", "/dashboard");
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

for (const provider of ["Google", "GitHub", "email"] as const) {
  test(`retains the project and payment destination through ${provider} sign-in`, async ({ page }) => {
    const state = await mockWorkspace(page, { signedOut: true });
    await page.route("**/v1/auth/session", route => route.fulfill({ json: { account: state.signedOut ? null : { id: state.accountId, displayName: "Builder", githubLogin: "builder", isOperator: false }, googleEnabled: true, connectEnabled: true, emailEnabled: true } }));
    await page.goto(`/login?project=${state.project.id}&payment=cancelled`);
    if (provider === "email") {
      await page.route("**/v1/auth/login", route => { state.signedOut = false; return route.fulfill({ json: { signedIn: true } }); });
      await page.getByLabel("Email address", { exact: true }).fill("builder@example.invalid");
      await page.getByLabel("Password", { exact: true }).fill("fixture-only-long-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    } else {
      const endpoint = provider === "Google" ? "**/v1/auth/google/connect?flow=login" : "**/v1/github/connect?flow=login";
      await page.route(endpoint, route => { state.signedOut = false; return route.fulfill({ status: 302, headers: { location: "http://127.0.0.1:3130/dashboard?github=connected" } }); });
      await page.getByRole("link", { name: `Continue with ${provider}`, exact: true }).click();
    }
    await expect(page).toHaveURL(`/dashboard?project=${state.project.id}&payment=cancelled`);
    await expect(page.getByRole("heading", { name: state.project.name, exact: true })).toBeVisible();
    expect(state.operatorRequests).toBe(0);
  });
}

test("rejects a stored external sign-in destination and preserves a signed-in project link", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.addInitScript(() => sessionStorage.setItem("m8-customer-signin-return", JSON.stringify({ target: "https://example.invalid/untrusted", expires: Date.now() + 60_000 })));
  await page.goto("/dashboard?github=connected");
  await expect(page.getByRole("heading", { name: "Your apps. Their next chapter." })).toBeVisible();
  await page.goto(`/login?project=${state.project.id}&payment=returned`);
  await expect(page.getByRole("link", { name: "Open your dashboard", exact: true })).toHaveAttribute("href", `/dashboard?project=${state.project.id}&payment=returned`);
});

test("keeps customer navigation consistent with an active page and a separate backoffice", async ({ page }, info) => {
  test.setTimeout(60_000);
  await mockWorkspace(page, { operator: true });
  let displayName = "Builder";
  await page.route("**/v1/auth/session", route => route.fulfill({ json: { account: { id: "customer", githubLogin: "builder", displayName, isOperator: true }, googleEnabled: true, connectEnabled: true, emailEnabled: true } }));
  const widths = info.project.name === "mobile" ? [320, 390] : [768, 1024, 1440];
  for (const name of ["Builder", "AlexandraVeryLongCustomerName".repeat(5)]) {
    displayName = name;
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["dashboard", "billing", "account"] as const) {
        await page.goto(`/${path}`);
        const navigation = page.getByRole("navigation", { name: "Customer navigation", exact: true });
        const label = path[0].toUpperCase() + path.slice(1);
        await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
        expect(await navigation.getByRole("link", { name: label, exact: true }).evaluate(node => getComputedStyle(node).color)).toBe("rgb(150, 230, 217)");
        await expect(page.getByRole("link", { name: "Backoffice", exact: true })).toHaveCount(0);
        await expect(page.locator(".portal-user")).toHaveText(name);
        await page.evaluate(async () => { await document.fonts.ready; });
        const header = page.locator(".portal-header");
        const geometry = await header.evaluate(element => {
          const headerBox = element.getBoundingClientRect();
          const items = [...element.querySelectorAll<HTMLElement>(".wordmark,.customer-navigation > a,.portal-user,.customer-signout")]
            .filter(node => node.getBoundingClientRect().height > 0)
            .map(node => {
              const box = node.getBoundingClientRect(), range = document.createRange();
              range.selectNodeContents(node);
              const text = range.getBoundingClientRect();
              return { label: node.textContent, link: node.matches(".customer-navigation > a"), control: node.matches("a:not(.wordmark),button"), centered: !node.matches(".wordmark"), left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height, textCenter: text.top + text.height / 2, boxCenter: box.top + box.height / 2 };
            });
          return { left: headerBox.left, right: headerBox.right, items };
        });
        for (const item of geometry.items) {
          if (item.centered) expect(Math.abs(item.textCenter - item.boxCenter), `${path} ${width}px ${item.label} text centering`).toBeLessThanOrEqual(1);
          if (item.control) expect(item.height).toBeGreaterThanOrEqual(44);
          expect(item.left).toBeGreaterThanOrEqual(geometry.left);
          expect(item.right).toBeLessThanOrEqual(geometry.right);
        }
        const row = geometry.items.filter(item => width > 760 ? item.centered : item.link);
        expect(Math.max(...row.map(item => item.textCenter)) - Math.min(...row.map(item => item.textCenter)), `${path} ${width}px row text alignment`).toBeLessThanOrEqual(1);
        for (let first = 0; first < geometry.items.length; first++) {
          for (let second = first + 1; second < geometry.items.length; second++) {
            const a = geometry.items[first], b = geometry.items[second];
            expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${path} ${width}px header items must not collide`).toBe(true);
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (info.project.name === "mobile") {
          expect(await navigation.evaluate(node => getComputedStyle(node).display)).toBe("grid");
        }
        if (width === widths.at(-1)) {
          if (name === "Builder") {
            await navigation.getByRole("link", { name: "Dashboard", exact: true }).focus();
            for (const next of ["Billing", "Account"]) {
              await page.keyboard.press("Tab");
              await expect(navigation.getByRole("link", { name: next, exact: true })).toBeFocused();
            }
            await page.keyboard.press("Tab");
            await expect(header.getByRole("button", { name: "Sign out", exact: true })).toBeFocused();
            await page.locator("h1").first().click();
          }
          await header.screenshot({ path: info.outputPath(`header-${path}-${name === "Builder" ? "normal" : "long"}.png`) });
        }
      }
    }
  }
});

for (const entry of ["account before first project", "saved project"] as const) {
  test(`keeps GitHub disconnect under connection settings for ${entry}`, async ({ page }) => {
    const state = await mockWorkspace(page, { empty: entry === "account before first project" });
    if (entry === "account before first project") state.connection!.connectionError = "Previous repository permissions need checking.";
    let disconnects = 0;
    await page.route("**/v1/github/disconnect", route => {
      disconnects++;
      state.connection!.githubLogin = null;
      state.connection!.repositories = [];
      state.connection!.connectionError = null;
      return route.fulfill({ json: { disconnected: true } });
    });
    await page.goto(entry === "saved project" ? `/dashboard?project=${state.project.id}` : "/account");
    await expect(page.locator(".portal-header").getByRole("button", { name: "Disconnect GitHub", exact: true })).toHaveCount(0);
    await page.getByText("GitHub connection settings", { exact: true }).click();
    await expect(page.getByText(/Disconnect.*in this browser|Disconnecting.*in this browser/)).toBeVisible();
    await page.getByRole("button", { name: "Disconnect GitHub", exact: true }).click();
    await expect(page.getByText(/GitHub.*access disconnected/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect GitHub", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Account", exact: true })).toBeVisible();
    expect(state.signedOut).toBe(false);
    expect(disconnects).toBe(1);
    if (entry === "account before first project") {
      await expect(page.getByText("Previous repository permissions need checking.", { exact: true })).toHaveCount(0);
      state.connection!.githubLogin = "builder";
      await page.getByRole("button", { name: "Refresh repository status", exact: true }).click();
      await expect(page.getByText(/GitHub.*access disconnected/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Disconnect GitHub", exact: true })).toBeVisible();
    }
    if (entry === "saved project") await expect(page.getByRole("heading", { name: state.project.name, exact: true })).toBeVisible();
  });
}

for (const kind of ["request", "conversation", "delivery", "note"] as const) {
  test(`protects ${kind} fields during a slow acknowledged save`, async ({ page }) => {
    const operator = kind === "delivery" || kind === "note";
    const state = await mockWorkspace(page, { operator });
    if (operator) state.project.stage = "BUILDING";
    const suffix = { request: "requests", conversation: "messages", delivery: "work", note: "notes" }[kind];
    let release: (() => void) | undefined, submitted = false;
    await page.route(`**/v1/${operator ? "operator/" : ""}projects/*/${suffix}`, async route => {
      if (route.request().method() === "POST") {
        submitted = true;
        await new Promise<void>(resolve => { release = resolve; });
      }
      await route.fallback();
    });
    await page.goto(`${operator ? "http://127.0.0.1:3131/" : "/dashboard"}?project=${state.project.id}`);
    const field = page.getByLabel({ request: "Title", conversation: "Message to the team", delivery: "Delivery item title", note: "Private note" }[kind], { exact: true });
    if (kind === "delivery") await page.getByText("Add a delivery item", { exact: true }).click();
    await field.fill("Keep this submitted text");
    if (kind === "request") await page.getByLabel("Details", { exact: true }).fill("Keep the complete details while the save is pending.");
    if (kind === "delivery") await page.getByLabel("Outcome / acceptance check", { exact: true }).fill("Verify the agreed workflow with its expected result.");
    await page.getByRole("button", { name: { request: "Add request", conversation: "Send message", delivery: "Add delivery item", note: "Save private note" }[kind], exact: true }).click();
    await expect.poll(() => submitted).toBe(true);
    await expect(field).toBeDisabled();
    if (!operator) {
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Signing out…", exact: true })).toHaveCount(0);
    }
    if (kind === "request") await expect(page.getByLabel("Request type", { exact: true })).toBeDisabled();
    await expect(field).toHaveValue("Keep this submitted text");
    release!();
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue("");
    await field.fill("This next edit remains available after the save.");
    await expect(field).toHaveValue("This next edit remains available after the save.");
  });
}
