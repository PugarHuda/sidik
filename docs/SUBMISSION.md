# Orion Builder Hackathon — submission copy

Everything here is checked against the repository and the deployed site. Every
number below was counted from the recorded runs, not recalled. If you change
the catalogue, re-count before reusing this:

```bash
pnpm --filter @sidik/engine counts
```

Deadline: **2026-09-02 23:59 UTC**.

---

## The one-liner

> Sidik doesn't read a token's code and guess. It buys the token, sells it,
> transfers it and tries to rug it — on a forked Base mainnet — and shows you
> what actually happened.

## The one number to lead with

> **191 of the 194 addresses Sidik probed publish verified source code — and
> so do 46 of the 47 it caught.** Every honeypot. Every hidden fee. Every
> ruggable pool. Every owner trap. "Check that the contract is verified" is
> the advice everyone gives, and on Base it separates almost nothing.

That is measured, per address, from Blockscout's public API and recorded in
`shared/src/verification.ts`. It is the answer to the only real objection to
this project — *could I not have just read the contract?* — and it is why
executing beats reading.

## Measured against the scanners judges already know

The catalogue was run through GoPlus (the check most wallets embed) and
honeypot.is (which simulates its own buy and sell), and the answers recorded
beside the executed verdicts — both directions of disagreement, dated,
never touching a verdict.

- **GoPlus cleared Anastasia and ROOTED.** Both cannot be sold on a fork.
- **GoPlus did not flag DEGEN or XYJ as pausable, or PP as mintable.** On
  the fork, DEGEN's and XYJ's owners' `pause()` stopped the identical sell,
  and PP's owner minted ten billion tokens and sold them into the pool.
  GoPlus flags whether the code exists; Sidik reports what pulling it did —
  and it also cleared eight tokens GoPlus flags whose switches are dead
  because ownership was renounced, BRETT among them.
- **Where the scanners are strong, say so.** On buy tax GoPlus matched the
  executed figure on 146 of 146 addresses. The comparison is published in
  both directions, and the catalogue has a filter for the rows where a
  scanner and the fork disagree.
- Against honeypot.is, 171 of 177 agree, and every disagreement is the
  scanner flagging a token the fork sold at block 50,200,000. Scanners
  describe today; verdicts describe the pin — so Sidik forked **today's
  head** (8.1 days later) and sold again: COBIE, KEYCAT, NVO and CASHCAT
  all still sold. Those flags were wrong on the day, not stale. COBIE is the token
  whose owner Sidik proved *could* stop the sell; they had not.

## Why this is not another risk scanner

The field's other entrants analyse: bytecode, holder distribution, contract
metadata, an LLM's opinion of verifiable on-chain facts. All of that is
inference, and inference is exactly what a token author optimises against.

Sidik executes. Every verdict on the site is backed by a transaction that was
mined — 1,075 of them across 194 addresses — on an ephemeral anvil fork of Base
pinned at block 50,200,000. A honeypot is not "flagged as suspicious"; the
sell reverted, and the revert string is printed next to the claim.

That distinction should lead every field you fill in.

## What it found (counted, not estimated)

- **194 Base addresses** probed end to end, **1,075 fork transactions** mined
- **47 fail at least one probe**: 25 LP rugs, 15 hidden fees, **7 owner
  traps**, 4 honeypots, 1 drainable wallet
- **4 of those 7 owner traps pass every other probe** — COBIE, XYJ, DEGEN and
  PP buy, sell, transfer and price exactly like a clean token, and their
  owners can still stop the exit. Two of the seven are dilution rather than a
  block: wPNH's owner minted 21,563,882 tokens and sold them into the same
  pool, and the identical exit then paid **0.77%** of what it had; PP's paid
  **0.47%**.
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
- A probe that finds no mechanism to test says so, with the number it searched
  for, and is marked as not applying rather than counted as a failure to
  answer. A bytecode scan cannot prove there is no privileged code under a
  name nobody has seen.
- Where it cannot establish *who* is allowed to pull a switch — a token with
  no `owner()` at all — it returns N/A, not PASS. All it proved there is that
  a stranger could not, and a PASS would be a verdict with no evidence.
- A reverted sell is not the end of the honeypot question. The probe retries a
  tenth of the position — a max-tx cap is not a trap, and a holder who can
  leave in pieces is told so — and measures whether the token skims plain
  transfers. Two of the four "honeypots" turned out to be that: 7SiN and
  ROOTED take 2.99% and 6.99% off every transfer, and Uniswap V3 rejects a
  swap whose input arrives short. The holder still cannot sell, so the
  verdict stays FAIL, but the title now names the mechanism instead of
  implying a deliberate trap the run never established.
- A stranger's call that does not revert is not treated as proof the switch is
  open. One token let anyone call `blacklist(address)` without reverting and
  the sell still worked: the call did nothing. The claim only stands if the
  exit then broke or supply moved.

## Reproducibility, stated as a number

The catalogue was re-recorded end to end after the owner-switch probe was
added. Comparing every verdict against the ones it replaced, at the same
pinned block: **586 verdicts compared, 2 changed status** — both of them the
deliberate cross-venue addition (DEGEN and VIRTUAL went NA to PASS because
BingX had no price in that hour and Gate does). Nine more changed only their
wording, every one of them an edit that was made on purpose.

`pnpm --filter @sidik/engine reproduce --sample 5` re-runs a spread of the
catalogue against a fresh fork and diffs it: **20 verdicts reproduced, 0
differed**. It runs in CI on every push, and anyone with a Base archive RPC
can run it against any address in the catalogue.

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
| Catalogue (deep link worth showing a judge) | https://sidik-eight.vercel.app/catalogue?filter=ownerTrap |
| The single best run to open first | https://sidik-eight.vercel.app/run?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed |
| Machine-readable proof | https://sidik-eight.vercel.app/api/token/0x48F617e5b1B214a90800348D7944bBc0E9290Fbb |
| The whole catalogue as data | https://sidik-eight.vercel.app/api/catalogue |
| What the data means, for an agent | https://sidik-eight.vercel.app/llms.txt |
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

1. https://sidik-eight.vercel.app/run?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed
   — **DEGEN**, and the best two minutes this project has. A top-tier Base
   token that passes every trade test Sidik has: the buy lands, the sell
   lands, no hidden fee, the pool prices it like the wider market. Then the
   owner-switch probe impersonates its owner, calls `pause()`, and makes the
   identical sell again — and it reverts. 0.9801 WETH before, a revert after.
   Nothing about that says the owner will do it. It says the holder's exit is
   the owner's to decide, and no amount of reading the source establishes
   which way that goes.
2. https://sidik-eight.vercel.app/run?token=0x48F617e5b1B214a90800348D7944bBc0E9290Fbb
   — Anastasia. The buy lands, the sell reverts with
   `TransferHelper: TRANSFER_FROM_FAILED`, and that string is the evidence.
   Its source code is published and verified, like 46 of the 47 Sidik caught.
3. https://sidik-eight.vercel.app/catalogue?filter=ownerTrap — every token
   whose owner can still trap a holder, then `?filter=honeypot` for the ones
   that already do.
4. `curl https://sidik-eight.vercel.app/api/token/<address>` — the same
   verdict as JSON, carrying `forkBlock` and `transactionsWereBroadcast: false`.
   `/api/catalogue` for the whole list, `/llms.txt` for what it all means.
5. And if they doubt any of it:
   `pnpm --filter @sidik/engine reproduce 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed`
   forks Base at the same block with their own RPC and tells them whether the
   published verdict comes back. It runs in CI on every push, too.
