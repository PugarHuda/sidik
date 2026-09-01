# The demo video

`video/remotion/out/sidik-demo.mp4` — 1920×1080, 95 seconds, 14 MB.

Nothing in it is a mockup. Every frame of the browser is a Playwright
recording of the deployed site, and the live-run section is a genuine fork
execution of a token that is **not** in the recorded catalogue — the one shot
that cannot be faked, and the reason the video exists.

## Rebuilding it

```bash
python video/make-vo.py     # neural voiceover, one clip per subtitle cue
node   video/record.mjs     # drives the live site, writes video/assets/clips
cd video/remotion && npm i && npx remotion render Demo out/sidik-demo.mp4 \
  --browser-executable="<a chrome or chromium binary>"
```

Then copy `video/assets/{timing.json,vo,clips}` and `docs/brand/sidik-logo.png`
into `video/remotion/public/`.

## Why it is built this way

- **Captions are never placed by hand.** Each line is synthesised separately
  and its duration measured out of the file with ffprobe, so the subtitle
  timing comes from the audio rather than from a guess. Edit a line and the
  captions still land.
- **The voice is Microsoft's `en-US-AndrewNeural` through edge-tts.** No API
  key and no cost, which is the same constraint that shaped the hosting.
  Its documented personality is "warm, confident, authentic, honest", which is
  the register this project needs.
- **Playwright records at a 1280 viewport and ffmpeg upscales to 1080p.**
  The site's content column is narrow by design; capturing at 1920 leaves it a
  thin strip with dead ground either side. Asking Playwright for a 1080p canvas
  around a 720p viewport does not scale the page — it pins the render to the
  top-left and fills the rest with grey.
- **Remotion needs a browser.** The bundled Headless Shell download failed
  here; passing `--browser-executable` at an existing Chromium is faster than
  fetching another 100 MB.

## Where it goes

Not the submission form, which has no video field. It is for the X post and
anywhere else the entry is shown — the one place a judge sees the live
execution without having to run it themselves.
