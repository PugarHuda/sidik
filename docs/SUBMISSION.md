# Orion Builder Hackathon — submission copy

Everything here is checked against the repository and the deployed site. Every
number below was counted from the recorded runs, not recalled. If you change
the catalogue, re-count before reusing this:

```bash
pnpm --filter @sidik/engine counts
```

Last recounted: **2026-08-31**, after the LP-rug probe was taught to find a
V3 pool's launch position and the whole catalogue was re-recorded against it.
A drift test now fails the build when these numbers and the catalogue part
company: `engine/test/docsDrift.test.ts`. Deadline: **2026-09-02 23:59 UTC**.

---

## The one-liner

> Sidik doesn't read a token's code and guess. It buys the token, sells it,
> transfers it and tries to rug it — on a forked Base mainnet — and shows you
> what actually happened.

## Why an exchange or a launchpad should care

Four of the six partner judges run listing venues — HuoStarter, Up10, WEEX,
BingX. Listing a token that cannot be sold is their downside, not a
hypothetical, and the standard pre-listing checks are exactly the ones this
project measured and found wanting:

- **"Is the contract verified?"** 203 of the 206 Blockscout can answer for
  are. So are 59 of the 60 with a finding against them. It separates almost
  nothing.
- **"What does the scanner say?"** GoPlus and honeypot.is were run over the
  same catalogue and the answers published in both directions. On buy tax they
  are excellent — GoPlus matched the executed figure on **185 of 185**. On
  who can still stop a holder from leaving, GoPlus agreed with the fork on
  **12 of 42**.
- **"Does it trade?"** Sidik corroborates pool pricing against **BingX and
  Gate** — one of those venues is on the judging panel — and treats the
  agreement as context, never as a verdict.

Sidik is the pre-listing check that answers by executing the trade rather than
by reading the contract.

## The one number to lead with

> **203 of the 206 addresses Blockscout could answer for publish verified
> source code — and so do 59 of the 60 Sidik caught.** Every honeypot. Every hidden fee. Every ruggable
> pool. Every owner trap. "Check that the contract is verified" is the advice
> everyone gives, and on Base it separates almost nothing.

Measured per address from Blockscout's public API and recorded in
`shared/src/verification.ts`. **Sourcify was then asked the same question
independently**: 67 exact matches (metadata hash included), 42 partial, 97 it
holds nothing for. Two verifiers, same conclusion — publishing your source is
not evidence of anything.

Per probe, of the tokens that failed it: honeypots 7/7 verified, hidden fees
18/18, LP rugs 29/29, owner traps 25/25.

## The second number, and the one people argue with

> **25 tokens have a privileged address that can still stop a holder from
> leaving. 9 of them pass every other probe Sidik has.**

Those nine are XYJ, DEGEN, cbBTC, USDbC, cbETH, E3D, PP, **USDC** and **EURC**. They
buy, sell, transfer and price exactly like a clean token. Then the owner-switch
probe impersonates the privileged address, pulls the switch, and makes the
identical sell again — and it fails.

**17 of the 25 are proxy admins replacing the implementation**, which is why
USDC, EURC, cbBTC, cbETH and USDbC are among them. Circle's euro stablecoin
fails for exactly the reason its dollar one does, which is what makes this a
property of the pattern rather than a quirk of a token. State this plainly and it is the
most interesting result in the project; state it carelessly and it reads as an
accusation against Circle and Coinbase. It is neither a prediction nor a
discovery of wrongdoing: it is proof that the upgrade path is real and
reachable, executed rather than inferred. The run page says so directly, under
the verdict:

> Sidik pulled that switch itself, on a fork. It proves the privileged address
> **can** do this — not that it has, and not that it will. Nothing here
> happened on Base, and a contract having an admin is a design decision, not an
> accusation.

The other eight owner traps are not blue chips: wPNH's owner minted 21,563,882
tokens and sold them into the same pool, and the identical exit then paid
**0.77%** of what it had. PP's paid **0.47%**. E3D's paid **0%**.

## Measured against the scanners judges already know

The catalogue was run through GoPlus (the check most wallets embed) and
honeypot.is (which simulates its own buy and sell), and the answers recorded
beside the executed verdicts — both directions of disagreement, dated, never
touching a verdict. 206 addresses carry a scanner reading.

