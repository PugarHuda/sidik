import { test, expect } from "@playwright/test";

/**
 * Framing, not content.
 *
 * These intercept the run page's own API call and hand it streams the server
 * here does not itself produce, so the parser that actually ships is the one
 * under test. CRLF line endings are the point: they are legal per the SSE spec
 * and some proxies emit them, and the hand-rolled parser this replaced split
 * on "\n\n" alone — a CRLF stream yielded nothing at all and the page sat
 * there waiting with no error to show for it.
 */
const ANY_ADDRESS = "0x0e86eFe5Ba52336c2173AD69EE726e054619e0d8";

function frames(sep: string): string {
  const verdict = {
    probe: "honeypot", status: "FAIL", title: "Honeypot — you can buy but cannot sell",
    rows: [{ label: "Sell after buying", claimed: "Freely tradable", proven: "Sell reverted", ok: false }],
    numbers: { boughtAmount: "1,000 TEST" }, txHashes: [],
  };
  const scan = {
    token: ANY_ADDRESS, isErc20: true, symbol: "TEST", decimals: 18, hasPool: true, topHolders: [],
  };
  return [
    `event: prescan${sep}data: ${JSON.stringify({ type: "prescan", scan })}`,
    `: a keep-alive comment, which carries no data`,
    `event: plan${sep}data: ${JSON.stringify({ type: "plan", ids: ["honeypot"] })}`,
    `event: verdict${sep}data: ${JSON.stringify({ type: "verdict", verdict })}`,
    `event: done${sep}data: ${JSON.stringify({ type: "done" })}`,
  ].join(`${sep}${sep}`) + `${sep}${sep}`;
}

for (const [name, sep] of [["LF", "\n"], ["CRLF", "\r\n"]] as const) {
  test(`renders a run delivered with ${name} line endings`, async ({ page }) => {
    await page.route("**/api/run**", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: frames(sep),
      }));

    await page.goto(`/run?token=${ANY_ADDRESS}`);

    await expect(page.getByText("DONE run complete")).toBeVisible();
    await expect(page.getByText(/PRESCAN\s+symbol=TEST/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Honeypot — you can buy but cannot sell/ })).toBeVisible();
  });
}

test("survives a frame whose payload is not the JSON it expects", async ({ page }) => {
  const body =
    `event: prescan\ndata: {"type":"prescan","scan":{"token":"${ANY_ADDRESS}","isErc20":true,"symbol":"TEST","decimals":18,"hasPool":true,"topHolders":[]}}\n\n` +
    `event: verdict\ndata: {this is not json\n\n` +
    `event: done\ndata: {"type":"done"}\n\n`;

  await page.route("**/api/run**", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body }));

  await page.goto(`/run?token=${ANY_ADDRESS}`);
  // The bad frame costs itself and nothing else — the run still completes.
  await expect(page.getByText("DONE run complete")).toBeVisible();
});
