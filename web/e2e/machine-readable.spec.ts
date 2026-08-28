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

test.describe("what an integrator's code needs, not just a person's browser", () => {
  // llms.txt pointed agents at the JSON while robots.txt forbade it; the
  // agent tools that honour robots refused the data they were sent to.
  test("robots allows the JSON routes and forbids only the stream and the card", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).toMatch(/Disallow: \/api\/run/);
    expect(body).toMatch(/Disallow: \/api\/og/);
    expect(body).not.toMatch(/Disallow: \/api\/?\s*$/m);
    expect(body).not.toMatch(/Disallow: \/api\/token/);
  });

  test("the JSON routes and the schema are readable from another origin", async ({ request }) => {
    for (const path of [`/api/token/${HONEYPOT}`, "/api/catalogue", "/openapi.json"]) {
      const res = await request.get(path);
      expect(res.headers()["access-control-allow-origin"], path).toBe("*");
    }
  });

  test("every JSON body says which shape and which chain it is", async ({ request }) => {
    const run = await (await request.get(`/api/token/${HONEYPOT}`)).json();
    const cat = await (await request.get("/api/catalogue")).json();
    const missing = await request.get("/api/token/0x1111111111111111111111111111111111111111");
    expect(missing.status()).toBe(404);
    for (const body of [run, cat, await missing.json()]) {
      expect(body.schemaVersion).toBe(1);
      expect(body.chainId).toBe(8453);
    }
    // One spelling of an address, so a consumer echoing it builds the same URL.
    expect(run.address).toBe(HONEYPOT.toLowerCase());
    expect(run.recorded).toBe(true);
  });

  test("provenance names the recording commit and a digest a checkout can recompute", async ({ request }) => {
    const { provenance } = await (await request.get(`/api/token/${HONEYPOT}`)).json();
    expect(provenance.forkBlock).toBe(50_200_000);
    expect(provenance.recordedThrough).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(provenance.recordedByCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.catalogueSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.probes).toContain("honeypot");
    // Same digest from the catalogue route: one catalogue, one hash.
    const cat = await (await request.get("/api/catalogue")).json();
    expect(cat.provenance.catalogueSha256).toBe(provenance.catalogueSha256);
  });

  test("openapi.json declares every key a real response carries", async ({ request }) => {
    const doc = await (await request.get("/openapi.json")).json();
    expect(doc.openapi).toMatch(/^3\.1/);
    const run = await (await request.get(`/api/token/${HONEYPOT}`)).json();
    const declared = doc.components.schemas.TokenRun.properties;
    for (const key of Object.keys(run)) expect(declared, `undeclared key: ${key}`).toHaveProperty(key);
    const verdict = doc.components.schemas.Verdict.properties;
    for (const key of Object.keys(run.verdicts[0])) expect(verdict, `undeclared verdict key: ${key}`).toHaveProperty(key);
    const corr = doc.components.schemas.Corroboration.properties;
    for (const key of Object.keys(run.corroboration)) expect(corr, `undeclared corroboration key: ${key}`).toHaveProperty(key);
  });

  test("the generic card and llms.txt agree on how many addresses there are", async ({ request }) => {
    const llms = await (await request.get("/llms.txt")).text();
    const count = Number(llms.match(/Recorded addresses: (\d+)/)![1]);
    const cat = await (await request.get("/api/catalogue")).json();
    expect(cat.total).toBe(count);
    // The card is a PNG, so the number cannot be read back from it — but the
    // route must render (a wrong template throws, not lies).
    const og = await request.get("/api/og");
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/png");
  });

  test("the catalogue page describes itself as a dataset", async ({ page }) => {
    await page.goto("/catalogue");
    const ld = await page.locator('script[type="application/ld+json"]').textContent();
    const parsed = JSON.parse(ld!);
    expect(parsed["@type"]).toBe("Dataset");
    expect(parsed.distribution.map((d: { contentUrl: string }) => d.contentUrl)).toContain("/api/catalogue");
  });

  test("a run page has one canonical URL, lower-cased", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT}`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/run\\?token=${HONEYPOT.toLowerCase()}$`));
  });

  test("a disputed verdict carries its head-of-day recheck as data and on the page", async ({ page, request }) => {
    const { corroboration } = await (await request.get(`/api/token/${HONEYPOT}`)).json();
    expect(corroboration.recheck).toBeTruthy();
    expect(corroboration.recheck.headBlock).toMatch(/^\d+$/);
    expect(corroboration.recheck.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(["PASS", "FAIL", "NA"]).toContain(corroboration.recheck.status);
    await page.goto(`/run?token=${HONEYPOT}`);
    await expect(page.locator("[data-recheck]")).toContainText(/Re-executed at head block [\d,]+ on \d{4}-\d{2}-\d{2}/, { timeout: 30_000 });
  });
});
