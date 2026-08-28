import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated accessibility audit on every page.
 *
 * axe-core catches a defined subset — contrast, names, roles, landmarks,
 * heading order — not everything, and passing it is not the same as being
 * usable with a screen reader. It is still the part that can be checked
 * mechanically on every commit, and nothing here had ever been checked at all.
 *
 * Scoped to WCAG 2 A/AA, which is the level the rules actually encode.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Audited with motion reduced, which is the deterministic state and also a
 * path this app already ships (globals.css honours prefers-reduced-motion).
 *
 * Without it the verdict cards are mid-fade when axe samples them: it reads
 * the blended colour of a half-opaque element against its parent and reports
 * a contrast failure for colours that measure fine at rest. Under load on
 * WebKit that produced eight bogus violations covering every palette colour
 * at once, including ones independently verified at 6:1. Freezing the
 * animation removes the ambiguity rather than papering over it — and if the
 * reduced-motion rules ever break, these tests start failing.
 */
test.use({ contextOptions: { reducedMotion: "reduce" } });

const RECORDED = "0x0e86eFe5Ba52336c2173AD69EE726e054619e0d8";

async function audit(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page }).withTags(TAGS).analyze();
}

function report(violations: Awaited<ReturnType<typeof audit>>["violations"]) {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).join("\n    ")}`)
    .join("\n");
}

test("home page has no automatically detectable accessibility violations", async ({ page }) => {
  await page.goto("/");
  const { violations } = await audit(page);
  expect(report(violations)).toBe("");
});

test("catalogue has no automatically detectable accessibility violations", async ({ page }) => {
  await page.goto("/catalogue");
  await expect(page.getByText(/recorded runs/).first()).toBeVisible();
  const { violations } = await audit(page);
  expect(report(violations)).toBe("");
});

test("a finished run has no automatically detectable accessibility violations", async ({ page }) => {
  // Audited after the stream completes: the verdict cards, the status badges
  // and the coloured pass/fail text only exist at that point, and they are
  // the parts most likely to fail contrast.
  await page.goto(`/run?token=${RECORDED}`);
  await expect(page.getByText("DONE run complete")).toBeVisible({ timeout: 30_000 });
  const { violations } = await audit(page);
  expect(report(violations)).toBe("");
});

test("the invalid-address page has no automatically detectable accessibility violations", async ({ page }) => {
  await page.goto("/run?token=not-an-address");
  await expect(page.getByText(/Invalid address/i)).toBeVisible();
  const { violations } = await audit(page);
  expect(report(violations)).toBe("");
});

/**
 * Contrast of the palette itself, read off the rendered page.
 *
 * axe only judges what happens to be on screen in the state it audits, which
 * is how --accent and --fg-dim stayed below AA while only --fail got flagged.
 * This checks every semantic colour against both surfaces it is used on, so a
 * palette edit cannot quietly drop one under the threshold again.
 */
test("every semantic colour meets WCAG AA against the surfaces it is used on", async ({ page }) => {
  await page.goto("/");

  const ratios = await page.evaluate(() => {
    const read = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    const parse = (c: string): [number, number, number] => {
      const h = c.replace("#", "");
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    };
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = (rgb: [number, number, number]) =>
      0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: [number, number, number], b: [number, number, number]) => {
      const [l1, l2] = [lum(a), lum(b)];
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    // Badges paint the colour at 10-15% over the card, so the text sits on a
    // surface barely lighter than the card — that composite is the real worst
    // case, not the raw card colour.
    const over = (fg: [number, number, number], bg: [number, number, number], a: number) =>
      fg.map((c, i) => Math.round(c * a + bg[i]! * (1 - a))) as [number, number, number];

    const card = parse(read("--card"));
    const ink = parse(read("--ink"));
    const out: Record<string, number> = {};
    for (const name of ["--fail", "--pass", "--na", "--accent", "--fg-dim", "--fg"]) {
      const c = parse(read(name));
      out[name] = Math.min(
        ratio(c, card), ratio(c, ink),
        ratio(c, over(c, card, 0.15)), ratio(c, over(c, card, 0.1)),
      );
    }
    return out;
  });

  for (const [name, r] of Object.entries(ratios)) {
    expect(r, `${name} contrast ${r.toFixed(2)}:1 is below WCAG AA (4.5:1)`).toBeGreaterThanOrEqual(4.5);
  }
});

test("every interactive control on the home page is reachable by keyboard", async ({ page, browserName }) => {
  // WebKit is excluded, and not because the page fails there. Safari's Tab
  // key moves between form fields only until "Full Keyboard Access" is turned
  // on in system settings, so links and buttons are skipped by the browser
  // itself — the same markup, a different platform default. Asserting on it
  // would encode Safari's setting as a defect in this page.
  test.skip(browserName === "webkit", "Safari tabs to form fields only unless Full Keyboard Access is enabled");

  // axe checks that controls have names; it does not check that you can get
  // to them. Tabbing is the only way to establish that.
  await page.goto("/");
  const reached = new Set<string>();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return `${el.tagName.toLowerCase()}:${el.getAttribute("id") ?? el.textContent?.trim().slice(0, 24) ?? ""}`;
    });
    if (id) reached.add(id);
  }

  expect([...reached].some((r) => r.includes("token-address"))).toBe(true);
  expect([...reached].some((r) => r.startsWith("a:") || r.includes("Browse all"))).toBe(true);
  // The example buttons are how anyone without an address in hand uses this.
  expect([...reached].filter((r) => r.startsWith("button:")).length).toBeGreaterThan(0);
});

test("the 404 page passes too — it is the one page nobody tests", async ({ page }) => {
  await page.goto("/this-does-not-exist");
  const { violations } = await audit(page);
  expect(violations, report(violations)).toEqual([]);
});
