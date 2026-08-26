# Orion Builder Hackathon — submission copy

Everything here is checked against the repository and the deployed site. Every
number below was counted from `shared/src/fixtures.ts` on 2026-08-26, not
recalled. If you change the catalogue, re-run the counts before reusing this.

Deadline: **2026-09-02 23:59 UTC**.

---

## The one-liner

> Sidik doesn't read a token's code and guess. It buys the token, sells it,
> transfers it and tries to rug it — on a forked Base mainnet — and shows you
> what actually happened.

## Why this is not another risk scanner

The field's other entrants analyse: bytecode, holder distribution, contract
metadata, an LLM's opinion of verifiable on-chain facts. All of that is
inference, and inference is exactly what a token author optimises against.

Sidik executes. Every verdict on the site is backed by a transaction that was
mined — 990 of them across 194 addresses — on an ephemeral anvil fork of Base
pinned at block 50,200,000. A honeypot is not "flagged as suspicious"; the
sell reverted, and the revert string is printed next to the claim.

That distinction should lead every field you fill in.

## What it found (counted, not estimated)

- **194 Base addresses** probed end to end, **990 fork transactions** mined
- **43 fail at least one probe**: 25 LP rugs, 15 hidden fees, 4 honeypots,
  1 drainable wallet
- 104 trade on Uniswap V3, 87 on V2
- **9 tickers are claimed by more than one contract** — five separate
  contracts on Base call themselves BRIAN — and their verdicts differ. One
  PEPETO comes back NA and another FAIL; one MOCHI fails on V2 while its
  namesake passes on V3. Picking a token by its ticker can pick the wrong one.

## What it refuses to do

Worth saying out loud, because it is the hard part:

- It never links a fork transaction to a block explorer. Those transactions
  were never broadcast, so the page would send a judge to check the central
  claim and find an empty page. The hashes are shown as plain text with that
  stated.
- It never prints a figure the run did not produce. Model prose is checked
  digit by digit and hash by hash against the verdict data, and a summary that
  closes by calling a failed token "safe to trade" is replaced by the
  deterministic template — that check exists because one narration did exactly
  that.
- An address with no recorded run gets an error, not a clean bill of health.
  "Not probed" and "nothing found wrong" are different sentences.
- The left-hand column is labelled "What a buyer assumes", not "Claimed".
  Sidik never reads a project's site or docs, so it has no claim to quote.

## Honest limits

State these; the field rewards it.

- The public site **replays recorded runs**. No free host would run the engine
  (anvil forking needs real compute), so the runs were executed here and
  frozen. They are genuine output, not mock data, and the code that produced
  them is in the repo.
- Probes trade through Uniswap V2 and V3 only. A token whose liquidity lives
  on Aerodrome comes back NA — with the reason attached.
- Three Base contracts (CLANKER, ELENA, WIFHAIR) hold a single byte of code,
  `0xef`, which is not a valid EVM opcode. Public nodes answer for them
  anyway; a fork cannot. Those are reported as unprobeable, not as safe.

## Links to paste

| Field | Value |
|---|---|
| Website / demo | https://sidik-eight.vercel.app |
| GitHub | https://github.com/PugarHuda/sidik |
| Catalogue (deep link worth showing a judge) | https://sidik-eight.vercel.app/catalogue?filter=honeypot |
| Machine-readable proof | https://sidik-eight.vercel.app/api/token/0x48F617e5b1B214a90800348D7944bBc0E9290Fbb |
| X profile | **you must create this** |
| Discord or Telegram | **you must create this** |

## Still yours to do

Nothing in this list can be done from here.

1. **X profile** — required field.
2. **Discord or Telegram handle** — one of the two is required.
3. **Submit from the registered wallet** (already registered as Pugar Huda
   Mantoro; registration was signature-only and is done) and pay the
   **~$10 ETH ignition fee on Base**. It is a platform fee, not a stake, and
   it is not refundable.
4. **Rotate `VENICE_API_KEY`.** It was pasted into a chat transcript. It has
   never been committed — verified against the full git history — but a
   transcript is a leak. Replace it in `engine/.env` and in any host config.

## A judge's two-minute path

Give them this, in order:

1. https://sidik-eight.vercel.app/run?token=0x48F617e5b1B214a90800348D7944bBc0E9290Fbb
   — Anastasia. The buy lands, the sell reverts with
   `TransferHelper: TRANSFER_FROM_FAILED`, and that string is the evidence.
2. https://sidik-eight.vercel.app/catalogue?filter=honeypot — every honeypot
   found, failures first.
3. `curl https://sidik-eight.vercel.app/api/token/<address>` — the same
   verdict as JSON, carrying `forkBlock` and `transactionsWereBroadcast: false`.