| Question | Agreement | Sidik-only | Scanner-only |
|---|---|---|---|
| Buy tax (GoPlus) | **185 / 185** | 0 | 0 |
| Buy tax (honeypot.is) | 188 / 190 | 2 — 7SiN 2.99%, ROOTED 6.99% | 0 |
| Honeypot (honeypot.is) | 186 / 193 | 1 — DEAI | 6 |
| Honeypot (GoPlus) | 141 / 147 | 3 — Anastasia, TZ, ROOTED | 3 |
| Owner can trap (GoPlus) | **12 / 42** | **21** | 9 |

Read that table honestly and it says two things at once. **Where the scanners
are strong, they are excellent** — buy tax is a solved problem and GoPlus
solved it. **Where the question is "what could a privileged address still
do?", inference and execution part company almost entirely.** The 21
Sidik-only owner traps include every one of the proxies.

Scanners describe today; verdicts describe the pinned block. So the disputed
addresses were re-forked at the head of the day and sold again — that is the
only thing that separates "the token changed" from "the scanner is wrong". The
catalogue has a filter for every row where a scanner and the fork disagree.

## Why this is not another risk scanner

Several strong entries in this field also refuse to take a model's word for
things, and they deserve the credit: Fork replays a Moonwell governance change
on a real Base fork, Delivered pays for x402 endpoints and checks what actually
arrived, Drift-d publishes that its own signal performs worse than chance.
"Receipts, not opinions" is no longer a differentiator by itself.

What separates Sidik is how many times it has been made to hold:

- **A live run, hosted.** Paste any Base address and Sidik forks the chain and
  executes the probes while you watch. Getting there meant giving up on
  container hosts — Fly wants a card, Hugging Face Spaces a paid tier — and
  putting Foundry inside a serverless function instead: the release downloads
  into `/tmp` in under a second and anvil spawns there exactly as it does on a
  laptop. The recorded catalogue is still the default, because it answers
  instantly and cannot be rate-limited.
- **207 addresses**, not one protocol or one proposal.
- **1,843 fork transactions** mined across six probes.
- The whole catalogue **re-recorded end to end** after the owner-switch probe
  was added, rather than patched.
- Every disagreement with two independent scanners **published in both
  directions**, including the ones where the scanner wins.
- A **reproduce** command that re-forks Base at the same block with your own
  RPC and diffs the result against what is published. It runs in CI on every
  push.
- Provenance on every JSON body: recording date, engine commit, and a sha256
  of the catalogue you can recompute from a checkout.

The entries that infer — scoring tokens by holder distribution, tax mechanics,
rug surface, proxy slots — are doing the thing this project measured. The
203-of-206 number is the reply.

## What it found (counted, not estimated)

- **207 Base addresses** probed end to end, **1,843 fork transactions** mined
- **68 fail at least one probe**, 29 pass everything that applied, 110 come
  back N/A
- The findings: **37 LP rugs, 25 owner traps, 18 hidden fees, 7 honeypots,
  1 drainable wallet** (a token can fail more than one)
- 116 trade on Uniswap V3, 88 on V2
- The owner-switch probe applied to 56 addresses: 25 failed, 17 passed, 14
  could not be answered; on 148 it did not apply at all
- **6 tickers are claimed by more than one contract** — four separate contracts
  on Base call themselves BRIAN, three call themselves CRASH — and their
  verdicts differ. Picking a token by its ticker can pick the wrong one.

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
  "Not probed" and "nothing found wrong" are different sentences. The MCP tools
  repeat that sentence in their own descriptions, because a model reading a
  tool description is the reader most likely to skip the docs.
- The left-hand column is labelled "What a buyer assumes", not "Claimed".
  Sidik never reads a project's site or docs, so it has no claim to quote.
- A probe that finds no mechanism to test says so, with the number it searched
  for, and is marked as not applying rather than counted as a failure.
- Where it cannot establish *who* is allowed to pull a switch — a token with no
  `owner()` at all — it returns N/A, not PASS. All it proved there is that a
  stranger could not, and a PASS would be a verdict with no evidence.
- A reverted sell is not the end of the honeypot question. The probe retries a
  tenth of the position, waits out a cooldown, and measures whether the token
  skims plain transfers. 7SiN and ROOTED take 2.99% and 6.99% off every
  transfer, and Uniswap V3 rejects a swap whose input arrives short — the
  holder still cannot sell, so the verdict stays FAIL, but the title names the
  mechanism instead of implying a trap the run never established.
