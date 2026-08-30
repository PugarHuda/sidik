import { test, expect } from "@playwright/test";
import { clickFilter } from "./helpers";

/**
 * The corroboration layer, and the claim it exists to support.
 *
 * None of this is evidence — every verdict still comes from a transaction
 * mined on a fork. What it does is answer the obvious objection: "could I not
 * have just read the contract?" Across this catalogue, no: almost every
 * address with a finding against it publishes verified source anyone could
 * have read first.
 *
 * These tests exist because that claim is a number on a page, and a number on
 * a page is exactly the kind of thing that quietly becomes wrong.
 */

// Anastasia — the honeypot whose sell reverts, and whose source is published.
const HONEYPOT = "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb";
// BRETT — trades on both venues Sidik asks, matched two different ways.
const TWO_VENUES = "0x532f27101965dd16442E59d40670FaF5eBB142E4";

test.describe("source verification", () => {
  test("the home page states the gap between verified and safe", async ({ page }) => {
    await page.goto("/");
    // The whole callout, not the emphasised span inside it: the second half of
    // the claim lives in the paragraph around that span, so asserting both on
    // the span could only ever fail.
    const callout = page.locator("div").filter({ hasText: /publish verified source code/i }).last();
    await expect(callout).toBeVisible();
    // Both halves of the claim have to be numbers, not adjectives: the
    // failing share as the figure, the overall share in the sentence.
    await expect(callout).toContainText(/\d+\s*of\s*\d+/);
    await expect(callout).toContainText(/as do \d+ of all \d+/);
  });

  test("the catalogue repeats it next to the counts it qualifies", async ({ page }) => {
    await page.goto("/catalogue");
    await expect(
      page.getByText(/runs with a finding against them publish verified source code/i),
    ).toBeVisible();
  });

  test("a run page says whether that one contract publishes its source", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT}`);
    // The verdict has to land first — this line is a footnote to it, and a
    // footnote that shows up without the finding is the wrong emphasis.
    await expect(page.getByText(/reverted/i).first()).toBeVisible({ timeout: 30_000 });
    const line = page.getByText(/Source code is published and verified on/i);
    await expect(line).toBeVisible();
    await expect(line).toContainText("Anastasia");
    // The link is to the contract tab, because "go and read it" is the point.
    const link = page.getByRole("link", { name: "Blockscout" });
    await expect(link).toHaveAttribute("href", new RegExp(`${HONEYPOT}\\?tab=contract`, "i"));
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("the JSON API carries it, kept apart from the verdicts", async ({ request }) => {
    const res = await request.get(`/api/token/${HONEYPOT}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.corroboration.sourceVerified).toBe(true);
    expect(body.headline).toBe("FAIL");
    // Nothing about corroboration may appear inside a verdict.
    expect(JSON.stringify(body.verdicts)).not.toContain("sourceVerified");
    expect(body.transactionsWereBroadcast).toBe(false);
  });
});

test.describe("independent venues", () => {
  test("a token listed on both names both, and says it is not proof", async ({ page }) => {
    await page.goto(`/run?token=${TWO_VENUES}`);
    const line = page.getByText(/Also trades on/i);
    await expect(line).toBeVisible({ timeout: 30_000 });
    await expect(line).toContainText("BingX");
    await expect(line).toContainText("Gate");
    await expect(line).toContainText(/not part of the proof/i);
  });

  test("the JSON API lists every venue, with which ticker each uses", async ({ request }) => {
    const res = await request.get(`/api/token/${TWO_VENUES}`);
    const body = await res.json();
    const venues = body.corroboration.alsoTradesOn as { venue: string; ticker: string }[];
    expect(venues.map((v) => v.venue).sort()).toEqual(["bingx", "gate"]);
    for (const v of venues) expect(v.ticker).toBe("BRETT");
  });
});

