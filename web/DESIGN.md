---
name: Sidik
description: Proof, not promises — a forensic case file for what a Base token actually does to a buyer.
colors:
  evidence-blue: "#8aa4ff"
  cleared-green: "#34d399"
  reverted-red: "#ff6b6b"
  unanswered-amber: "#f5a623"
  ink: "#0a0c0e"
  panel: "#14171c"
  card: "#1b1f26"
  rule: "#2a2f38"
  foreground: "#e7eaee"
  foreground-dim: "#9aa3b2"
typography:
  display:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.1em"
  label-small:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.05em"
  verdict-display:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.15em"
  wordmark:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    letterSpacing: "0.3em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  section: "40px"
  page: "64px"
components:
  button-primary:
    backgroundColor: "{colors.evidence-blue}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  filter-chip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.foreground-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  filter-chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.evidence-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  input-address:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  verdict-badge:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
---

# Design System: Sidik

## Overview

**Creative North Star: "The Case File"**

Sidik is an investigation, and its pages are the file that comes out of one. Everything on screen is an exhibit: a transaction that was mined, a revert string that came back, a number that was counted. The visual system exists to make that evidentiary character legible at a glance — a buyer on a phone reads one stamped verdict and knows whether the exit works; a judge reads the same page and can follow every figure back to the run that produced it. Nothing is decorated, because decoration is the one thing a case file never contains.

The surface is near-black ink with a faint blue cast, layered in three tones (ink, panel, card) and ruled with 1px lines rather than shadows: a flat dossier under a desk lamp, not a stack of floating cards. Labels, addresses, hashes and figures are set in IBM Plex Mono, tracked out like a stamp; prose is Inter, because a person reads it. Three colours carry meaning and only meaning — Cleared Green, Reverted Red, Unanswered Amber — and one accent, Evidence Blue, marks what the reader can act on. The fingerprint watermark behind the landing page is the single piece of imagery, and it is the product's name.

Motion is a verdict arriving. Cards reveal once, upward, in 350ms; a recording dot breathes while a run is in flight; nothing else moves. Confirmed rejections: no glassmorphism, no gradient text, no purple, no hype copy, no shadows as decoration, no colour as the sole carrier of a status.

**Key Characteristics:**
- Dark, flat, three-tone surfaces ruled with 1px lines; depth is tonal, never cast
- Mono for evidence (labels, addresses, hashes, figures), sans for reading
- Four meaning-carrying colours, each always paired with its word
- One signature: the fingerprint-ridge watermark on the landing page
- Motion only as state: reveal on arrival, pulse while recording

## Colors

A restrained forensic palette: three tones of ink, two tones of text, and four colours that each mean exactly one thing.

