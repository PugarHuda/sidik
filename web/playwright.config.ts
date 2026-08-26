import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against a real build, not the dev server.
 *
 * The offline replay path is the only path the deployed site has, and it is
 * production code: dev-mode React double-renders and swallows some hydration
 * differences, so a suite that only ever sees `next dev` cannot vouch for what
 * a judge will load.
 *
 * SIDIK_E2E_URL points the suite at an already-running deployment instead —
 * useful for checking that what actually shipped behaves like the build here.
 */
const externalTarget = process.env.SIDIK_E2E_URL;

export default defineConfig({
  testDir: "./e2e",
  // The streamed run takes a couple of seconds by design: the replay paces its
  // events so the trace reads as a sequence rather than appearing at once.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: externalTarget ?? "http://127.0.0.1:3210",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: externalTarget
    ? undefined
    : {
        command: "pnpm exec next start -p 3210",
        url: "http://127.0.0.1:3210",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
