# Brand assets

Both files are for the Orion submission form. Neither is decoration invented
for the occasion: the logo is drawn from the palette in
`web/app/globals.css`, and the banner is the site's own OG card.

| File | Size | Field on the form |
|---|---|---|
| `sidik-logo.png` | 1024×1024 | Agent Logo |
| `sidik-banner.png` | 1200×630 | Banner Image |

## The logo

`logo.html` is the source; the PNG is a render of it. To change it, edit the
SVG and screenshot the `.plate` element at 1024×1024 with Playwright.

It is a fingerprint, which is what the name means — *sidik jari*. Two things
about the drawing are deliberate:

- **Nested arches, not concentric rings.** The first attempt drew ellipses and
  cut a wedge from the bottom; it read as a wifi icon, because a wedge that
  wide leaves a symmetric empty triangle and trimming one side turns the outer
  ring into a letter C. Ridges that run off the bottom edge read as a print
  before they read as a circle.
- **Two ridges stop short.** Ridge endings are the feature a real print is
  identified by, and without them four clean arches look like a rainbow.

It is drawn for the size it is actually seen at. In the entries gallery it is
a small square beside a title, so it carries four ridges rather than the dozen
a real print has; anything denser fills to a solid blob. Checked at 128, 64,
48, 32 and 24 pixels — it holds to 32.

## The banner

`sidik-banner.png` is `GET /api/og` from the deployed site, saved to a file.
It is generated from the catalogue, so the address count on it is counted
rather than typed. Re-fetch it after a re-record:

```bash
curl -s https://sidik-eight.vercel.app/api/og -o docs/brand/sidik-banner.png
```
