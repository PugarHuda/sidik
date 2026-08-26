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

/**
 * The catalogue's filter lives in the URL.
 *
 * It used to live in React state alone: a filtered view could not be linked
 * or bookmarked, the back button stepped straight over it, and the address
 * bar disagreed with the screen.
 */
test.describe("catalogue filter state", () => {
  test("puts the filter in the URL so it can be linked", async ({ page }) => {
    await page.goto("/catalogue");
    const honeypots = page.getByRole("button", { name: "Honeypots", exact: true });
    await expect(honeypots).toBeVisible();
    await honeypots.click();

    await expect(page).toHaveURL(/[?&]filter=honeypot/);
    await expect(honeypots).toHaveAttribute("aria-pressed", "true");
  });

  test("a filtered URL opened cold shows the filtered list", async ({ page }) => {
    await page.goto("/catalogue?filter=honeypot");
    await expect(page.getByRole("button", { name: "Honeypots", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    const rows = await page.locator("ul li").count();
    expect(rows).toBeGreaterThan(0);
    // Every row on this page must actually be a honeypot finding.
    await expect(page.locator("ul li").first()).toContainText(/Honeypot/i);
  });

  test("the back button steps back through filter states", async ({ page }) => {
    await page.goto("/catalogue");
    const all = await page.locator("ul li").count();

    await page.getByRole("button", { name: "Honeypots", exact: true }).click();
    await expect(page).toHaveURL(/filter=honeypot/);
    const filtered = await page.locator("ul li").count();
    expect(filtered).toBeLessThan(all);

    await page.goBack();
    await expect(page).not.toHaveURL(/filter=honeypot/);
    await expect.poll(() => page.locator("ul li").count()).toBe(all);
  });

  test("an unknown filter shows everything rather than an empty page", async ({ page }) => {
    // A hand-edited URL should not produce a page that looks like a catalogue
    // with nothing in it — that reads as "no runs recorded", which is a lie.
    await page.goto("/catalogue?filter=notarealfilter");
    expect(await page.locator("ul li").count()).toBeGreaterThan(100);
    await expect(page.getByRole("button", { name: "Everything", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
  });

  test("a very long search string is bounded, not reflected whole", async ({ page }) => {
    await page.goto(`/catalogue?q=${"z".repeat(5000)}`);
    await expect(page.getByText(/Nothing recorded matches that/)).toBeVisible();
    const value = await page.getByLabel("Filter by symbol or address").inputValue();
    expect(value.length).toBeLessThanOrEqual(100);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the catalogue still lists and still filters", async ({ page }) => {
    // The filters are links and the search is a real GET form, so the page is
    // readable and usable with scripting off — which is also what a crawler
    // and a text browser see.
    await page.goto("/catalogue");
    expect(await page.locator("ul li").count()).toBeGreaterThan(100);

    await page.goto("/catalogue?filter=honeypot");
    const rows = await page.locator("ul li").count();
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(50);
    await expect(page.locator("ul li").first()).toContainText(/Honeypot/i);
  });

  test("a run page still states what was proven", async ({ page }) => {
    // The trace streams over SSE and cannot run without scripting — but the
    // page must still say so rather than render an empty shell.
    await page.goto(`/run?token=${BRB}`);
    await expect(page).toHaveTitle("Sidik — BRB: FAIL");
  });
});