### Primary
- **Evidence Blue** (#8aa4ff): The one accent. Wordmark, links, the primary button, the selected filter, the focus ring, the "SCANNING" state, and the watermark's ridges. It marks what the reader can act on or is being asked to notice — never a decoration. Measured 4.31:1 in its previous shade and lifted to pass AA on the card surface.

### Secondary
- **Cleared Green** (#34d399): PASS. The probe executed and the assumption held. Badge text and border, the "ok" side of an assumed-vs-proven row, the DONE state.
- **Reverted Red** (#ff6b6b): FAIL. Something was proven against the token. The most important word the product says, so it was re-tinted until it passed AA on the composited badge background it actually renders on (the old #fb4141 measured 4.00:1). Also the error state and invalid-input border.
- **Unanswered Amber** (#f5a623): NA. Tried and could not tell — distinct from "does not apply", which is drawn in neutral. Also the replay banner and the "shares this symbol" warning.

### Neutral
- **Ink** (#0a0c0e): The page. Near-black with a blue cast, never pure black. Also the inset background of code, hashes and number chips.
- **Panel** (#14171c): The trace log, inputs, and the narration block — one tone up from the page.
- **Card** (#1b1f26): Verdict cards, catalogue rows, stat tiles — the topmost surface.
- **Rule** (#2a2f38): Every border and divider, 1px.
- **Foreground** (#e7eaee): Headings, values, anything the reader must read first.
- **Foreground Dim** (#9aa3b2): Running commentary, labels, captions. Lifted from #8b94a3 (4.27:1) to pass AA on the card.

### Named Rules
**The Word Rule.** A colour never carries a status alone. Every PASS, FAIL and NA is a word inside its colour; every red border has a sentence beside it.
**The One Accent Rule.** Evidence Blue appears on what can be acted on or must be noticed, and nowhere else. Backgrounds, dividers and decoration never take it.
**The Composited Contrast Rule.** Contrast is measured on the surface a colour actually renders on — a badge's tinted background, not the page — and a test reads the tokens off the live page and re-measures them.

## Typography

**Display Font:** IBM Plex Mono (with ui-monospace, Menlo, monospace)
**Body Font:** Inter (with Arial, Helvetica, sans-serif)
**Label/Mono Font:** IBM Plex Mono

**Character:** A typewritten dossier read by a person. Mono is not a costume for "technical" — it is used precisely where the content is evidence: addresses, hashes, figures, labels, and the headings that stamp a page. Everything meant to be read as a sentence is Inter.

### Hierarchy
- **Display** (600, 2.25rem–3rem, 1.15, -0.025em): The landing headline only, in mono, tight. Grows to 3rem at `sm`.
- **Headline** (600, 1.875rem, 1.2, -0.025em): Page titles ("Every recorded run"), in mono.
- **Title** (600, 1.125rem, 1.4): A verdict card's finding, in Inter — the one line a buyer reads.
- **Body** (400, 1rem–1.125rem, 1.75): Narration and explanatory prose, Inter, measured to roughly 65ch (`max-w-xl` / `max-w-2xl`).
- **Label** (400, 0.75rem, 1.5, 0.1em–0.2em, uppercase): Section labels, badges, chips, the trace log, addresses. Mono, tracked out. Badges use 600 and 0.1em; section labels use 0.2em.
- **Label Small** (400, 0.6875rem / 11px, 1.5, 0.05em): Row metadata on the catalogue — venue, listing, address stub, stat-tile captions. The one step below Label; nothing is set smaller.
- **Verdict Display** (600, 1.5rem, 1, 0.15em, uppercase): The overall verdict word at the top of a finished run — the stamp on the file. Used once per page.
- **Wordmark** (400, 0.875rem, 0.3em): SIDIK, always tracked to 0.3em, always in Evidence Blue.

### Named Rules
**The Evidence Rule.** If it was measured, it is set in mono. If it is being explained, it is set in Inter.
**The Tracked Stamp Rule.** Uppercase mono labels are tracked between 0.1em and 0.3em; nothing uppercase is ever set tight.

## Layout

A single centred column. Landing content is capped at `max-w-2xl` (42rem) and vertically centred in the viewport; run pages at `max-w-4xl` (56rem); the catalogue at `max-w-5xl` (64rem). Horizontal page padding is 24px (`px-6`); vertical page padding is 48–96px depending on the surface.

Rhythm is on a 4px grid with three working steps: 8–12px inside a group, 16–24px between elements in a section, 40–56px between sections. More space sits above a heading than below it.

Verdict cards split into two columns at `sm` (640px): "What a buyer assumes" beside "Proven in fork", divided by a 1px rule; below `sm` they stack with a horizontal rule between. Catalogue rows are a single flex line at `sm` and stack below it. Stat tiles run 2 → 3 → 4 columns across `base` → `sm` → `lg`. Anything wider than a phone — the trace log, a command, raw JSON — scrolls inside its own container and is keyboard-focusable; the page never scrolls horizontally.

## Elevation & Depth

Flat, by decision. There are no shadows anywhere in the system; depth is conveyed by three surface tones (ink → panel → card, each one step lighter) and 1px rules in the Rule colour. The only translucent treatments are the verdict badges and chips, which tint their own colour at 10–15% over the card, and the fingerprint watermark, which is masked to fade out at 70% of its radius.

### Named Rules
**The Flat Dossier Rule.** Surfaces are flat at rest and stay flat under interaction. Hover changes a border or a text colour, never a shadow or a lift.

## Shapes

Softly squared: 6px on controls and inputs (`rounded-md`), 8px on cards and rows (`rounded-lg`), 4px on inline number chips and code (`rounded`), and a full pill on verdict badges and status pills. Every container carries a 1px Rule border; nothing is clipped into an organic shape. The fingerprint watermark is the only curve in the system.

## Components

### Buttons
- **Shape:** Softly squared (6px), 1px border on secondary.
- **Primary:** Evidence Blue background, Ink text, mono label 600 (`Run trace →`), 12px 24px padding. Hover brightens 10%. Disabled drops to 35% opacity with `cursor-not-allowed` — the disabled state is also what the server renders, so the enabling fill has to wait for hydration.
- **Secondary (example buttons):** Card background, Rule border, Foreground text in Inter, 10px 16px padding, a coloured 8px dot on the left naming the example's kind, and an arrow that nudges right and turns Evidence Blue on hover. Hover: border to Evidence Blue at 60%.
- **Focus:** 1px ring in Evidence Blue (`focus-visible:ring-1`), no outline.

### Chips (filters, number chips)
- **Filter (unselected):** Rule border, Foreground Dim mono label 0.75rem, 6px 12px padding; hover lifts text to Foreground. Filters are real links with `role="button"` and `aria-pressed`, so they work without JavaScript.
- **Filter (selected):** Evidence Blue border, Evidence Blue text, Evidence Blue at 10% behind.
- **Number chip:** Ink background, Rule border, 4px radius, mono `key: value` with the value in Foreground.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** Card, over the Ink page; the trace log and narration sit on Panel.
- **Shadow Strategy:** None (see Elevation).
- **Border:** 1px Rule; the narration block uses Evidence Blue at 30%; the error block uses Reverted Red at 50% over Reverted Red at 10%.
- **Internal Padding:** 16px 20px (`px-5 py-4`); dense chip rows use 12px 20px.
- **Behaviour:** Verdict cards reveal once on arrival (350ms, 6px rise). Each carries a header row (probe id · badge), the finding as Title, the two-column assumed-vs-proven table, a chip row of measured numbers, the fork tx hashes as plain text with the "never broadcast" note, and a toggle that expands the raw JSON.

### Inputs / Fields
- **Style:** Panel background, 1px Rule border, 6px radius, mono 0.875rem text, placeholder at Foreground Dim 60%, 12px 16px padding.
- **Focus:** Border and 1px ring in Evidence Blue; no outline.
- **Error:** Border and ring in Reverted Red at 60%, `aria-invalid`, and a live-region sentence below naming exactly what is wrong ("That is 39 characters after 0x; an address has 40.").

### Navigation
Minimal by design: the SIDIK wordmark (mono, 0.3em tracking, Evidence Blue) is the home link on every page; the catalogue and run pages link back through it. Pagination is prev/next as plain links with a mono "showing 1–50 · page 1 of 4" between them, and an unavailable direction renders nothing rather than a dimmed control.

### Verdict Strip (signature)
The first thing on a finished run page: the overall verdict word at Verdict Display size inside its colour, the token's symbol and linked address beside it, and one sentence underneath — the failing probe's finding for a FAIL, "every applicable probe passed" for a PASS — followed by "Proven at block 50,200,000 — N fork transactions". It answers the buyer's question before anything else on the page; the cards below it are the exhibits.

### Filter Tiles (catalogue)
Each filter is a tile carrying its own count: label in Label Small, the count in mono 1.5rem. Tiles are links; the selected one carries `aria-current="page"` and turns Evidence Blue (border and text). One set of eight controls, no duplicate chip row.

### Verdict Badge (signature)
A pill (9999px) with a 1px border and 10–15% tinted background in the verdict's colour, its word in 0.75rem mono 600 tracked 0.1em: `PASS`, `FAIL`, `NA`. A probe whose mechanism does not exist for the token gets the same pill in neutral (Rule border, Foreground Dim) reading `DOES NOT APPLY`, so "n/a here" never reads as "could not check".

### Live Trace Log (signature)
A Panel-toned block in mono 0.875rem with a tracked "LIVE TRACE" label and a breathing Evidence Blue dot while the run is in flight; each line is `VERB      detail` with a fixed-width verb column, revealed as it arrives. It is a keyboard-focusable group with a visible focus ring, because at phone width it overflows and becomes a scroll region.

## Do's and Don'ts

### Do:
- **Do** set every measured thing in IBM Plex Mono and every explanation in Inter.
- **Do** put the word inside the colour: `FAIL` in Reverted Red, never a red dot alone.
- **Do** keep depth tonal: ink → panel → card, 1px Rule borders, no shadows.
- **Do** measure contrast on the composited surface a colour renders on, and keep the test that re-measures the live tokens.
- **Do** make every overflowing region focusable (`tabIndex=0`, `role="group"`, a name) and give it the Evidence Blue focus ring.
- **Do** render an unavailable control as nothing, not as dimmed text.
- **Do** keep motion to arrival (reveal) and progress (pulse), and switch both off under `prefers-reduced-motion`.
- **Do** open a run page with the verdict and append the exhibits — the finding first, the file after.
- **Do** put decorative backgrounds and their masks on a pseudo-element behind the content, never on the container that holds it.

### Don't:
- **Don't** link a fork transaction hash to a block explorer; show it as text with the "never broadcast" note.
- **Don't** label the left column "Claimed" — it is "What a buyer assumes".
- **Don't** put corroboration (scanners, venues, verification) inside a verdict card's evidence; it sits below the summary in Foreground Dim, dated, with "not part of the proof".
- **Don't** use gradient text, glass or blur effects, coloured side borders thicker than 1px, or any shadow.
- **Don't** use Evidence Blue on anything that cannot be acted on or is not being pointed at.
- **Don't** set uppercase labels tight; track them 0.1em–0.3em.
- **Don't** ship a status colour below 4.5:1 on the badge background it actually sits on.
- **Don't** colour the "proven" text of a probe that does not apply; it is neutral, because there is nothing to have passed or failed.
- **Don't** let the header status pill say something the verdict at the bottom contradicts; once a run is done, the pill is the verdict.
