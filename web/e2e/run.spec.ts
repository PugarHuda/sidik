import { test, expect, type Page } from "@playwright/test";

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

    await page.getByLabel("Token address").fill("0x123");
    await expect(button).toBeDisabled();

    await page.getByLabel("Token address").fill(BRB);
    await expect(button).toBeEnabled();
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
    const toggle = page.getByRole("button", { name: /show raw verdict data/ }).first();
    await toggle.click();
    await expect(page.getByText(/"probe": "honeypot"/)).toBeVisible();
  });

  test("reports a tax on both sides of the pool, not just the buy", async ({ page }) => {
    await runToCompletion(page, BRB);
    await expect(page.getByRole("heading", { name: /Hidden fees/ })).toBeVisible();
    await expect(page.getByText(/on buy/)).toBeVisible();
    await expect(page.getByText(/on sell/)).toBeVisible();
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
    const badge = page.locator("text=SIDIK · VERDICT").locator("xpath=following-sibling::*[1]");
    await expect(badge).toHaveText("PASS");
  });

  test("corroborates against BingX without presenting it as proof", async ({ page }) => {
    await runToCompletion(page, BRETT);
    await expect(page.getByText(/Also trades on BingX as BRETT/)).toBeVisible();
    await expect(page.getByText(/not part of the proof/)).toBeVisible();
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

  test("does not ship the recorded runs to the browser", async ({ page }) => {
    // 172 frozen runs live in the same package as EXAMPLES. If tree-shaking
    // ever stops dropping them, every visitor downloads the whole catalogue.
    const scripts: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/_next/static/") && r.url().endsWith(".js")) {
        scripts.push(await r.text().catch(() => ""));
      }
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const shipped = scripts.join("");
    expect(shipped).not.toContain("boughtAmount");
    expect(shipped).not.toContain("TRANSFER_FROM_FAILED");
  });
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

    await page.getByRole("button", { name: "Honeypots" }).click();
    const after = await page.locator("ul li").count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    await expect(page.locator("ul li").first()).toContainText(/Honeypot/i);
  });

  test("searching by symbol narrows the list", async ({ page }) => {
    await page.goto("/catalogue");
    await page.getByLabel("Filter by symbol or address").fill("BRETT");
    // Deliberately not an exact count: two recorded Base tokens call
    // themselves BRETT, which is the point of the collision warning.
    const rows = page.locator("ul li");
    await expect(rows.first()).toContainText("BRETT");
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });

  test("flags a symbol that more than one recorded token claims", async ({ page }) => {
    await page.goto("/catalogue");
    await page.getByLabel("Filter by symbol or address").fill("BRIAN");
    // Five separate contracts on Base call themselves BRIAN.
    await expect(page.locator("ul li").first()).toContainText(/sharing this symbol/);
  });

  test("a row opens that token's run", async ({ page }) => {
    await page.goto("/catalogue");
    await page.getByLabel("Filter by symbol or address").fill("0x532f");
    await page.locator("ul li a").first().click();
    await expect(page).toHaveURL(/token=0x532f/i);
    await expect(page.getByText("DONE run complete")).toBeVisible();
  });

  test("does not ship the recorded runs to the browser either", async ({ page }) => {
    const scripts: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/_next/static/") && r.url().endsWith(".js")) {
        scripts.push(await r.text().catch(() => ""));
      }
    });
    await page.goto("/catalogue");
    await page.waitForLoadState("networkidle");
    // Rows carry a one-line finding; the full verdicts, rows and tx hashes
    // must stay on the server.
    expect(scripts.join("")).not.toContain("TRANSFER_FROM_FAILED");
  });
});

test.describe("token API", () => {
  test("returns a recorded run as JSON, with the block it describes", async ({ request }) => {
    const res = await request.get(`/api/token/${BRB}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BRB");
    expect(body.forkBlock).toBe("50200000");
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
