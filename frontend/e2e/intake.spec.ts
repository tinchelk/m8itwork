import { expect, test } from "@playwright/test";

test("the website leads to the repository and request dashboard flow", async ({ page }) => {
  await page.goto("/#review");
  await expect(page.getByRole("heading", { name: /Your repository.*What you want next/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Let’s get started" })).toHaveAttribute("href", "/dashboard?start=1");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("Send a demo brief.")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