- A stranger's call that does not revert is not proof the switch is open. One
  token let anyone call `blacklist(address)` without reverting and the sell
  still worked: the call did nothing.

## Reproducibility, stated as a number

`pnpm --filter @sidik/engine reproduce <address>` re-forks Base at the same
block with your own archive RPC, re-executes the probes, and diffs the result
against what is published for that address. `--sample N` does it for a spread
of the catalogue. It runs in CI on every push.

Run fresh on **2026-08-31**, against the re-recorded catalogue:

```
pnpm --filter @sidik/engine reproduce --sample 3
→ 9 verdict(s) reproduced, 0 differed.
```

Three addresses drawn across the catalogue, every probe re-executed on a new
fork at block 50,200,000, every verdict identical to the published one —
including the LP-rug verdicts the new pool-birth search produces, which is the
part that had just changed. Anyone with a Base archive RPC can run the same
command against any address in the catalogue and get the same answer.

The catalogue was re-recorded end to end after the owner-switch probe was
added, widened to 207, and re-recorded again when the LP-rug probe learned to
find a pool's launch position — every verdict regenerated rather than patched,
so the published catalogue and the current probe set are the same generation of
code. That rule is enforced rather than remembered: the generator refuses to
leave a run behind that was produced by an older way of measuring.

## Honest limits

State these; the field rewards it.

- The public site **replays recorded runs by default, and can execute a new
  one on request**: `/run?token=0x…&live=1` forks Base and runs the probes
  while you watch, in about thirty seconds, for any address at all. It took
  until the last day to find a host that would do it. Fly wants a card and
  Hugging Face Spaces wants a paid tier, so the answer was not a container
  host: a serverless function downloads the Foundry release into `/tmp` in
  under a second and spawns anvil there. The recorded catalogue stays the
  default because a replay answers instantly and cannot be rate-limited, and
  because 207 runs executed under controlled conditions are a better body of
  evidence than one run executed under a judge's impatience.
- **110 of 207 addresses come back N/A.** It used to be 130, and the single
  largest cause was our own search window rather than anything about the
  tokens: the LP-rug probe looked for a V3 position in a 9,000-block window —
  about five hours on Base — and 98 pools were funded once at launch, months
  before the pinned block. So 98 rows said "no position could be found", which
  is a fact about where Sidik looked wearing the clothes of a fact about the
  pool.

  That is fixed. The probe now bisects `getCode` for the block the pool was
  created in and searches there too, and the catalogue was re-recorded against
  it: **"no position could be found" fell from 98 to 10**, 73 rows now name the
  contract that actually holds the liquidity, and 8 more pools turned out to be
  drainable by a single holder. This entry had previously recorded that the fix
  was measured and unaffordable — ~26 sequential archive reads per token, one
  token unfinished after twelve minutes. That measurement was of the fork proxy
  the reads were routed through, not of the reads: straight at a public Base
  RPC the same search takes about nine seconds.

  What remains is 62 pools whose position sits inside a contract. Impersonating
  that contract would prove nothing — anvil runs the caller, not the contract's
  rules — so the probe knocks on the front door instead: it reads the
  contract's `owner()`, impersonates them, calls the contract's own ways out,
  and reads whether the liquidity moved. On **36** of those it did not, and the
  verdict says so. **11 more turned out to be a real locker** — a Sourcify-
  verified `UniV3LPLocker` whose `unlock()` requires a deadline the contract
  enforces — and those are now a PASS rather than a shrug.

  None of the 36 became a finding. That is the result, reported as it came:
  the launchpad contract holding 26 of them exposes a `withdraw`, its owner was
  made to call it, and the position did not move.
- Probes trade through Uniswap V2 and V3 only. A token whose liquidity lives on
  Aerodrome comes back N/A, with the reason attached.
- Three Base contracts (CLANKER, ELENA, WIFHAIR) hold a single byte of code,
  `0xef`, which is not a valid EVM opcode. Public nodes answer for them anyway;
  a fork cannot. Reported as unprobeable, not as safe.
- The scanner readings describe the day they were taken, not the pinned fork
  block. That is why disputed addresses are re-forked at the head of day.

## Links to paste

