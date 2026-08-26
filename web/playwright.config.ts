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
  // Parallel across files, and deliberately not via `retries`. On one worker a
  // single browser process served all 253 tests in sequence, and Firefox's
  // software compositor died partway through — "RenderCompositorSWGL failed
  // mapping default framebuffer" — taking three unrelated tests with it. The
  // whole firefox project passes 51/51 when run on its own, so the failure was
  // the harness exhausting itself, not the pages. Spreading the run over
  // several workers keeps any one browser process short-lived. Retries stay at
  // zero: a flake that gets retried away is a flake nobody reads.
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: externalTarget ?? "http://127.0.0.1:3210",
    trace: "retain-on-failure",
  },
  // Both browsers here used to be Chromium — "desktop" and "Pixel 7" share an
  // engine, so the suite had never once run the streaming reader, the SSE
  // parser or the CSS on Gecko or WebKit. Those are exactly the layers where
  // engines differ.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
  webServer: externalTarget
    ? undefined
    : {
        // node on next's own entry point, not `pnpm exec next`. Each shim in
        // between is another process for Windows to lose track of, and it did:
        // Playwright's managed server died partway through a 355-test run and
        // every test after it failed with ERR_CONNECTION_REFUSED — 330 of
        // them. The identical suite against a server started by hand, which
        // reuseExistingServer picks up, passed 353/353 with the same
        // application code. The application was never the problem; the
        // process tree was.
        command: "node node_modules/next/dist/bin/next start -p 3210",
        url: "http://127.0.0.1:3210",
        reuseExistingServer: true,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 120_000,
      },
});
