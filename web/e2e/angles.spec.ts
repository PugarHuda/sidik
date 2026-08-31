import { expect, test, type Page } from "@playwright/test";

/**
 * Angles the rest of the suite does not take.
 *
 * Everything else here asserts that Sidik reports what it proved. These
 * assert the things a judge meets before they read a single verdict: how
 * fast it paints, whether it survives being opened five times at once,
 * whether a link it prints actually resolves, and whether the numbers on
 * one surface match the numbers on another.
 *
 * The verdict-framing tests exist because the re-record turned USDC, cbBTC,
 * cbETH and USDbC into FAILs. That is factually what the fork proved — a
 * proxy admin can replace the code — but "USDC: FAIL" is also the single
 * most misreadable string this project renders, and nothing asserted that
 * the page explains itself.
 */

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEGEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const HONEYPOT = "0x48F617e5b1B214a90800348D7944bBc0E9290Fbb";

/** Wait for a run page to settle on its verdict rather than its spinner. */
async function verdictOf(page: Page): Promise<string> {
  const strip = page.locator("[data-overall-verdict]");
  await expect(strip).toBeVisible({ timeout: 45_000 });
  return (await strip.textContent()) ?? "";
}

test.describe("a verdict a judge could misread", () => {
  test("USDC's failure names the mechanism on the page, not just the word FAIL", async ({ page }) => {
    await page.goto(`/run?token=${USDC}`);
    await verdictOf(page);
    const body = (await page.locator("body").textContent()) ?? "";
    // The finding is real; the page has to say what it actually was.
    expect(body).toMatch(/proxy admin/i);
    expect(body).toMatch(/replaced the token's code|upgrade/i);
  });

  test("the page distinguishes what an owner CAN do from what they have done", async ({ page }) => {
    await page.goto(`/run?token=${USDC}`);
    await verdictOf(page);
    const body = (await page.locator("body").textContent()) ?? "";
    // Somewhere on a page that prints "USDC FAIL" there must be language
    // separating capability from intent, or the claim reads as an accusation.
    expect(body).toMatch(/can still|could|nothing about that says|is not a prediction|whether they will|the owner's to decide/i);
  });

  test("an owner-switch failure is marked as a capability, not an event", async ({ page }) => {
    await page.goto(`/run?token=${USDC}&instant=1`);
    await verdictOf(page);
    const note = page.locator("[data-capability-note]");
    await expect(note).toBeVisible();
    await expect(note).toContainText(/can/i);
    await expect(note).toContainText(/not that it has|not that it will/i);
    await expect(note).toContainText(/Nothing here happened on Base/i);
  });

  test("a token that fails for a reason other than its owner gets no such note", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT}&instant=1`);
    await verdictOf(page);
    // Anastasia's sell genuinely reverts today; nothing about it is contingent
    // on somebody choosing to act, so the capability note would be a lie.
    await expect(page.locator("[data-capability-note]")).toHaveCount(0);
  });

  test("the shared card for a blue chip does not unfurl as a bare accusation", async ({ request }) => {
    const res = await request.get(`/api/og?token=${USDC}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image");
  });
});

