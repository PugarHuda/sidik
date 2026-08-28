# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: people about to buy a token on Base — usually a memecoin, usually on
a phone, usually deciding in seconds. Their job is one question: "if I buy
this, can I get out?" They arrive with an address pasted from a chat or a
DEX, and they leave as soon as they have a yes or a no they believe.

Confirmed secondary audiences, in order:

- Hackathon judges (exchange and launchpad partners) evaluating the entry in
  about two minutes, who need the mechanism to be legible and checkable fast.
- Developers and agents consuming `/api/catalogue`, `/api/token/<address>`
  and `/llms.txt`; for them the pages are the shop window and the JSON is the
  product.

## Product Purpose

Sidik (Indonesian: *to investigate*; *sidik jari* = fingerprint) proves what a
Base token does to a buyer by doing it: it forks Base mainnet at a pinned
block, buys the token with a funded test wallet, tries to sell it, transfers
it, pulls the pool out from under it, and lets the token's owner throw every
switch in its bytecode — then reports what actually happened, transaction by
transaction.

Success is a buyer who understands, in one screen, whether the exit works and
who could close it — and who can verify that claim rather than trust it.

## Positioning

Execution, not inference. Every other token-safety tool reads bytecode,
holder graphs or metadata and prints a score; Sidik executes the attack on a
forked copy of the chain, and every verdict is backed by a transaction that
was mined. A honeypot is not "flagged as suspicious": the sell reverted, and
the revert string is printed next to the claim. This is the sentence a
neighbouring product cannot truthfully copy.

## Operating Context

- The public site replays 194 recorded runs (block 50,200,000). An address
  outside the catalogue is answered with an error, never a guess. A live
  engine can be deployed separately to probe arbitrary addresses.
- A run is six probes: honeypot, hiddenFee, lpRug, ownerTrap, approvalDrain
  (wallets), crossVenue. Each yields PASS / FAIL / NA; a verdict marked
  `applicable: false` means the mechanism does not exist for that token and
  must not read as a failure to check.
- Verdicts stream over SSE and render progressively; a live run takes
  roughly 20–40 seconds, a recorded one replays in a couple of seconds.
- Every recorded verdict can be reproduced by anyone with a Base archive RPC
  (`pnpm --filter @sidik/engine reproduce <address>`), and this runs in CI.

## Capabilities and Constraints

- Fork transactions are never broadcast. Their hashes are shown as plain
  text and never linked to an explorer, because that page cannot exist; the
  token address is linked, because it is real.
- The LLM only orders probes and writes the narration. It cannot produce a
  verdict or a figure; every number in prose is checked against the run, and
  a summary that contradicts a verdict is replaced.
- Corroboration (Blockscout verification, BingX/Gate listings, GoPlus and
  honeypot.is readings) is shown beside verdicts, dated, and never changes
  one. Scanner readings describe the chain on the day asked, not the pinned
  block; the UI must keep saying so.
- Terminology: "What a buyer assumes" (never "Claimed" — Sidik quotes no
  project's promises); "DOES NOT APPLY" for an inapplicable probe; "fork tx".
- Boundaries: Aerodrome-only tokens and the `0xef`-bytecode family (CLANKER
  et al.) come back NA with a reason. Uniswap V2 and V3 only.
- Catalogue pages are server-rendered and paged at 50 rows; the recorded
  runs must never reach the browser bundle (a test enforces this).

## Brand Commitments

- Voice: calm and forensic. No hype, no claim that was not executed, and
  every figure is a counted one. Confirmed.
- Corroboration stays visibly separate from verdicts, always. Confirmed.
- WCAG AA is a requirement, not a nicety: text ≥4.5:1 on the surfaces it
  actually renders on, every scroll region keyboard-reachable, an axe audit
  of every page across five browser engines in CI. Confirmed.
- Name and wordmark: SIDIK, tracked-out, with the fingerprint meaning behind
  it.

## Evidence on Hand

- 194 recorded runs (`shared/src/fixtures.ts`): 1,075 fork transactions,
  47 addresses failing at least one probe — 25 LP rugs, 15 hidden fees,
  7 owner traps, 4 honeypots, 1 drainable wallet.
- Blockscout verification per address (`shared/src/verification.ts`):
  191 of 194 publish verified source, 46 of the 47 failing ones do.
- Scanner readings per address (`shared/src/scanners.ts`) with agreement
  counts in both directions (`SCANNER_STATS`).
- Venue listings (`shared/src/listings.ts`): 10 BingX pairs matched by hand,
  6 Gate pairs matched by contract address.
- Real example tokens, each verified on a fork: USDC, Anastasia (honeypot),
  BRB (3% tax), a wallet with a live approval, DEGEN (owner can pause sells).
- Absent, and not to be fabricated: testimonials, customer logos, pricing,
  any live-engine availability on the public site.

## Product Principles

1. Show the transaction, not the opinion. A verdict card is only as strong as
   the executed evidence it carries.
2. Absence of evidence is never evidence of absence. "Not probed", "does not
   apply", and "could not tell" are three different sentences and stay so.
3. The buyer decides in seconds; the judge verifies in minutes. The first
   screen answers, the rest proves.
4. Corroboration is context. It sits beside the verdict, dated, and never
   inside it.
5. Everything on the page is reproducible by a stranger with an RPC key.

## Accessibility & Inclusion

WCAG AA across every page: contrast measured on composited surfaces, no
meaning carried by colour alone (every badge carries its word), keyboard
access to every scroll region, and screen-reader announcements for validation
and progress. Reduced-motion is respected in tests and must remain so.