test.describe("who decided what", () => {
  // The narration is the only prose on the page, so it is the paragraph a
  // reader is most likely to mistake for the product. Unlabelled, it invites
  // exactly the assumption this project exists to refute.
  test("the narration says a model wrote it, and what it could not do", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT}`);
    await expect(page.getByText(/written by a model, from the verdicts above/i))
      .toBeVisible({ timeout: 30_000 });
    const guarantee = page.getByText(/decided by code reading what a transaction did/i);
    await expect(guarantee).toBeVisible();
    await expect(guarantee).toContainText(/never\s+by the model/i);
  });
});

test.describe("owner traps", () => {
  // The probe that asks what the owner can still do to you after you have
  // bought. Its filter is only worth having if it actually narrows.
  test("the catalogue can be narrowed to them", async ({ page }) => {
    await page.goto("/catalogue");
    const all = await page.locator("ul li").count();
    await clickFilter(page, "Owner traps");
    await expect(page).toHaveURL(/[?&]filter=ownerTrap/);
    const narrowed = await page.locator("ul li").count();
    expect(narrowed).toBeLessThanOrEqual(all);
  });

  test("counts them alongside the other findings", async ({ page }) => {
    await page.goto("/catalogue");
    // The tile IS the filter now, and it carries its own count.
    const tile = page.locator("[data-filter-tile='ownerTrap']");
    await expect(tile).toBeVisible();
    await expect(tile).toContainText(/Owner traps\s*\d+/);
  });
});

test.describe("read-only scanners beside the executed verdict", () => {
  // GoPlus is the check most wallets embed; honeypot.is simulates on its own.
  // Their readings sit under the verdicts as context, dated, and never as
  // evidence — and on Anastasia GoPlus disagrees with what the fork did.
  test("a run page shows what the scanners said, dated, and names a disagreement", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT}`);
    await expect(page.getByText(/reverted/i).first()).toBeVisible({ timeout: 30_000 });
    const block = page.getByText(/What read-only scanners say/i);
    await expect(block).toBeVisible();
    // The date is the honesty: these describe the chain that day, not the block.
    await expect(block).toContainText(/asked \d{4}-\d{2}-\d{2}/i);
    await expect(block).toContainText(/not block 50,200,000/);
    await expect(page.getByText("GoPlus", { exact: true })).toBeVisible();
    await expect(page.getByText("honeypot.is", { exact: true })).toBeVisible();
    await expect(page.getByText(/No scanner flag changes a verdict/i)).toBeVisible();
    // GoPlus reported is_honeypot: 0 for a token whose sell reverts on the fork.
    await expect(page.locator("[data-scanner-disagreement]")).toContainText(/GoPlus says not a honeypot; the fork could not sell/);
  });

  test("the JSON API carries the readings under corroboration, dated, apart from the verdicts", async ({ request }) => {
    const body = await (await request.get(`/api/token/${HONEYPOT}`)).json();
    const s = body.corroboration.scanners;
    expect(s).toBeTruthy();
    expect(s.askedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof s.honeypotIs.isHoneypot).toBe("boolean");
    expect(JSON.stringify(body.verdicts)).not.toContain("goplus");
  });
});

test.describe("browsing where inference and execution part ways", () => {
  test("the catalogue can be narrowed to scanner disagreements, every row badged", async ({ page }) => {
    await page.goto("/catalogue");
    const all = await page.locator("ul li").count();
    await clickFilter(page, "Scanners disagree");
    await expect(page).toHaveURL(/[?&]filter=scannerDisagrees/);
    const shown = await page.locator("ul li").count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(all);
    // Every row, by its data — the badge text is what a person reads, the
    // attribute is what the filter means.
    await expect(page.locator("ul li:not([data-scanner-disagrees])")).toHaveCount(0);
    await expect(page.getByText("scanner disagrees").first()).toBeVisible();
    // The sentence is on the row, not hidden in a title attribute.
    await expect(page.getByText(/says .* the fork (sold|could not sell)/).first()).toBeVisible();
    // Anastasia is in this list: GoPlus cleared a sell that reverts.
    await expect(page.locator("ul li", { hasText: "Anastasia" })).toHaveAttribute("data-scanner-disagrees", "");
  });
});

test.describe("a second verifier, independently", () => {
  test("the JSON carries Sourcify's answer and the deployer beside Blockscout's", async ({ request }) => {
    const { corroboration } = await (await request.get(`/api/token/${HONEYPOT}`)).json();
    // Anastasia is verified on both: Blockscout says yes, Sourcify holds a match.
    expect(corroboration.sourceVerified).toBe(true);
    expect(corroboration.sourcify).toBeTruthy();
    expect(["exact", "partial"]).toContain(corroboration.sourcify.match);
    expect(corroboration.sourcify.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(corroboration.deployer).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(["sourcify", "blockscout"]).toContain(corroboration.deployerSource);
  });

  test("the run page names the second witness and the deployer as facts, outside the verdict", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT}`);
    await expect(page.getByText(/Sourcify holds (an exact|a partial) match, verified \d{4}-\d{2}-\d{2}/)).toBeVisible({ timeout: 30_000 });
    const deployer = page.locator("[data-deployer]");
    await expect(deployer).toBeVisible();
    await expect(deployer).toHaveAttribute("href", /basescan\.org\/address\/0x[0-9a-fA-F]{40}/);
    // Still corroboration: it sits under the context heading, not in the strip.
    const strip = page.locator("[data-overall-verdict]");
    await expect(strip).not.toContainText(/Sourcify|Deployed by/);
  });
});