test.describe("what a judge's connection actually sees", () => {
  test("a cold run page paints its verdict inside a budget", async ({ page }) => {
    const started = Date.now();
    await page.goto(`/run?token=${DEGEN}`);
    await verdictOf(page);
    const elapsed = Date.now() - started;
    console.log(`[angles] verdict painted in ${elapsed}ms`);
    expect(elapsed).toBeLessThan(30_000);
  });

  test("the replay can be skipped, and skipping it changes only the pacing", async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`/run?token=${DEGEN}&instant=1`);
    await verdictOf(page);
    const instantMs = Date.now() - t0;
    const instantText = await page.locator("[data-overall-verdict]").textContent();
    console.log(`[angles] instant verdict in ${instantMs}ms`);

    const t1 = Date.now();
    await page.goto(`/run?token=${DEGEN}`);
    await verdictOf(page);
    const pacedMs = Date.now() - t1;
    const pacedText = await page.locator("[data-overall-verdict]").textContent();
    console.log(`[angles] paced verdict in ${pacedMs}ms`);

    expect(instantMs).toBeLessThan(pacedMs);
    // Presentation only: the verdict itself must be identical.
    expect(instantText).toBe(pacedText);
  });

  test("the paced run offers the skip as a link a reader can actually click", async ({ page }) => {
    await page.goto(`/run?token=${DEGEN}`);
    const skip = page.locator("[data-skip-replay]");
    await expect(skip).toBeVisible({ timeout: 15_000 });
    await skip.click();
    await expect(page).toHaveURL(/instant=1/);
    await verdictOf(page);
    // Skipping must replace the trace, not append a second copy of it.
    // RunView never clears its own events — it relies on being remounted —
    // so this fails loudly if the page stops keying on `instant`.
    await expect(page.locator("[data-overall-verdict]")).toHaveCount(1);
    const probes = page.locator("[data-probe]");
    const seen = await probes.evaluateAll((els) => els.map((e) => e.getAttribute("data-probe")));
    expect(new Set(seen).size, `duplicated probes: ${seen.join(",")}`).toBe(seen.length);
  });

  test("a run page does not ship an unreasonable payload", async ({ page }) => {
    let bytes = 0;
    page.on("response", (r) => {
      const len = Number(r.headers()["content-length"] ?? 0);
      if (Number.isFinite(len)) bytes += len;
    });
    await page.goto(`/run?token=${DEGEN}`);
    await verdictOf(page);
    console.log(`[angles] run page transferred ~${Math.round(bytes / 1024)}KB`);
    // The catalogue is 194 recorded runs; none of it should reach the browser.
    expect(bytes).toBeLessThan(3_000_000);
  });

  test("five judges opening it at once all get their verdict", async ({ browser }) => {
    const ctxs = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()));
    try {
      const results = await Promise.all(
        ctxs.map(async (ctx) => {
          const p = await ctx.newPage();
          await p.goto(`/run?token=${HONEYPOT}`);
          return verdictOf(p);
        }),
      );
      for (const r of results) expect(r).toMatch(/FAIL/i);
    } finally {
      await Promise.all(ctxs.map((c) => c.close()));
    }
  });
});

test.describe("the page in conditions nobody demos in", () => {
  test("stays legible in a dark colour scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/run?token=${HONEYPOT}`);
    await verdictOf(page);
    const strip = page.locator("[data-overall-verdict]");
    const painted = await strip.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, bg: s.backgroundColor };
    });
    console.log(`[angles] dark scheme strip: ${JSON.stringify(painted)}`);
    // Transparent-on-transparent means the strip borrowed nothing and the
    // reader gets whatever the browser felt like.
    expect(painted.color).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("prints the verdict rather than a blank sheet", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT}`);
    await verdictOf(page);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("[data-overall-verdict]")).toBeVisible();
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).toMatch(/TRANSFER_FROM_FAILED|revert/i);
  });
});

test.describe("input nobody should be able to reflect", () => {
  const payloads = [
    `0x"><script>window.__x=1</script>`,
    `0x' onload='window.__x=1`,
    `javascript:alert(1)`,
  ];
  for (const p of payloads) {
    test(`refuses ${p.slice(0, 24)} without executing or echoing it raw`, async ({ page }) => {
      await page.goto(`/run?token=${encodeURIComponent(p)}`);
      const injected = await page.evaluate(() => (window as unknown as { __x?: number }).__x);
      expect(injected).toBeUndefined();
      const html = await page.content();
      expect(html).not.toContain("<script>window.__x=1</script>");
    });
  }
});

