import { expect, type Page } from "@playwright/test";

/**
 * Interactions that survive the gap between paint and hydration.
 *
 * The catalogue is server-rendered and then hydrated: the markup, the input
 * and every row are on screen and look finished before React has attached a
 * single event handler. Playwright's `fill` and `click` act on the DOM, so a
 * test that types the moment the page paints sets an input value React never
 * hears about, and the list simply does not filter.
 *
 * On desktop Chromium the window between the two is small enough that this
 * almost never lost. On mobile Safari and Firefox it lost regularly — which
 * is not a browser quirk to work around but the same race a real reader hits
 * on a slow phone, showing up where the timing is slow enough to see it.
 *
 * Both helpers retry the interaction until the page actually responds, which
 * is what a person does when their first keystroke goes nowhere.
 */

const READY_TIMEOUT = 20_000;

/** Fill an input and keep filling until the page reacts to it. */
export async function fillWhenReady(
  _page: Page,
  locator: ReturnType<Page["getByLabel"]>,
  value: string,
  settled: () => Promise<unknown>,
): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(async () => {
    // Cleared first. After a back navigation the browser can restore the
    // input's old text while React remounts with empty state, and filling the
    // same string it already shows produces no change for React to react to —
    // mobile Safari restores exactly that way.
    await locator.fill("");
    await locator.fill(value);
    await settled();
  }).toPass({ timeout: READY_TIMEOUT });
}

/**
 * Click a filter tile and keep clicking until it reports the state change.
 *
 * The filters are links carrying their own count ("Honeypots 4"), so the
 * name is matched by prefix. `aria-current="page"` is the check rather than
 * a row count: it is set by the server render of the new URL, so it
 * distinguishes "the DOM got a click" from "the navigation happened".
 */
export function filterTile(page: Page, name: string) {
  return page.getByRole("link", { name: new RegExp(`^${name}\\b`) });
}

export async function clickFilter(page: Page, name: string): Promise<void> {
  const tile = filterTile(page, name);
  await expect(tile).toBeVisible();
  await expect(async () => {
    await tile.click();
    await expect(tile).toHaveAttribute("aria-current", "page", { timeout: 1_000 });
  }).toPass({ timeout: READY_TIMEOUT });
}

/**
 * How long to wait for the catalogue to respond to a keystroke.
 *
 * Filtering used to happen in the browser and was effectively instant. It now
 * runs on the server, so typing costs a 250ms debounce plus a navigation —
 * a deliberate trade for filters that live in the URL, but a real one, and
 * this is where it shows up.
 */
export const SEARCH_SETTLE_MS = 5_000;
