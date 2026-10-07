import { expect, test } from "@playwright/test";
import { mockWorkspace } from "./fixtures/workspace";
test("reconnect shows the private device link, survives reload and verifies completion", async ({ page }, info) => {
  await mockWorkspace(page, { operator: true });
  const worker = { id: "docker", name: "Tin-Mac Docker", lastSeenAt: new Date().toISOString(), statusAt: new Date().toISOString(), revokedAt: null, remoteLogin: true, providerStatus: [{ provider: "codex", state: "NEEDS_LOGIN" }], loginRequest: null as Record<string, unknown> | null };
  let lost = true; const ids: string[] = [];
  await page.route("**/v1/operator/review-workers", route => route.fulfill({ json: { workers: [worker] } }));
  await page.route("**/v1/operator/review-workers/docker/login", async route => {
    const body = route.request().postDataJSON() as { requestId: string }; ids.push(body.requestId);
    if (lost) { lost = false; await route.abort("connectionreset"); return; }
    worker.loginRequest = { id: body.requestId, status: "PREPARING", expiresAt: new Date(Date.now() + 600_000).toISOString() };
    await route.fulfill({ json: { login: worker.loginRequest } });
  });
  await page.goto("http://127.0.0.1:3131/"); await page.getByText("Worker setup", { exact: true }).click();
  await page.getByRole("button", { name: "Reconnect Codex", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry reconnect request" })).toBeVisible();
  await page.getByRole("button", { name: "Retry reconnect request" }).click();
  expect(ids[0]).toBe(ids[1]);
  await expect(page.getByText("The worker is preparing the sign-in link…")).toBeVisible();
  worker.loginRequest = { ...worker.loginRequest, status: "WAITING", url: "https://auth.openai.com/codex/device", code: "ABCD-EF123" };
  const link = page.getByRole("link", { name: "Open Codex sign-in" });
  await expect(link).toBeVisible(); await expect(link).toHaveAttribute("href", "https://auth.openai.com/codex/device"); await expect(link).toHaveAttribute("target", "_blank");
  await page.reload(); await page.getByText("Worker setup", { exact: true }).click();
  await expect(page.getByText("ABCD-EF123", { exact: true })).toBeVisible();
  await link.hover();
  expect(await link.evaluate(el => getComputedStyle(el).color)).toBe("rgb(23, 37, 46)");
  await page.locator(".worker-list").screenshot({ path: info.outputPath(`device-login-${info.project.name}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  worker.loginRequest = { id: ids[1], status: "SUCCEEDED", expiresAt: new Date(Date.now() + 600_000).toISOString() };
  worker.providerStatus = [{ provider: "codex", state: "READY" }];
  await expect(page.getByText("Codex sign-in completed. Subscription verified.")).toBeVisible();
  await expect(link).toHaveCount(0); await expect(page.getByText("ABCD-EF123", { exact: true })).toHaveCount(0);
});
test("cancel and expiry hide codes and offline or old workers cannot reconnect", async ({ page }) => {
  await mockWorkspace(page, { operator: true });
  const worker = { id: "docker", name: "Tin-Mac Docker", lastSeenAt: new Date().toISOString(), statusAt: new Date().toISOString(), revokedAt: null, remoteLogin: true, providerStatus: [{ provider: "codex", state: "NEEDS_LOGIN" }], loginRequest: { id: "request", status: "WAITING", expiresAt: new Date(Date.now() + 600_000).toISOString(), url: "https://auth.openai.com/codex/device", code: "ABCD-EF123" } as Record<string, unknown> | null };
  await page.route("**/v1/operator/review-workers", route => route.fulfill({ json: { workers: [worker] } }));
  await page.route("**/v1/operator/review-workers/docker/login/cancel", async route => { worker.loginRequest = { id: "request", status: "CANCELLED", expiresAt: new Date(Date.now() + 600_000).toISOString() }; await route.fulfill({ json: { saved: true } }); });
  await page.goto("http://127.0.0.1:3131/"); await page.getByText("Worker setup", { exact: true }).click();
  await page.getByRole("button", { name: "Cancel reconnect" }).click();
  await expect(page.getByText("Reconnect cancelled.")).toBeVisible(); await expect(page.getByText("ABCD-EF123", { exact: true })).toHaveCount(0);
  worker.loginRequest = { id: "request", status: "WAITING", expiresAt: new Date(Date.now() - 1000).toISOString(), url: "https://auth.openai.com/codex/device", code: "ABCD-EF123" };
  await page.reload(); await page.getByText("Worker setup", { exact: true }).click();
  await expect(page.getByText("Sign-in expired. Request a fresh link below.")).toBeVisible(); await expect(page.getByRole("link", { name: "Open Codex sign-in" })).toHaveCount(0);
  worker.lastSeenAt = new Date(Date.now() - 90_000).toISOString(); worker.loginRequest = null;
  await page.reload(); await page.getByText("Worker setup", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Reconnect Codex", exact: true })).toBeDisabled();
  worker.lastSeenAt = new Date().toISOString(); worker.remoteLogin = false;
  await page.reload(); await page.getByText("Worker setup", { exact: true }).click();
  await expect(page.getByText("Update and start the Docker worker to enable browser reconnect.")).toBeVisible(); await expect(page.getByRole("button", { name: "Reconnect Codex", exact: true })).toBeDisabled();
});
test("session expiry hides the code and sign-in restores the same durable request", async ({ page }) => {
  await mockWorkspace(page, { operator: true });
  const worker = { id: "docker", name: "Tin-Mac Docker", lastSeenAt: new Date().toISOString(), statusAt: new Date().toISOString(), revokedAt: null, remoteLogin: true, providerStatus: [{ provider: "codex", state: "NEEDS_LOGIN" }], loginRequest: { id: "same-request", status: "WAITING", expiresAt: new Date(Date.now()+600_000).toISOString(), url: "https://auth.openai.com/codex/device", code: "ABCD-EF123" } };
  let expired = false;
  await page.route("**/v1/operator/review-workers", route => expired ? route.fulfill({ status: 401, json: { error: { message: "Sign in again." } } }) : route.fulfill({ json: { workers: [worker] } }));
  await page.route("**/v1/github/connect?flow=admin", async route => { expired = false; await route.fulfill({ status: 302, headers: { location: "http://127.0.0.1:3131/" } }); });
  await page.goto("http://127.0.0.1:3131/"); await page.getByText("Worker setup", { exact: true }).click();
  await expect(page.getByText("ABCD-EF123", { exact: true })).toBeVisible(); expired = true;
  const signIn = page.getByRole("link", { name: "Sign in to backoffice" });
  await expect(signIn).toBeVisible(); await expect(page.getByText("ABCD-EF123", { exact: true })).toHaveCount(0); await expect(page.getByText("Reconnect cancelled.")).toHaveCount(0);
  await signIn.click(); await page.getByText("Worker setup", { exact: true }).click(); await expect(page.getByText("ABCD-EF123", { exact: true })).toBeVisible();
  expect(worker.loginRequest.id).toBe("same-request");
  // A completed event must not hide a newer request created in another tab.
  worker.loginRequest = { ...worker.loginRequest, status: "SUCCEEDED", url: "", code: "" };
  await expect(page.getByText("Codex sign-in completed. Subscription verified.")).toBeVisible();
  worker.loginRequest = { ...worker.loginRequest, id: "new-request", status: "WAITING", expiresAt: new Date(Date.now()+660_000).toISOString(), url: "https://auth.openai.com/codex/device", code: "WXYZ-12345" };
  await page.getByRole("button", { name: "Refresh worker status" }).click();
  await expect(page.getByText("WXYZ-12345", { exact: true })).toBeVisible(); await expect(page.getByText("Codex sign-in completed. Subscription verified.")).toHaveCount(0);
});
test("idle reconnect becomes unavailable when the worker heartbeat ages offline", async ({ page }) => {
  await page.clock.install(); await mockWorkspace(page, { operator: true });
  const worker = { id: "docker", name: "Tin-Mac Docker", lastSeenAt: new Date().toISOString(), statusAt: new Date().toISOString(), revokedAt: null, remoteLogin: true, providerStatus: [{ provider: "codex", state: "NEEDS_LOGIN" }] };
  await page.route("**/v1/operator/review-workers", route => route.fulfill({ json: { workers: [worker] } }));
  await page.goto("http://127.0.0.1:3131/"); await page.getByText("Worker setup", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Reconnect Codex", exact: true })).toBeEnabled();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "Reconnect Codex", exact: true })).toBeDisabled(); await expect(page.getByText("Start the worker on its host before reconnecting here.")).toBeVisible();
});