test.describe("links the page prints have to resolve", () => {
  test("every external link on a run page answers", async ({ page, request }) => {
    await page.goto(`/run?token=${HONEYPOT}`);
    await verdictOf(page);
    const hrefs = await page.locator('a[href^="http"]').evaluateAll((els) =>
      [...new Set(els.map((e) => (e as HTMLAnchorElement).href))],
    );
    expect(hrefs.length).toBeGreaterThan(0);
    const broken: string[] = [];
    for (const href of hrefs) {
      try {
        const res = await request.get(href, { maxRedirects: 5, timeout: 25_000 });
        if (res.status() >= 400) broken.push(`${res.status()} ${href}`);
      } catch (e) {
        broken.push(`threw ${href} ${String(e).slice(0, 60)}`);
      }
    }
    console.log(`[angles] checked ${hrefs.length} external links`);
    expect(broken, `broken links: ${broken.join(", ")}`).toEqual([]);
  });
});

test.describe("numbers have to agree across surfaces", () => {
  test("the catalogue page, its API and llms.txt report the same total", async ({ page, request }) => {
    const api = await (await request.get("/api/catalogue")).json();
    const llms = await (await request.get("/llms.txt")).text();
    await page.goto("/catalogue");
    const body = (await page.locator("body").textContent()) ?? "";

    const total: number = api.total ?? api.pageCount ?? 0;
    console.log(`[angles] api total=${total}`);
    expect(total).toBeGreaterThan(0);
    expect(llms).toContain(String(total));
    expect(body).toContain(String(total));
  });

  test("the landing page's owner-trap figure equals what the catalogue filter returns", async ({ page, request }) => {
    await page.goto("/");
    const stat = page.locator("[data-owner-trap-stat]");
    await expect(stat).toBeVisible();
    const text = (await stat.textContent()) ?? "";
    const m = text.match(/(\d+)\s*of\s*(\d+)/);
    expect(m, `no "N of M" in: ${text.slice(0, 120)}`).toBeTruthy();
    const [, clean, traps] = m!.map(Number) as [number, number, number];

    const api = await (await request.get("/api/catalogue?filter=ownerTrap")).json();
    console.log(`[angles] landing says ${clean} of ${traps}; ownerTrap filter returns ${api.total}`);
    // The headline denominator is the whole owner-trap set, which is exactly
    // what the filter selects. A hand-written number is how the submission
    // copy drifted for three commits; this one is counted, and this asserts it.
    expect(traps).toBe(api.total);
    expect(clean).toBeGreaterThan(0);
    expect(clean).toBeLessThanOrEqual(traps);
  });

  test("the failing count on the catalogue matches the rows the filter yields", async ({ request }) => {
    const all = await (await request.get("/api/catalogue")).json();
    const failing = await (await request.get("/api/catalogue?filter=failing")).json();
    console.log(`[angles] all=${all.total} failing=${failing.total}`);
    expect(failing.total).toBeLessThanOrEqual(all.total);
    expect(failing.total).toBeGreaterThan(0);
  });
});

test.describe("an N/A headline says what actually happened", () => {
  // WELL passes honeypot, hiddenFee and ownerTrap, and lands on N/A only
  // because no V3 position turned up in the search window. A bare "N/A"
  // reads as a broken run; it has to name the score and the gap.
  const WELL = "0xA88594D404727625A9437C3f886C7643872296AE";

  test("names how many probes passed and which one could not answer", async ({ page }) => {
    await page.goto(`/run?token=${WELL}&instant=1`);
    const strip = page.locator("[data-overall-verdict]");
    await expect(strip).toBeVisible({ timeout: 45_000 });
    await expect(strip).toHaveAttribute("data-overall-verdict", "NA");
    await expect(strip).toContainText(/\d+ of \d+ probes passed/);
    await expect(strip).toContainText(/could not be answered/);
  });

  test("still refuses to call an unanswered probe clean", async ({ page }) => {
    await page.goto(`/run?token=${WELL}&instant=1`);
    const strip = page.locator("[data-overall-verdict]");
    await expect(strip).toBeVisible({ timeout: 45_000 });
    await expect(strip).toContainText(/unanswered is not the same as clean/);
    // The headline must not have been upgraded to PASS by the friendlier copy.
    await expect(strip).not.toHaveAttribute("data-overall-verdict", "PASS");
  });
});