| Field | Value |
|---|---|
| Website / demo | https://sidik-eight.vercel.app |
| The one page to put in front of a judge | https://sidik-eight.vercel.app/findings |
| GitHub | https://github.com/PugarHuda/sidik |
| Catalogue (deep link worth showing a judge) | https://sidik-eight.vercel.app/catalogue?filter=ownerTrap |
| The single best run to open first | https://sidik-eight.vercel.app/run?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed |
| The one that will start an argument | https://sidik-eight.vercel.app/run?token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| Machine-readable proof | https://sidik-eight.vercel.app/api/token/0x48F617e5b1B214a90800348D7944bBc0E9290Fbb |
| The whole catalogue as data | https://sidik-eight.vercel.app/api/catalogue |
| What the data means, for an agent | https://sidik-eight.vercel.app/llms.txt |
| X profile | **you must create this** |
| Discord or Telegram | **you must create this** |

## Still yours to do

Nothing in this list can be done from the repository.

1. **X profile** — required field, no entry without it.
2. **Discord or Telegram handle** — one of the two is required.

   The copy for both is written and ready to paste: **[docs/ACCOUNTS.md](ACCOUNTS.md)**
   — handle, bio, three posts for X, and the channel description and pinned
   message for Telegram. Telegram over Discord: a channel is one field and
   needs no moderation, where an empty Discord reads worse than none.

3. **Submit from the registered wallet** (already registered as Pugar Huda
   Mantoro; registration was signature-only and is done) and pay the **~$10 ETH
   ignition fee on Base**. Platform fee, not a stake, not refundable.
4. **Rotate `VENICE_API_KEY`.** It was pasted into a chat transcript. It has
   never been committed — verified against the full git history — but a
   transcript is a leak. Replace it in `engine/.env` and any host config.
5. **Submit early rather than polished.** Upvotes inform the judges and the
   leaders are already in the teens; an entry that lands three days late starts
   at zero regardless of how good it is.

## A judge's two-minute path

Give them this, in order. Add `&instant=1` to any run link to skip the paced
replay.

0. https://sidik-eight.vercel.app/findings — **open this first if they only
   open one thing.** Three measured results of executing the whole catalogue,
   each with its method and a link to the rows behind it: verified source is
   not safety, inference agrees about tax and not about power, and a token can
   pass every trade test and still have an exit its owner controls. It also
   names the one comparison Sidik loses, which is the point. Every figure on
   it is counted from the catalogue at build time, so it cannot go stale.
1. https://sidik-eight.vercel.app/run?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed
   — **DEGEN**, and the best two minutes this project has. A top-tier Base
   token that passes every trade test: the buy lands, the sell lands, no hidden
   fee, the pool prices it like the wider market. Then the owner-switch probe
   impersonates its owner, calls `pause()`, and makes the identical sell again —
   and it reverts. 0.9801 WETH before, a revert after. Nothing about that says
   the owner will do it. It says the holder's exit is the owner's to decide.
2. https://sidik-eight.vercel.app/run?token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
   — **USDC**, if they have appetite for it. Same probe, same result, and the
   page is careful to say that a proxy admin existing is a design, not a
   scandal. This is the one that makes people argue, which is why it is second
   and not first.
3. https://sidik-eight.vercel.app/run?token=0x48F617e5b1B214a90800348D7944bBc0E9290Fbb
   — Anastasia. The buy lands, the sell reverts with
   `TransferHelper: TRANSFER_FROM_FAILED`, and that string is the evidence. Its
   source is published and verified, like 59 of the 60 Sidik caught.
4. https://sidik-eight.vercel.app/catalogue?filter=ownerTrap — every token whose
   owner can still trap a holder, then `?filter=scannerDisagrees` for the rows
   where a scanner and the fork part ways.
5. `curl https://sidik-eight.vercel.app/api/token/<address>` — the same verdict
   as JSON, carrying `forkBlock` and `transactionsWereBroadcast: false`.
   `/api/catalogue` for the list, `/llms.txt` for what it all means.
6. And if they doubt any of it:
   `pnpm --filter @sidik/engine reproduce 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed`
   forks Base at the same block with their own RPC and tells them whether the
   published verdict comes back.

---

## Ready-to-paste submission description

Paste this into the entry description field. It is written for the AI vetting
pass as much as for a human: concrete, counted, and explicit about its limits.

