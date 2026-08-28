import { test, expect, type Page } from "@playwright/test";

/**
 * The path a deployed engine takes: browser -> /api/run -> engine SSE -> anvil.
 *
 * Every other spec in this suite runs the replay path, because that is what
 * the public site serves. Nothing had ever driven a real engine through the
 * web proxy from a browser — the proxy's timeout, its 503-to-error-frame
 * translation and the progress counter existed only as unit tests of their
 * halves. This is the whole thing, end to end, and it needs:
 *
 *   SIDIK_LIVE_E2E=1  SIDIK_E2E_URL=<a web server started with ENGINE_URL set>
 *
 * The engine seeds its cache from the recorded catalogue, so an address in it
 * would be replayed in milliseconds and prove nothing. PRIME is not in the
 * catalogue and has 8.5 WETH on a Uniswap V3 pool at the pinned block, so it
 * is executed for real: a fresh fork, every probe, one anvil.
 */
const LIVE = process.env.SIDIK_LIVE_E2E === "1";
const PRIME = "0xfA980cEd6895AC314E7dE34Ef1bFAE90a5AdD21b";
// A live run forks Base and runs six probes on it; a minute is normal.
const LIVE_RUN_TIMEOUT_MS = 240_000;

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test.describe("a real engine, through the proxy, from a browser", () => {
  test.skip(!LIVE, "set SIDIK_LIVE_E2E=1 with a web server whose ENGINE_URL points at a running engine");
  test.describe.configure({ mode: "serial" });

  test("executes an uncatalogued token live and streams it as it happens", async ({ page }) => {
    test.setTimeout(LIVE_RUN_TIMEOUT_MS + 30_000);
    const errors = watchConsole(page);
    await page.goto(`/run?token=${PRIME}`);

    // Not a replay. The banner is emitted only when the recorded catalogue
    // answered, and this address is not in it.
    await expect(page.getByText(/PRESCAN/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Recorded run/)).toHaveCount(0);

    // Progress is visible as a count, and the count moves: the page must show
    // at least one verdict before it shows DONE, or the stream is being
    // buffered somewhere between anvil and the browser.
    const status = page.locator("span", { hasText: /SCANNING \d+\/\d+/ }).first();
    await expect(status).toBeVisible({ timeout: 60_000 });
    const firstVerdict = page.locator("h3").first();
    await expect(firstVerdict).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("DONE run complete")).toHaveCount(0);

    await expect(page.getByText("DONE run complete")).toBeVisible({ timeout: LIVE_RUN_TIMEOUT_MS });

    // Every verdict names a probe and every hash is a real 32-byte hash.
    const cards = page.locator("h3");
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    const hashes = await page.locator("span[title^='0x']").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
    expect(hashes.length).toBeGreaterThan(0);
    for (const h of hashes) expect(h).toMatch(/^0x[0-9a-f]{64}$/i);

    // The narration arrived and was labelled as a model's.
    await expect(page.getByText(/written by a model, from the verdicts above/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the same address again is answered from the engine's cache, instantly", async ({ page }) => {
    await page.goto(`/run?token=${PRIME}`);
    // Sub-second, because the live run above populated the cache. The
    // generous bound is for the browser, not the engine.
    await expect(page.getByText("DONE run complete")).toBeVisible({ timeout: 15_000 });
  });

  // The engine caps runs in flight and answers 503 with JSON beyond it. That
  // JSON reaches the browser under an event-stream content type unless the
  // proxy translates it, and an untranslated one hung the page forever. Three
  // runs of three different uncatalogued addresses, at once, against a cap
  // of two: the third must be told the engine is busy, as an SSE error frame.
  test("a busy engine is reported as busy, not as a hang", async ({ request }) => {
    test.setTimeout(LIVE_RUN_TIMEOUT_MS);
    const fresh = [
      "0x2416092f143378750bb29b79eD961ab195CcEea5", // ezETH — 1.9 WETH on V3
      "0xA88594D404727625A9437C3f886C7643872296AE", // WELL — small V3 pool
      "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85", // SEAM — no pool; prescan alone still takes a fork
    ];
    const bodies = await Promise.all(fresh.map((t) =>
      request.get(`/api/run?token=${t}`, { timeout: LIVE_RUN_TIMEOUT_MS }).then((r) => r.text())));
    const busy = bodies.filter((b) => /event: error/.test(b) && /busy|in flight|temporary/i.test(b));
    expect(busy.length, "one of three concurrent runs should have been refused as busy").toBeGreaterThanOrEqual(1);
    // And the refusal is a well-formed frame, not a JSON body under the wrong content type.
    for (const b of busy) expect(b).toMatch(/event: error\ndata: \{/);
  });
});
