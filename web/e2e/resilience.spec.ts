import { test, expect } from "@playwright/test";
import { fillWhenReady, filterTile, SEARCH_SETTLE_MS } from "./helpers";

/**
 * What happens when things go wrong or the reader does something impatient.
 *
 * The existing suite covers the intended path and a handful of bad inputs.
 * These are the ones nobody had checked: a stream that dies halfway, a
 * gateway that never answers, the same button hit twice, the back button,
 * a reload mid-run, and arriving straight at a deep link.
 */

const RECORDED = "0x0e86eFe5Ba52336c2173AD69EE726e054619e0d8";
const NOT_RECORDED = "0x1111111111111111111111111111111111111111";

function watchConsole(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test.describe("the form refuses bad input and says why", () => {
  test("an empty box submits nothing and navigates nowhere", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Run trace/ })).toBeDisabled();
    // Enter on an empty form must not leave the page.
    await page.getByLabel("Token address").press("Enter");
    await expect(page).toHaveURL(/\/$/);
  });

  test("explains what is wrong instead of only greying the button out", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("Token address");

    await fillWhenReady(page, input, "hello",
      () => expect(page.getByText("A Base address starts with 0x.")).toBeVisible({ timeout: 1_000 }));
    await expect(input).toHaveAttribute("aria-invalid", "true");

    await input.fill("0xZZZZ");
    await expect(page.getByText(/Only the digits 0-9/)).toBeVisible();

    await input.fill("0xabc");
    await expect(page.getByText(/3 characters after 0x; an address has 40/)).toBeVisible();

    // Recovery: a valid address clears the complaint and enables the button.
    await input.fill(RECORDED);
    await expect(page.getByText(/A Base address starts with/)).toBeHidden();
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: /Run trace/ })).toBeEnabled();
  });
});

