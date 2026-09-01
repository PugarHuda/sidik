import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * The footage, recorded off the deployed site rather than a local build.
 *
 * Everything in the video has to be something a judge can reproduce by opening
 * the same URL, so this drives https://sidik-eight.vercel.app and records what
 * a browser actually renders. The live-run clip in particular is a real
 * execution against a fork of Base — it is the one shot that cannot be faked,
 * and it is the reason the video exists.
 *
 *   node video/record.mjs
 */
const SITE = process.env.SIDIK_SITE ?? "https://sidik-eight.vercel.app";
const OUT = path.join(import.meta.dirname, "assets", "clips");
// The site's content column is narrow by design, so a 1920-wide capture puts
// it in a thin strip with dead ground either side. Driving a 1280 viewport and
// letting Playwright record at 1080p scales the column up to fill the frame,
// which is what a video needs and a page does not.
const W = 1920, H = 1080;
const VIEW = { width: 1280, height: 720 };

// A token with no recorded run, so the live route has to fork and execute
// rather than answer from the seeded catalogue cache. Verified 2026-09-01.
const UNRECORDED = "0x0d97F261b1e88845184f678e2d1e7a98D9FD38dE"; // TYBG

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Records one clip, then transcodes it so Remotion gets a seekable MP4. */
async function clip(name, seconds, drive) {
  const raw = path.join(OUT, "_raw", name);
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });

  const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 1,
    // Recorded AT the viewport size and upscaled below. Asking Playwright for
    // a 1080p canvas around a 720p viewport does not scale the page: it pins
    // the render to the top-left and fills the rest with grey.
    recordVideo: { dir: raw, size: VIEW },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const started = Date.now();
  try {
    await drive(page);
    // Hold the last frame so the clip is never shorter than the narration
    // that sits over it.
    const remaining = seconds * 1000 - (Date.now() - started);
    if (remaining > 0) await sleep(remaining);
  } finally {
    await context.close();
    await browser.close();
  }

  const webm = readdirSync(raw).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error(`${name}: playwright wrote no video`);
  const src = path.join(raw, webm);
  const mp4 = path.join(OUT, `${name}.mp4`);
  // yuv420p and an even frame size, or half the players in the world show a
  // green frame; -r 30 because a variable-rate webm makes Remotion's seeking
  // land in the wrong place.
  execFileSync("ffmpeg", ["-y", "-i", src, "-r", "30", "-pix_fmt", "yuv420p",
    "-vf", `scale=${W}:${H}:flags=lanczos`, "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", mp4],
    { stdio: "pipe" });
  rmSync(raw, { recursive: true, force: true });
  console.log(`  ${name.padEnd(10)} ${(Date.now() - started) / 1000}s driven -> ${path.basename(mp4)}`);
}

mkdirSync(OUT, { recursive: true });

// 1. The landing page, scrolled to the two figures it leads with.
await clip("landing", 12, async (page) => {
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await sleep(2500);
  await page.mouse.wheel(0, 420);
  await sleep(3000);
  await page.mouse.wheel(0, 520);
  await sleep(3000);
});

// 2. An address being typed in, the way somebody actually arrives.
await clip("paste", 9, async (page) => {
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await sleep(1200);
  const box = page.locator("#token-address");
  await box.click();
  await box.pressSequentially(UNRECORDED, { delay: 38 });
  await sleep(1500);
});

// 3. THE SHOT: a real fork execution, streaming. Not a replay -- this address
//    is not in the catalogue, so the engine has to fork Base and run the probes.
await clip("live", 34, async (page) => {
  await page.goto(`${SITE}/run?token=${UNRECORDED}&live=1`, { waitUntil: "domcontentloaded" });
  // Wait for the run to actually finish rather than for a fixed time, so the
  // clip contains a completed verdict however long the fork took.
  await page.waitForSelector("[data-verdict-status], .animate-reveal", { timeout: 90_000 }).catch(() => {});
  await sleep(24_000);
  await page.mouse.wheel(0, 500);
  await sleep(3000);
});

// 4. The findings page: the three measured results.
await clip("findings", 10, async (page) => {
  await page.goto(`${SITE}/findings`, { waitUntil: "networkidle" });
  await sleep(3000);
  await page.mouse.wheel(0, 380);
  await sleep(4000);
});

await clip("verified", 13, async (page) => {
  await page.goto(`${SITE}/findings`, { waitUntil: "networkidle" });
  await sleep(1000);
  await page.mouse.wheel(0, 700);
  await sleep(5500);
  await page.mouse.wheel(0, 420);
  await sleep(4500);
});

await clip("scanners", 11, async (page) => {
  await page.goto(`${SITE}/findings`, { waitUntil: "networkidle" });
  await sleep(800);
  await page.mouse.wheel(0, 1450);
  await sleep(5000);
  await page.mouse.wheel(0, 400);
  await sleep(3500);
});

// 5. Every token whose owner can still close the exit.
await clip("ownertrap", 18, async (page) => {
  await page.goto(`${SITE}/catalogue?filter=ownerTrap`, { waitUntil: "networkidle" });
  await sleep(3500);
  await page.mouse.wheel(0, 500);
  await sleep(4000);
  await page.goto(`${SITE}/run?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed&instant=1`, { waitUntil: "networkidle" });
  await sleep(5000);
  await page.mouse.wheel(0, 600);
  await sleep(4000);
});

rmSync(path.join(OUT, "_raw"), { recursive: true, force: true });
console.log(`\nclips in ${OUT}`);
if (!existsSync(path.join(OUT, "live.mp4"))) throw new Error("the live clip is missing");
