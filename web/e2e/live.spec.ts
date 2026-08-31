import { test, expect } from "@playwright/test";

/**
 * The one surface here that is not frozen.
 *
 * These run against a build with no archive RPC configured, which is what CI
 * has, so they assert the contract and the refusals rather than a verdict:
 * that the route exists, that it answers as a stream, that bad input and a
 * missing RPC both come back as error *events* rather than as a broken page,
 * and that the offer to execute is made exactly where a replay has nothing.
 *
 * A real execution is covered by the engine's own integration suite, which
 * has an RPC.
 */
const UNRECORDED = "0x1111111111111111111111111111111111111111";
const RECORDED = "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb"; // Anastasia
const WETH = "0x4200000000000000000000000000000000000006";

test.describe("the live route", () => {
  test("answers as an event stream, never as a JSON error body", async ({ request }) => {
    test.skip(Boolean(process.env.BASE_ARCHIVE_RPC), "this build can fork; see the note above");
    const res = await request.get(`/api/live?token=${UNRECORDED}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");
  });

  // Malformed input used to be the easiest way to break a page that is
  // reading a stream: hand it JSON it cannot parse and it shows nothing.
  test("reports a malformed address inside the stream", async ({ request }) => {
    const body = await (await request.get("/api/live?token=not-an-address")).text();
    expect(body).toContain("event: error");
    expect(body).toMatch(/is not a Base address/);
  });

  // The distinction the whole project turns on, applied to its own plumbing:
  // an unconfigured deployment is a fact about the deployment.
  test("says a missing archive RPC is about this deployment, not the token", async ({ request }) => {
    // Guarded before the request, not after: against a build that CAN fork,
    // asking this route starts a real thirty-second run, and a test suite
    // that quietly spends an archive RPC's quota is its own kind of bug.
    test.skip(Boolean(process.env.BASE_ARCHIVE_RPC), "this build can fork, so the refusal path is unreachable");
    const body = await (await request.get(`/api/live?token=${UNRECORDED}`)).text();
    expect(body).toContain("no archive RPC configured");
    expect(body).toMatch(/Nothing here is a finding about this token/i);
  });
});

test.describe("where the offer to execute appears", () => {
  test("an address with no recorded run is offered a live one", async ({ page }) => {
    await page.goto(`/run?token=${UNRECORDED}`);
    const cta = page.locator("[data-live-cta]");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", new RegExp(`token=${UNRECORDED}&live=1`, "i"));
  });

  // WETH is what the probes trade *with*, so no run for it can ever exist.
  // Offering to execute one would promise something impossible — the same
  // "not yet" versus "not ever" distinction the 404 copy already makes.
  test("an address that cannot be probed at all is not offered one", async ({ page }) => {
    await page.goto(`/run?token=${WETH}`);
    await expect(page.locator("[data-error-plain]")).toContainText(/cannot trade this address/i);
    await expect(page.locator("[data-live-cta]")).toHaveCount(0);
  });

  test("a recorded run is not interrupted with the offer", async ({ page }) => {
    await page.goto(`/run?token=${RECORDED}&instant=1`);
    await expect(page.locator("[data-live-cta]")).toHaveCount(0);
  });

  // A reader must never have to infer from the URL whether what they are
  // looking at was executed just now or replayed from the catalogue.
  test("a live run says it is live, and a replay says it is recorded", async ({ page }) => {
    await page.goto(`/run?token=${RECORDED}&instant=1`);
    await expect(page.getByText(/Recorded run/)).toBeVisible();
    await expect(page.locator("[data-live-banner]")).toHaveCount(0);

    await page.goto(`/run?token=${UNRECORDED}&live=1`);
    await expect(page.locator("[data-live-banner]")).toContainText(/not a replay/i);
  });
});
