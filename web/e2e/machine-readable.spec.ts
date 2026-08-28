import { test, expect } from "@playwright/test";

/**
 * The surfaces something other than a browser consumes.
 *
 * The catalogue is structured data that happened to be rendered as a page, so
 * the only way to use it was to scrape HTML. These are the endpoints that fix
 * that, plus the card a shared link unfurls into — which is the only thing
 * most people will ever see of a verdict.
 *
 * What they mostly guard is the two sentences a consumer will otherwise get
 * wrong: the transactions were never broadcast, and an unrecorded address is
 * not a clean bill of health.
 */

const HONEYPOT = "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb";

test.describe("catalogue as JSON", () => {
  test("returns the same catalogue the page renders", async ({ request }) => {
    const res = await request.get("/api/catalogue");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.forkBlock).toBe(50200000);
    expect(body.transactionsWereBroadcast).toBe(false);
    expect(body.total).toBeGreaterThan(100);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.length).toBeLessThanOrEqual(50);
    // Failures first, same rule as the page.
    expect(body.rows[0].headline).toBe("FAIL");
    for (const row of body.rows) {
      expect(row.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(["PASS", "FAIL", "NA"]).toContain(row.headline);
      expect(row.run).toBe(`/api/token/${row.address}`);
      // Corroboration travels in its own field and never inside a probe result.
      expect(row).toHaveProperty("corroboration");
      expect(JSON.stringify(row.probes)).not.toContain("sourceVerified");
    }
  });

  test("filters, and says which filters exist", async ({ request }) => {
    const all = await (await request.get("/api/catalogue")).json();
    const res = await request.get("/api/catalogue?filter=honeypot");
    const body = await res.json();
    expect(body.filter).toBe("honeypot");
    expect(body.total).toBeLessThan(all.total);
    expect(body.total).toBeGreaterThan(0);
    for (const row of body.rows) {
      expect(row.probes.some((p: { id: string; status: string }) =>
        p.id === "honeypot" && p.status === "FAIL")).toBe(true);
    }
    expect(body.availableFilters.map((f: { id: string }) => f.id)).toContain("ownerTrap");
  });

  // A hand-edited filter should not produce an empty result that reads as
  // "the catalogue is empty" — same rule the HTML page follows.
  test("an unknown filter falls back to everything rather than nothing", async ({ request }) => {
    const body = await (await request.get("/api/catalogue?filter=notarealfilter")).json();
    expect(body.filter).toBe("all");
    expect(body.rows.length).toBeGreaterThan(0);
  });

  test("clamps an out-of-range page instead of returning a blank one", async ({ request }) => {
    const body = await (await request.get("/api/catalogue?page=9999")).json();
    expect(body.page).toBe(body.pageCount);
    expect(body.rows.length).toBeGreaterThan(0);
  });
});

test.describe("llms.txt", () => {
  test("states the two things a consumer would otherwise get wrong", async ({ request }) => {
    const res = await request.get("/llms.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("NEVER broadcast");
    expect(body).toMatch(/404[\s\S]{0,120}never probed/);
    expect(body).toContain("/api/catalogue");
    expect(body).toContain("/api/token/");
    expect(body).toContain("ownerTrap");
  });
});

test.describe("the card a shared link unfurls into", () => {
  test("renders a PNG carrying that token's verdict", async ({ request }) => {
    const res = await request.get(`/api/og?token=${HONEYPOT}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const body = await res.body();
    expect(body.length).toBeGreaterThan(5_000);
    // PNG magic number, so a 200 carrying an error page cannot pass.
    expect(body.subarray(0, 4).toString("hex")).toBe("89504e47");
  });

  // The symbol on that card is text the token's author chose. An address that
  // is not a recorded run must fall through to the generic card rather than
  // rendering whatever was in the query string.
  test("falls back to the generic card for anything unrecorded", async ({ request }) => {
    const junk = await request.get("/api/og?token=%3Cscript%3Ealert(1)%3C/script%3E");
    expect(junk.status()).toBe(200);
    expect(junk.headers()["content-type"]).toContain("image/png");
    const generic = await request.get("/api/og");
    expect((await junk.body()).length).toBe((await generic.body()).length);
  });

  test("the run page points at it, sized, so it unfurls large", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT}`);
    const image = page.locator('meta[property="og:image"]');
    await expect(image).toHaveAttribute("content", new RegExp(`/api/og\\?token=${HONEYPOT}`, "i"));
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    // The title has to carry the verdict, or two shared links look identical.
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /FAIL/);
  });
});

test.describe("reproducibility is stated where the claim is made", () => {
  test("the run page prints the command that re-runs it", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT}`);
    const line = page.getByText(/re-run this address yourself/i);
    await expect(line).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`pnpm --filter @sidik/engine reproduce ${HONEYPOT}`)).toBeVisible();
  });

  test("the catalogue links its own JSON, carrying the current filter", async ({ page }) => {
    await page.goto("/catalogue?filter=honeypot");
    const link = page.getByRole("link", { name: /this view as JSON/i });
    await expect(link).toHaveAttribute("href", /\/api\/catalogue\?filter=honeypot/);
  });
});

test.describe("scanner disagreement as data", () => {
  test("the catalogue API can be narrowed to rows a scanner disputes, and says who", async ({ request }) => {
    const body = await (await request.get("/api/catalogue?filter=scannerDisagrees")).json();
    expect(body.filter).toBe("scannerDisagrees");
    expect(body.total).toBeGreaterThan(0);
    expect(body.summary.scannersDisagree).toBe(body.total);
    for (const row of body.rows) {
      expect(typeof row.scannerDisagrees).toBe("string");
      expect(row.scannerDisagrees).toMatch(/GoPlus|honeypot\.is/);
    }
  });
});