test.describe("the findings page states results, not claims", () => {
  test("every figure on it agrees with the API it was counted from", async ({ page, request }) => {
    await page.goto("/findings");
    const body = (await page.locator("body").textContent()) ?? "";

    const all = await (await request.get("/api/catalogue")).json();
    const traps = await (await request.get("/api/catalogue?filter=ownerTrap")).json();
    const failing = await (await request.get("/api/catalogue?filter=failing")).json();
    console.log(`[angles] findings page vs api: total=${all.total} traps=${traps.total} failing=${failing.total}`);

    // The headline counts have to be the catalogue's own, not a copy that can
    // drift — the submission copy drifted exactly this way for three commits.
    expect(body).toContain(String(all.total));
    expect(body).toContain(String(traps.total));
    expect(body).toContain(String(failing.total));
  });

  test("it publishes the comparison it loses as well as the one it wins", async ({ page }) => {
    await page.goto("/findings");
    const body = (await page.locator("body").textContent()) ?? "";
    // Where inference beats execution, the page has to say so out loud.
    expect(body).toMatch(/where inference is good, it is very good|matched the executed figure on all/i);
    expect(body).toMatch(/both directions are\s+published|the scanner flagged/i);
  });

  test("it never links a fork transaction anywhere a reader could check it", async ({ page }) => {
    await page.goto("/findings");
    const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    // The whole project's central refusal: no explorer will resolve a hash
    // that was never broadcast, so nothing may point one there.
    for (const h of hrefs) expect(h).not.toMatch(/basescan\.org\/tx|etherscan\.io\/tx/);
  });

  test("its share card leads with the finding, not the tagline", async ({ page, request }) => {
    const res = await request.get("/api/og?card=findings");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image");
    // And the page actually points at that card rather than the generic one.
    await page.goto("/findings");
    const og = page.locator('meta[property="og:image"]');
    await expect(og).toHaveAttribute("content", /card=findings/);
  });

  test("the landing page routes a reader to it", async ({ page }) => {
    await page.goto("/");
    const link = page.locator('a[href="/findings"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/findings/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("what an agent is told to connect to", () => {
  test("llms.txt does not hand a machine an unresolved placeholder host", async ({ request }) => {
    const llms = await (await request.get("/llms.txt")).text();
    if (!/mcp/i.test(llms)) test.skip(true, "no MCP advertised here");
    // A placeholder host is unusable: a consumer reading "<engine>" literally
    // has nowhere to connect and no way to know that. "localhost" is not a
    // placeholder — it is the true answer, as long as the text also says the
    // reader has to start that engine themselves.
    const placeholders = llms.match(/<engine>|<host>|<your-[a-z-]+>|example\.com|TODO|TBD/gi) ?? [];
    console.log(`[angles] llms.txt placeholders: ${JSON.stringify(placeholders)}`);
    expect(placeholders, "llms.txt must not hand a machine a host it cannot resolve").toEqual([]);
    if (/localhost/i.test(llms)) {
      expect(llms, "if it points at localhost it has to say no public engine exists").toMatch(/no public engine|run the engine yourself|pnpm dev:engine/i);
    }
  });
});

test.describe("a deep link the way somebody actually pastes it", () => {
  test("an all-uppercase address still finds the run", async ({ page }) => {
    await page.goto(`/run?token=${HONEYPOT.toUpperCase().replace("0X", "0x")}`);
    const v = await verdictOf(page);
    expect(v).toMatch(/FAIL/i);
  });
});
