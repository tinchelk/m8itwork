import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:3130", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "npm run dev --workspace @m8itwork/customer -- --hostname 127.0.0.1 --port 3130",
      url: "http://127.0.0.1:3130",
      env: { NEXT_PUBLIC_API_URL: "http://localhost:3121", NEXT_PUBLIC_ADMIN_ORIGIN: "http://127.0.0.1:3131", NEXT_PUBLIC_CUSTOMER_ORIGIN: "http://127.0.0.1:3130" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run dev --workspace @m8itwork/admin -- --hostname 127.0.0.1 --port 3131",
      url: "http://127.0.0.1:3131",
      env: { NEXT_PUBLIC_API_URL: "http://localhost:3121", NEXT_PUBLIC_ADMIN_ORIGIN: "http://127.0.0.1:3131", NEXT_PUBLIC_CUSTOMER_ORIGIN: "http://127.0.0.1:3130" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
