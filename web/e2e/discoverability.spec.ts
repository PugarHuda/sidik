import { test, expect } from "@playwright/test";

/**
 * The parts that decide whether a run can be found or shared.
 *
 * Every run page used to carry the site's own title, so a link to a proven
 * honeypot and a link to a clean token looked identical in a tab strip, a
 * bookmark bar or a chat preview — on the one product whose job is telling
 * those apart.
 */

// FAIL, on Uniswap V2, taxed on both sides.
const BRB = "0x0e86eFe5Ba52336c2173AD69EE726e054619e0d8";
// PASS: trades on V3, so LP-rug reports inapplicable rather than dragging it down.
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";
const NOT_RECORDED = "0x1111111111111111111111111111111111111111";

test.describe("a shared run link says what it found", () => {
  test("names the token and the verdict in the title", async ({ page }) => {
    await page.goto(`/run?token=${BRB}`);
    await expect(page).toHaveTitle("Sidik — BRB: FAIL");
  });

  test("does not label a passing token as a failure", async ({ page }) => {
    await page.goto(`/run?token=${BRETT}`);
    await expect(page).toHaveTitle("Sidik — BRETT: PASS");
  });

  test("claims no verdict for an address with no recorded run", async ({ page }) => {
    await page.goto(`/run?token=${NOT_RECORDED}`);
    // Not "PASS", not "FAIL", not the token's name — there is no run to describe.
    await expect(page).toHaveTitle("Sidik — run");
  });

  test("states the block the description refers to", async ({ page }) => {
    await page.goto(`/run?token=${BRB}`);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toContain("50,200,000");
    expect(description).toContain("BRB");
  });
});

test.describe("indexing", () => {
  test("lists every recorded run in the sitemap", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();

    expect(xml).toContain("/catalogue");
    expect(xml).toContain(BRB.toLowerCase());
    // One entry per recorded run, plus the home page and the catalogue. A
    // hardcoded count would start lying the next time the catalogue is
    // re-recorded, so this checks the shape rather than the number.
    const urls = xml.match(/<loc>/g)?.length ?? 0;
    expect(urls).toBeGreaterThan(190);
  });

  test("keeps crawlers off the streaming endpoints", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const txt = await res.text();
    // /api/run holds a connection open for seconds by design; a crawler
    // following it learns nothing a page does not already show.
    expect(txt).toContain("Disallow: /api/");
    expect(txt).toMatch(/Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/);
  });
});