test.describe("network failure", () => {
  test("a stream that dies mid-run says so rather than spinning forever", async ({ page }) => {
    const errors = watchConsole(page);
    // Two good frames, then the connection drops with no `done`.
    await page.route("**/api/run**", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          `event: prescan\ndata: {"type":"prescan","scan":{"token":"${RECORDED}","isErc20":true,"symbol":"TEST","decimals":18,"hasPool":true,"topHolders":[]}}\n\n` +
          `event: plan\ndata: {"type":"plan","ids":["honeypot"]}\n\n`,
      }));

    await page.goto(`/run?token=${RECORDED}`);
    await expect(page.getByText(/PLAN\s+probes=\[honeypot\]/)).toBeVisible();
    // The run never completes, and the page must not claim that it did.
    await expect(page.getByText("DONE run complete")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("an unreachable API surfaces as an error on the page, not a silent hang", async ({ page }) => {
    await page.route("**/api/run**", (route) => route.abort("connectionfailed"));
    await page.goto(`/run?token=${RECORDED}`);
    await expect(page.getByText(/ERROR/).first()).toBeVisible({ timeout: 20_000 });
  });

  test("a slow gateway still finishes once it answers", async ({ page }) => {
    await page.route("**/api/run**", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(`/run?token=${RECORDED}`);
    await expect(page.getByText("DONE run complete")).toBeVisible({ timeout: 40_000 });
  });

  test("an address with no recorded run is told so plainly", async ({ page }) => {
    await page.goto(`/run?token=${NOT_RECORDED}`);
    await expect(page.getByText(/No engine is configured/).first()).toBeVisible();
    // Never a verdict, and never a headline, for an address never probed.
    await expect(page.getByText("DONE run complete")).toBeHidden();
  });

  // An error that only says no was the whole of this page. Both ways out of it
  // have to be real, and neither may imply a verdict.
  test("offers real routes out, and still no verdict", async ({ page }) => {
    await page.goto(`/run?token=${NOT_RECORDED}`);
    // A plain sentence first, then the exact one; then recorded runs to open
    // instead of a catalogue search that could only ever return nothing.
    await expect(page.getByText(/Sidik has not traded this token yet/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Browse every recorded run/ })).toHaveAttribute("href", "/catalogue");
    await expect(page.getByRole("link", { name: /Anastasia/ })).toBeVisible();
    // The developer route is real and folded, not gone.
    await page.getByText(/Probe it yourself/i).click();
    await expect(page.getByLabel("Command to probe this address locally")).toBeVisible();
    // Nothing on this page may read as an outcome about the token.
    for (const word of ["PASS", "FAIL"]) {
      await expect(page.getByText(new RegExp(`\\b${word}\\b`))).toHaveCount(0);
    }
  });
});

test.describe("impatient readers", () => {
  test("double-clicking an example starts one run, not two", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/run")) calls.push(r.url()); });

    await page.goto("/");
    const example = page.locator("button").filter({ hasText: /→/ }).nth(1);
    await example.dblclick();

    await expect(page.getByText(/PRESCAN/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("DONE run complete")).toBeVisible({ timeout: 30_000 });
    expect(calls.length, `expected one /api/run call, saw ${calls.length}`).toBe(1);
  });

  test("the back button returns to a working home page", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/");
    const button = page.getByRole("button", { name: /Run trace/ });
    await fillWhenReady(page, page.getByLabel("Token address"), RECORDED,
      () => expect(button).toBeEnabled({ timeout: 1_000 }));
    await button.click();
    await expect(page.getByText("DONE run complete")).toBeVisible({ timeout: 30_000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    // Still interactive, not a stale render of the previous page.
    await fillWhenReady(page, page.getByLabel("Token address"), RECORDED,
      () => expect(page.getByRole("button", { name: /Run trace/ })).toBeEnabled({ timeout: 1_000 }));
    expect(errors).toEqual([]);
  });

  test("reloading mid-run restarts it cleanly instead of duplicating the trace", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`/run?token=${RECORDED}`);
    await expect(page.getByText(/PRESCAN/)).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(page.getByText("DONE run complete")).toBeVisible({ timeout: 30_000 });
    // One run's worth of events, not two concatenated.
    expect(await page.getByText(/^PRESCAN/).count()).toBe(1);
    expect(errors).toEqual([]);
  });

  test("a deep link works without ever visiting the home page", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`/run?token=${RECORDED}`);
    await expect(page.getByText("DONE run complete")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Recorded run — real fork proof from block/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("switching tokens without a reload replaces the trace rather than appending", async ({ page }) => {
    await page.goto(`/run?token=${RECORDED}`);
    await expect(page.getByText("DONE run complete")).toBeVisible({ timeout: 30_000 });

    // The component is keyed by token, so this must remount rather than reuse.
    await page.goto(`/run?token=${NOT_RECORDED}`);
    await expect(page.getByText(/No engine is configured/).first()).toBeVisible();
    await expect(page.getByText("DONE run complete")).toBeHidden();
  });
});

test.describe("catalogue edge cases", () => {
  test("a search matching nothing shows the empty state, not a blank page", async ({ page }) => {
    await page.goto("/catalogue");
    await fillWhenReady(page, page.getByPlaceholder("symbol or address…"), "zzzzzzzznotathing",
      () => expect(page.getByText(/Nothing recorded matches that/)).toBeVisible({ timeout: SEARCH_SETTLE_MS }));
    await expect(page.getByText(/^0 of \d+ recorded runs$/)).toBeVisible();
  });

  test("clearing the search restores every row", async ({ page }) => {
    await page.goto("/catalogue");
    const counter = page.getByText(/of \d+ recorded runs$/);
    const search = page.getByPlaceholder("symbol or address…");
    await expect(counter).toBeVisible();
    const all = await counter.textContent();

    await fillWhenReady(page, search, "zzzz",
      () => expect(page.getByText(/^0 of/)).toBeVisible({ timeout: SEARCH_SETTLE_MS }));

    // Clearing goes through the same guard. It was the one interaction in
    // this file still typing straight at the DOM, and under load on WebKit it
    // was the one that lost the race.
    await fillWhenReady(page, search, "",
      () => expect(counter).toHaveText(all!, { timeout: SEARCH_SETTLE_MS }));
  });

  test("a filter and a search compose instead of overriding each other", async ({ page }) => {
    await page.goto("/catalogue");
    const counter = page.getByText(/of \d+ recorded runs$/);
    const count = async () => Number((await counter.textContent())!.match(/^(\d+)/)![1]);

    const honeypotsButton = filterTile(page, "Honeypots");
    await expect(honeypotsButton).toBeVisible();
    await honeypotsButton.click();
    // aria-pressed flipping is the signal that React handled the click, not
    // just that the DOM received one.
    await expect(honeypotsButton).toHaveAttribute("aria-current", "page");
    const filtered = await count();
    expect(filtered).toBeGreaterThan(0);

    await page.getByPlaceholder("symbol or address…").fill("0x");
    // Every address starts with 0x, so the search cannot widen the filter —
    // if the two did not compose, this would jump back to all 194.
    await expect.poll(count).toBe(filtered);
    await expect(honeypotsButton).toHaveAttribute("aria-current", "page");
  });
});

/**
 * Keys that exist on every JavaScript object.
 *
 * The recorded runs are a plain object, so `FIXTURES["constructor"]` is the
 * Object constructor rather than undefined — and a `if (!run) return` guard
 * sails straight past a function. The run page reads its token from
 * searchParams without a regex check before deriving the page title, so this
 * was reachable: it threw inside generateMetadata and served a 500 instead of
 * the "not a Base address" page that every other malformed input gets.
 */
test.describe("prototype keys are not addresses", () => {
  for (const token of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
    test(`"${token}" is refused like any other malformed address`, async ({ page }) => {
      const res = await page.goto(`/run?token=${encodeURIComponent(token)}`);
      expect(res?.status(), `${token} must not 500`).toBe(200);
      await expect(page.getByText(/is not a Base address/)).toBeVisible();
      // And it must never be described as a run that exists.
      await expect(page).toHaveTitle("Sidik — run");
    });
  }

  test("the JSON API refuses them too", async ({ request }) => {
    for (const token of ["constructor", "__proto__", "toString"]) {
      const res = await request.get(`/api/token/${encodeURIComponent(token)}`);
      expect(res.status(), `${token}`).toBe(400);
    }
  });

  test("the stream refuses them without inventing a verdict", async ({ request }) => {
    const res = await request.get("/api/run?token=constructor");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("is not a Base address");
    expect(body).not.toContain("verdict");
  });
});

test.describe("what a phone actually pastes", () => {
  test("a Basescan URL is taken for the address inside it", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: /Run trace/ });
    await fillWhenReady(page, page.getByLabel("Token address"), `https://basescan.org/token/${RECORDED}#code`,
      () => expect(button).toBeEnabled({ timeout: 1_000 }));
    await button.click();
    await expect(page).toHaveURL(new RegExp(`/run\\?token=${RECORDED}$`));
  });

  test("a link with no address in it says so, not 'starts with 0x'", async ({ page }) => {
    await page.goto("/");
    await fillWhenReady(page, page.getByLabel("Token address"), "https://basescan.org/",
      () => expect(page.getByText(/No 0x… address found in that link/)).toBeVisible({ timeout: 1_000 }));
    await expect(page.getByRole("button", { name: /Run trace/ })).toBeDisabled();
  });
});