**Read [SUBMIT-FORM.md](SUBMIT-FORM.md) first.** The text below describes the
live run, which is built and pushed but was not deployed at the time of
writing — the Vercel account hit its daily deployment limit. If you submit
before it is live, use Version A there instead, which is this text with the
live-run paragraph removed. Describing something a judge cannot open is the
one mistake this entry cannot afford to make.

> Sidik proves what a Base ERC-20 does to a buyer by doing it, rather than
> inferring risk from bytecode. Given an address, it forks Base mainnet at a
> pinned block with anvil and executes six probes as real transactions: it buys
> and sells (honeypot), measures buy, sell and transfer separately and again a
> day later in fork time (hidden fee), grants an allowance and drains it
> (approval drain), classifies the LP holder and impersonates it to pull the
> pool (LP rug), compares pool pricing against BingX and Gate (cross-venue),
> and impersonates the privileged address to pull every ownership switch it can
> find, then makes the identical sell again (owner trap). Every verdict is
> decided by deterministic code reading the result of a mined transaction. The
> model orders the probes and writes the prose; a numeric guard rejects any
> figure that does not appear verbatim in the run data, so it cannot invent a
> verdict, a hash or a number.
>
> Paste any Base address and it will fork the chain and execute the probes
> while you watch, in about thirty seconds; the 207 already recorded answer
> instantly instead. Hosting that meant abandoning container hosts and putting
> Foundry inside a serverless function, which is the difference between an
> agent you can read about and one you can point at your own token.
>
> The same run is a pre-listing check. Can it be sold, does the trade get
> skimmed, can the pool be emptied, can one address close the exit — those are
> the questions an exchange or a launchpad answers before a token goes live,
> and they are the four this executes rather than estimates. It never scores a
> token or says whether to list it; it reports what happened when it tried.
>
> The catalogue is 207 Base addresses and 1,843 fork transactions. 68 fail at
> least one probe: 37 LP rugs, 25 owner traps, 18 hidden fees, 7 honeypots, 1
> drainable wallet. 29 pass everything that applied; 110 return N/A — always
> reported as "not answered", never as "safe". The largest cause of N/A used to
> be the LP-rug probe failing to find a V3 position in its own search window;
> that was our limitation rather than the chain's, and fixing it turned 88 of
> those rows into statements about the pool.
>
> The finding the project exists for: 203 of the 206 checkable addresses publish verified
> source code, and so do 59 of the 60 with a finding against them. Sourcify,
> asked independently, holds 67 exact and 42 partial matches. "Check that the
> contract is verified" separates almost nothing on Base. The catalogue was
> also run through GoPlus and honeypot.is, with every disagreement published in
> both directions: on buy tax GoPlus matched the executed figure on 185 of 185
> addresses, and on whether a privileged address can still stop a holder from
> leaving it agreed on 12 of 42. 25 tokens have such an address, and 9 of them —
> including USDC, EURC, cbBTC and cbETH — pass every other probe. 17 of the 25 are
> proxy admins replacing the implementation. That is a proof of capability, not
> an accusation or a prediction, and the interface says so on the page.
>
> What it refuses to do is as deliberate as what it does. Fork transactions are
> never linked to a block explorer, because they were never broadcast. An
> address with no recorded run returns an error, never a clean bill of health.
> A probe with no mechanism to test returns N/A rather than PASS. The public
> site replays the recorded catalogue by default, because a replay answers
> instantly and cannot be rate-limited, and executes a fresh run on request.
> The recorded runs are genuine output of the engine in this repository,
> frozen, and `pnpm --filter @sidik/engine reproduce <address>` re-forks Base
> at the same block with your own RPC and diffs the result against what is
> published. It runs in CI on every push.
>
> Reproducibility is the claim it stakes everything on, so it is stated as a
> number rather than a promise: `reproduce --sample 3` re-forked Base at the
> same block and returned 9 verdicts reproduced, 0 differed. All three
> findings, each with its method and the rows behind it, are at
> /findings — including the one comparison Sidik loses.
>
> Every surface is machine-readable: JSON per address and for the catalogue,
> an OpenAPI 3.1 schema, an llms.txt, provenance on every body (recording date,
> engine commit, sha256 of the catalogue), and an MCP server over Streamable
> HTTP exposing sidik_token, sidik_catalogue and sidik_run, so an agent asked
> "is this token safe?" can call a fork execution instead of a scanner.
