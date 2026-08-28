import { test, expect, type Page } from "@playwright/test";
import { clickFilter, fillWhenReady, SEARCH_SETTLE_MS } from "./helpers";

// A honeypot: the buy lands, the sell reverts.
const ANASTASIA = "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb";
// Taxed both ways, and its LP is burned — the one example where every probe
// returns a definite verdict.
const BRB = "0x0e86eFe5Ba52336c2173AD69EE726e054619e0d8";
// Trades on Uniswap V3, so LP-rug cannot apply, and it is listed on BingX.
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";
// Well-formed, and deliberately not in the catalogue.
const UNCOVERED = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";

/** Console errors are a failure everywhere in this suite, not a footnote. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function runToCompletion(page: Page, token: string) {
  await page.goto(`/run?token=${token}`);
  await expect(page.getByText("DONE run complete")).toBeVisible();
}

test.describe("landing", () => {
  test("offers the examples and states what is actually covered", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("by doing it in a fork");
    // The count is read from the recorded runs, so it must be a real number
    // rather than the placeholder text a broken import would leave.
    await expect(page.getByText(/\d+ Base addresses/)).toBeVisible();
    for (const name of ["USDC (Base)", "Anastasia (honeypot)", "BRB (3% buy tax)", "Wallet with a live approval"]) {
      // Exact string, not a RegExp: the labels contain parentheses, which a
      // pattern would read as a capture group and quietly match the wrong text.
      await expect(page.getByRole("button", { name, exact: false })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("keeps the run button disabled until the address is well formed", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: /Run trace/ });
    await expect(button).toBeDisabled();

    // The disabled state is also what the server renders, so it proves
    // nothing about hydration on its own — the enabling fill is the one that
    // has to wait for React to be listening.
    await fillWhenReady(page, page.getByLabel("Token address"), BRB,
      () => expect(button).toBeEnabled({ timeout: 1_000 }));

    await page.getByLabel("Token address").fill("0x123");
    await expect(button).toBeDisabled();
  });

  test("an example button navigates into its run", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Anastasia/ }).click();
    await expect(page).toHaveURL(new RegExp(ANASTASIA, "i"));
    await expect(page.getByText("DONE run complete")).toBeVisible();
  });
});

test.describe("a run that finds something", () => {
  test("streams the trace and fails the honeypot with its revert reason", async ({ page }) => {
    const errors = watchConsole(page);
    await runToCompletion(page, ANASTASIA);

    await expect(page.getByText(/PRESCAN\s+symbol=Anastasia/)).toBeVisible();
    await expect(page.getByText("VERDICT honeypot → FAIL")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Honeypot — you can buy but cannot sell/ })).toBeVisible();
    // The revert string is the evidence; a verdict without it is an assertion.
    // Appears twice by design: on the verdict card and again in the narration.
    await expect(page.getByText(/TRANSFER_FROM_FAILED/).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("labels the left column as an assumption, never as the token's claim", async ({ page }) => {
    await runToCompletion(page, ANASTASIA);
    await expect(page.getByText("What a buyer assumes").first()).toBeVisible();
    await expect(page.getByText("Proven in fork").first()).toBeVisible();
    await expect(page.getByText("Claimed / expected")).toHaveCount(0);
  });

  test("shows fork tx hashes as plain text, since no explorer can resolve them", async ({ page }) => {
    await runToCompletion(page, ANASTASIA);
    await expect(page.getByText(/never broadcast, so not on any explorer/).first()).toBeVisible();
    // A link to basescan.org/tx would lead to a page that cannot exist.
    expect(await page.locator('a[href*="basescan.org/tx"]').count()).toBe(0);
    // The token itself is real, so that link stays.
    await expect(page.locator('a[href*="basescan.org/address"]').first()).toBeVisible();
  });

  test("expands the raw verdict data behind a verdict", async ({ page }) => {
    await runToCompletion(page, ANASTASIA);
    const toggle = page.getByRole("button", { name: /show raw verdict data/i }).first();
    await toggle.click();
    await expect(page.getByText(/"probe": "honeypot"/)).toBeVisible();
  });

  test("reports a tax on both sides of the pool, not just the buy", async ({ page }) => {
    await runToCompletion(page, BRB);
    await expect(page.getByRole("heading", { name: /Hidden fees/ })).toBeVisible();
    // The finding is now quoted twice on purpose: once in the verdict strip
    // at the top, once on its card.
    await expect(page.getByText(/on buy/).first()).toBeVisible();
    await expect(page.getByText(/on sell/).first()).toBeVisible();
  });
});

test.describe("a probe that cannot apply", () => {
  test("says why LP-rug does not apply on V3 instead of dropping the card", async ({ page }) => {
    await runToCompletion(page, BRETT);
    await expect(page.getByRole("heading", { name: /LP rug does not apply/ })).toBeVisible();
    await expect(page.getByText(/NFT positions/).first()).toBeVisible();
  });

  test("does not let an inapplicable probe drag the headline down", async ({ page }) => {
    await runToCompletion(page, BRETT);
    // Three probes pass and only the inapplicable one is NA, so the summary
    // must not read as though nothing could be determined.
    await expect(page.locator("[data-overall-verdict]")).toHaveAttribute("data-overall-verdict", "PASS");
  });

  test("corroborates against BingX without presenting it as proof", async ({ page }) => {
    await runToCompletion(page, BRETT);
    await expect(page.getByText(/Also trades on BingX as BRETT/)).toBeVisible();
    await expect(page.getByText(/not part of the proof/).first()).toBeVisible();
  });
});

test.describe("failure paths", () => {
  test("an uncovered address gets an error, not an invented verdict", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`/run?token=${UNCOVERED}`);

    await expect(page.getByText("Run failed")).toBeVisible();
    await expect(page.getByText(/cannot be probed live/).first()).toBeVisible();
    await expect(page.getByText(/\d+ Base addresses have a recorded run/).first()).toBeVisible();
    // The banner announces "real fork proof". There is no proof on this page.
    await expect(page.getByText(/Recorded run — real fork proof/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a malformed address is named as malformed", async ({ page }) => {
    await page.goto("/run?token=notanaddress");
    await expect(page.getByText(/is not a Base address/)).toBeVisible();
  });

  test("a missing token parameter does not crash the page", async ({ page }) => {
    const errors = watchConsole(page);
    const res = await page.goto("/run");
    expect(res?.status()).toBe(200);
    expect(errors).toEqual([]);
  });

  test("the API refuses a malformed address over SSE rather than with JSON", async ({ request }) => {
    // The client is reading an event stream; handing it JSON it cannot parse
    // breaks the page instead of explaining anything.
    const res = await request.get("/api/run?token=notanaddress");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");
    expect(await res.text()).toContain('"type":"error"');
  });

  test("the API rejects a request with no token at all", async ({ request }) => {
    const res = await request.get("/api/run");
    expect(res.status()).toBe(400);
  });
});

test.describe("hardening", () => {
  test("serves the baseline security headers", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  // 194 frozen runs live in the same module as the helpers the pages import.
  // If tree-shaking ever stops dropping them, every visitor downloads the
  // whole catalogue. "/" was the only page checked here for a while, which was
  // the one page that imports nothing from that module — the two that do are
  // /run (impostorsOf, listedTicker, headlineOf) and /catalogue.
  for (const path of ["/", "/catalogue", "/run?token=0x0e86eFe5Ba52336c2173AD69EE726e054619e0d8"]) {
    test(`does not ship the recorded runs to the browser on ${path}`, async ({ page }) => {
      const scripts: string[] = [];
      page.on("response", async (r) => {
        if (r.url().includes("/_next/static/") && r.url().endsWith(".js")) {
          scripts.push(await r.text().catch(() => ""));
        }
      });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const shipped = scripts.join("");
      expect(shipped).not.toContain("boughtAmount");
      expect(shipped).not.toContain("TRANSFER_FROM_FAILED");
      // The catalogue's rows are derived on the server; the runs they are
      // derived from must not come along. This title is in 182 of the 194
      // recorded runs, so it cannot be absent by luck.
      expect(shipped).not.toContain("Not a honeypot — buy and sell both succeed");
      // Same rule for the verification map. It is one record per recorded
      // address, and the pages that use it show exactly one — /run gets its
      // answer as a prop from the server for this reason.
      expect(shipped).not.toContain("VERIFIED_SOURCE");
      expect(shipped).not.toContain("+commit.");
    });
  }
});

test.describe("catalogue", () => {
  test("lists every recorded run, failures first", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/catalogue");

    await expect(page.getByRole("heading", { name: /Every recorded run/ })).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ recorded runs/)).toBeVisible();
    // A catalogue of proofs is worth browsing for what it caught, so the first
    // row must not be a clean one.
    const firstBadge = page.locator("ul li").first().locator("span").first();
    await expect(firstBadge).toHaveText("FAIL");
    expect(errors).toEqual([]);
  });

  test("filters down to a single class of finding", async ({ page }) => {
    await page.goto("/catalogue");
    const before = await page.locator("ul li").count();

    await clickFilter(page, "Honeypots");
    const after = await page.locator("ul li").count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    // Every row, and by what it is rather than by what its title says: the
    // title is a sentence the probe rewrites as it learns to say more.
    await expect(page.locator("ul li:not([data-failing~='honeypot'])")).toHaveCount(0);
  });

  test("searching by symbol narrows the list", async ({ page }) => {
    await page.goto("/catalogue");
    const rows = page.locator("ul li");
    // Deliberately not an exact count: two recorded Base tokens call
    // themselves BRETT, which is the point of the collision warning.
    await fillWhenReady(page, page.getByLabel("Filter by symbol or address"), "BRETT",
      () => expect(rows.first()).toContainText("BRETT", { timeout: SEARCH_SETTLE_MS }));
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });

  test("flags a symbol that more than one recorded token claims", async ({ page }) => {
    await page.goto("/catalogue");
    // Five separate contracts on Base call themselves BRIAN.
    await fillWhenReady(page, page.getByLabel("Filter by symbol or address"), "BRIAN",
      () => expect(page.locator("ul li").first()).toContainText(/other tokens use this symbol/, { timeout: SEARCH_SETTLE_MS }));
  });

  test("a row opens that token's run", async ({ page }) => {
    await page.goto("/catalogue");
    await fillWhenReady(page, page.getByLabel("Filter by symbol or address"), "0x532f",
      () => expect(page.locator("ul li")).toHaveCount(1, { timeout: SEARCH_SETTLE_MS }));
    await page.locator("ul li a").first().click();
    await expect(page).toHaveURL(/token=0x532f/i);
    await expect(page.getByText("DONE run complete")).toBeVisible();
  });

  // The leak check for this page lives with the other two under "hardening",
  // which now covers every page that imports from the runs' module.
});

test.describe("token API", () => {
  test("returns a recorded run as JSON, with the block it describes", async ({ request }) => {
    const res = await request.get(`/api/token/${BRB}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BRB");
    // A number, not the string the runs are stored as. Left as text, a
    // consumer comparing block numbers compares text instead — and
    // "9000000" > "50200000" is true.
    expect(body.forkBlock).toBe(50200000);
    expect(typeof body.forkBlock).toBe("number");
    expect(body.headline).toBe("FAIL");
    expect(Array.isArray(body.verdicts)).toBe(true);
    // Anyone consuming this must not link the hashes to an explorer.
    expect(body.transactionsWereBroadcast).toBe(false);
  });

  test("404s an address with no recorded run rather than returning a clean bill", async ({ request }) => {
    const res = await request.get(`/api/token/${UNCOVERED}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/No recorded run/);
    expect(body.recordedAddresses).toBeGreaterThan(0);
  });

  test("400s a malformed address", async ({ request }) => {
    const res = await request.get("/api/token/notanaddress");
    expect(res.status()).toBe(400);
  });
});

test.describe("what the critique found and no assertion had", () => {
  // The fingerprint watermark's mask sat on the container holding the whole
  // landing page. At phone width the last three example buttons rendered at
  // 0% and the address input at ~30% — and every visibility test passed,
  // because a masked-to-nothing element is still "visible" to the DOM.
  test("the landing page's controls are actually painted at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const last = page.getByRole("button", { name: /DEGEN/ });
    await last.scrollIntoViewIfNeeded();
    // Sample the button's own pixels: a masked element is transparent, and a
    // transparent pixel over the page background is the page background.
    const painted = await last.evaluate(async (el) => {
      const r = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      // The mask, if any, would be on an ancestor; check none applies.
      let node: Element | null = el;
      while (node) {
        const m = getComputedStyle(node);
        const mask = m.maskImage || (m as unknown as { webkitMaskImage?: string }).webkitMaskImage || "none";
        if (mask !== "none") return { masked: true, w: r.width, h: r.height, border: css.borderColor };
        node = node.parentElement;
      }
      return { masked: false, w: r.width, h: r.height, border: css.borderColor };
    });
    expect(painted.masked, "an ancestor still masks the controls").toBe(false);
    expect(painted.w).toBeGreaterThan(100);
  });

  // The narration printed a full owner address inline; that one word widened
  // the document to 465px at 390 and shrank every tap target by 16%.
  for (const [name, token] of [["DEGEN", "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"], ["Anastasia", ANASTASIA], ["BRB", BRB]] as const) {
    test(`the run page for ${name} never scrolls sideways on a phone`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await runToCompletion(page, token);
      const widths = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(widths.doc, "document wider than the viewport").toBeLessThanOrEqual(widths.viewport);
    });
  }

  // A case file opens with the finding. The verdict strip sits above the
  // cards, the pill in the header is the verdict word, and on a FAIL run
  // the first card is the failing one.
  test("a finished run leads with its verdict, not with the first probe that ran", async ({ page }) => {
    await runToCompletion(page, "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed");
    await expect(page.getByRole("status")).toHaveText("FAIL");
    const strip = page.locator("[data-overall-verdict]");
    await expect(strip).toHaveAttribute("data-overall-verdict", "FAIL");
    await expect(strip).toContainText(/pulled pause\(\) and the sell stopped working/);
    // DOM order: strip before every card.
    const stripTop = await strip.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const firstCard = page.locator("h3").first();
    const cardTop = await firstCard.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(stripTop).toBeLessThan(cardTop);
    await expect(firstCard).toContainText(/pause\(\)/);
  });

  test("a probe that does not apply is never printed in red", async ({ page }) => {
    await runToCompletion(page, "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed");
    // lpRug does not apply on V3; its "proven" sentence must be neutral.
    const proven = page.locator("[data-probe='lpRug'][data-applicable='false'] dd").last();
    const color = await proven.evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toMatch(/255, 107, 107/); // --fail
  });
});

test.describe("sharing a verdict", () => {
  test("the strip has a share control that yields the canonical link", async ({ page, context, browserName }) => {
    await runToCompletion(page, ANASTASIA);
    const button = page.getByRole("button", { name: /Share this verdict/ });
    await expect(button).toBeVisible();
    // Force the clipboard path: navigator.share opens a sheet no test can
    // read, and the clipboard is the fallback every desktop takes anyway.
    await page.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
    if (browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await button.click();
      await expect(page.getByText("Link copied.")).toBeVisible();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toMatch(new RegExp(`/run\\?token=${ANASTASIA.toLowerCase()}$`));
    } else {
      // Other engines refuse clipboard writes without a user gesture the
      // harness cannot give; the button must still report, never hang.
      await button.click();
      await expect(page.getByText(/Link copied\.|Could not copy/)).toBeVisible();
    }
  });
});