test.describe("a stream that closes without finishing", () => {
  // The old assertion only checked DONE stayed hidden — which a page stuck on
  // SCANNING forever also satisfies. The page has to say the run did not end.
  test("is reported as an error, not left on SCANNING", async ({ page }) => {
    await page.route("**/api/run**", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          `event: prescan\ndata: {"type":"prescan","scan":{"token":"${RECORDED}","isErc20":true,"symbol":"TEST","decimals":18,"hasPool":true,"topHolders":[]}}\n\n` +
          `event: plan\ndata: {"type":"plan","ids":["honeypot"]}\n\n`,
      }));
    await page.goto(`/run?token=${RECORDED}`);
    // Once in the error block, once as the trace's ERROR line.
    await expect(page.getByText(/The stream ended before the run finished/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("status").first()).toHaveText("ERROR");
    await expect(page.getByText("DONE run complete")).toBeHidden();
  });
});

test.describe("pages that are not runs", () => {
  test("an unknown path gets the app's own 404, with both ways out", async ({ page }) => {
    const res = await page.goto("/nothing-here");
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/No page here/)).toBeVisible();
    await expect(page.getByRole("link", { name: /paste an address/ })).toHaveAttribute("href", "/");
    await expect(page.getByRole("link", { name: /browse every recorded run/ })).toHaveAttribute("href", "/catalogue");
  });
});

test.describe("liquidity that lives where Sidik does not trade", () => {
  // The prescan carries what DEX Screener said when Uniswap had no pool. The
  // page has to turn that into the reason for the N/A, not hide it.
  test("names the venue and its depth under the verdict", async ({ page }) => {
    await page.route("**/api/run**", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          `event: prescan\ndata: {"type":"prescan","scan":{"token":"${RECORDED}","isErc20":true,"symbol":"AERO-ONLY","decimals":18,"hasPool":false,"otherVenues":[{"dex":"aerodrome","pair":"0x00000000000000000000000000000000000000a1","liquidityUsd":784123}],"topHolders":[]}}\n\n` +
          `event: plan\ndata: {"type":"plan","ids":["honeypot"]}\n\n` +
          `event: verdict\ndata: {"type":"verdict","verdict":{"probe":"honeypot","status":"NA","title":"Could not buy — no liquidity to test","rows":[{"label":"Buy","claimed":"Tradable","proven":"No Uniswap pool","ok":false}],"numbers":{},"txHashes":[]}}\n\n` +
          `event: narration\ndata: {"type":"narration","text":"No Uniswap pool."}\n\n` +
          `event: done\ndata: {"type":"done"}\n\n`,
      }));
    await page.goto(`/run?token=${RECORDED}`);
    const line = page.locator("[data-other-venues]");
    await expect(line).toBeVisible({ timeout: 20_000 });
    await expect(line).toContainText("aerodrome");
    await expect(line).toContainText("$784,123");
    await expect(line).toContainText(/does not trade on/);
  });
});
