# Sidik

[![CI](https://github.com/PugarHuda/sidik/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/PugarHuda/sidik/actions/workflows/ci.yml)

**Sidik** (Indonesian: *to investigate / detect* — *sidik jari* = fingerprint)
is an agent that proves what a Base token will actually do to you, by doing
it — on a forked mainnet sandbox, in real time, in front of you.

## Try it

**[sidik-eight.vercel.app](https://sidik-eight.vercel.app)**

If you read one page, read
**[/findings](https://sidik-eight.vercel.app/findings)** — the three measured
results of executing the whole catalogue, each with its method, the rows
behind it, and the one comparison Sidik loses.

The live site replays runs that already happened: every token in it was
bought, sold and transferred against a fork of Base at a pinned block, and
what you see is that run's own event stream, tx hashes and all. It carries no
engine, so an address outside the recorded set is answered with an error
rather than a guess — the engine is what probes arbitrary addresses live, and
deploying one is optional (see Deployment).

## The thesis: prove by executing

Every other token-safety tool is read-only analytics: it infers risk from
bytecode or holder graphs and prints a score. Sidik crosses the line almost
nothing crosses in a hackathon timeframe — it **executes** the attack on a
forked copy of Base mainnet and shows you what actually happens.

- Read-only tools tell you a token *might* be a honeypot.
- Sidik forks Base at a real block, buys the token with a funded test
  wallet, tries to sell it, and shows you the revert — with the fork tx hash
  and the raw verdict data behind it to back it up. Those hashes are shown as
  plain text, never as explorer links: the transactions were mined on a fork
  and never broadcast, so a Basescan page for them cannot exist, and sending
  a reader to an empty explorer page to check the central claim would be
  worse than showing nothing. The token address *is* linked, because that one
  is real.

**And reading the contract would not have caught these.** Of the 207 recorded
addresses, 203 of the 206 Blockscout could answer for publish verified source
code — and so do 59 of the 60 with a finding against them: every honeypot, every taxed token, every
ruggable pool, every owner trap and every upgradeable proxy. "Check that the contract is verified" is the
standard advice, and across this catalogue it separates almost nothing. That
number is measured, not asserted: see [Corroboration](#corroboration).

The verdict (`PASS` / `FAIL` / `N/A`) is produced entirely by deterministic
code reading the result of a real EVM transaction — never by an LLM. The LLM
only decides *what order to run the probes in* (planner) and *how to narrate
the results in prose* (narrator); it never invents a number or a verdict, and
it cannot drop a probe: anything applicable it leaves out of its answer is
appended to the plan. It used to be able to, and with six probes it started
doing so — a page missing a card looks exactly like a page where that check
passed.

Every figure on screen traces back to a real call on a real fork, and every
verdict exposes the fork tx hash it came from plus an expandable panel of the
raw data behind it — not a decoded call-trace view.

## Architecture

```
token address
  -> pre-scan (deterministic): is it an ERC-20? does it have a pool? owner? top holders?
  -> planner (LLM): ORDERS the applicable probes; anything it leaves out is
     appended, so it can never silently skip one
  -> executor: ONE anvil fork of Base for the run; each probe gets a snapshot
     of pristine state, executes real txs, and the chain is rolled back after it
     -> interpret (code, not LLM)
  -> narrator (LLM): writes prose from the finished verdicts; numbers are injected, never generated
  -> output: assumed-vs-proven table, fork tx hashes, an expandable
     raw-verdict-data panel, streamed live over SSE
```

Two packages, one shared types package:

- **`engine/`** — a small Hono server. `GET /run?token=0x...` streams the
  flow above as Server-Sent Events. `GET /health` for liveness. Spawns one
  `anvil` fork (via Foundry) per request against a Base archive RPC, runs
  every probe on it behind a snapshot, and tears the fork down.

  It used to spawn one fork *per probe* — seven processes for a six-probe
  token. Isolation is the same either way, because anvil's snapshot restores
  the chain exactly; what a fresh process cost was a fork-and-replay of
  archive state each time, and on a loaded machine it was enough to make
  Windows refuse to create the process at all. Verified equivalent before the
  change shipped: fourteen verdicts re-run under the new scheme against the
  runs recorded under the old one, twelve identical and the two differences
  both the intended cross-venue change.

  anvil is not handed the archive RPC directly. It forks through a loopback
  proxy (`engine/src/forkProxy.ts`) that forwards every call and answers
  anvil's own `anvil_nodeInfo` probe itself. Alchemy's gateway answers that
  probe — and any method it does not know — with HTTP 400, which anvil 1.7.1
  reads as the endpoint being down: "failed to determine network family from
  fork endpoint", and no fork at all. A key that had recorded the entire
  catalogue one day forked nothing the next. The proxy is one hop on
  127.0.0.1, passes upstream status codes through so anvil's 429 handling
  still works, and has no dependency.

  A snapshot id is **consumed** by the revert that uses it — rolling back to
  the same id twice silently does nothing — so every rollback takes a fresh
  one. `engine/test/ownerTrap.integration.test.ts` pins that against real
  anvil, because the failure mode is no error at all.
- **`web/`** — a Next.js demo app. `GET /api/run` proxies the engine's SSE
  stream straight through to the browser and renders the split view (what a
  buyer assumes vs. what the fork proved) live as events arrive. With no engine configured it replays the
  recorded runs in `shared/` instead (see below), so the demo works offline.
- **`shared/`** — the `Verdict` / `ForkClient` / probe types both sides
  import, the example-token list, and the recorded example runs, so the
  contract between engine and web can't silently drift.

## Local development

Requires Node >=24, [pnpm](https://pnpm.io), and
[Foundry](https://book.getfoundry.sh/getting-started/installation) (for
`anvil`) on your `PATH`.

```bash
pnpm install

# engine — needs BASE_ARCHIVE_RPC (a Base archive RPC, e.g. Alchemy free
# tier) in the environment to run real fork proofs, and optionally
# VENICE_API_KEY for the LLM prose. Runs on :8787.
pnpm dev:engine

# web — Next.js dev server. Without ENGINE_URL set it replays the recorded
# example runs instead of reaching an engine (see Deployment).
pnpm dev:web

# engine test suite (vitest) — 250 unit + 30 integration
pnpm test

# browser suite (Playwright) — 780 tests across chromium, firefox, webkit,
# and both mobile viewports, run against a production build. Includes an
# axe-core accessibility audit of every page.
pnpm e2e

# everything CI runs, in order: types, lint, dead code, dependency audit,
# unit tests, production build, browser suite.
pnpm check

# individually
pnpm typecheck   # both packages, strict + noUncheckedIndexedAccess
pnpm lint        # eslint (web)
pnpm deadcode    # knip — unused files, exports and dependencies
pnpm audit       # dependency advisories
pnpm coverage    # unit-test coverage (v8)

# re-record the example runs against a real fork (needs BASE_ARCHIVE_RPC).
# Run this after changing EXAMPLES or BASE_FORK_BLOCK.
pnpm --filter @sidik/engine fixtures

# integration suites — real anvil forks of Base and real venue APIs. Skipped
# entirely when BASE_ARCHIVE_RPC is unset, which is how CI behaves on a fork PR.
pnpm --filter @sidik/engine test:integration
```

### Reproducibility: the pinned fork block

`BASE_FORK_BLOCK` (see `engine/src/forkBlock.ts`) pins every fork to a fixed,
known-good Base block instead of "latest". Without a pin, a demo run against
a live chain tip is not reproducible — token balances, pool liquidity, and
even contract behavior can shift between runs. Pinning means the same token
address produces the same verdict every time, which is what lets the demo
examples be pre-verified rather than "probably still works." Override with
`BASE_FORK_BLOCK=<blockNumber>` if you need a different pin (e.g. a block
close to a specific incident).

## The probes

Each one runs against pristine forked state — a snapshot taken before it and
rolled back after — and each decides `PASS` / `FAIL` / `N/A` from what a
transaction did, never from an opinion about the code.

| Probe | What it executes |
|---|---|
| `honeypot` | Buys, then sells. Measures the proceeds against the pool's own quote, so a sell that succeeds and pays nothing is not a pass. A reverted buy is retried at a tenth and a hundredth of the size and reported with its revert reason — a trading-disabled or max-tx trap is a finding, not "no liquidity". A reverted sell is retried after one hour and one day of fork time, so a cooldown reads as a cooldown. A wallet the buyer transferred to also sells, which is how a buyer-whitelist honeypot shows itself. |
| `hiddenFee` | Measures buy, sell and `transfer()` separately, and sells again a day later in fork time, so a tax that decays or climbs is reported as two numbers. On V2 the sell proceeds are read from the router's own `Swap` log — a token's tax `swapBack` in the same transaction is no longer counted as the holder's payout. |
| `lpRug` | Finds the LP holder, classifies it before impersonating it — an EOA, an EIP-7702 account, a Safe, the UNCX locker, or an unknown contract — and pulls the pool out from under the position. Locked LP is reported with its unlock date; burned LP is proved unpullable in two reads. On Uniswap V3 it finds the largest position NFT and pulls that through the position manager. |
| `ownerTrap` | Buys, snapshots, sells once to prove selling works, rolls back, then lets the owner pull every switch in its bytecode and sells again from identical state. Fee setters are tried down a ladder (99 → 10%) and the rung the contract accepts is the fee the owner can set on demand. For a proxy, the scan reads the implementation's bytecode, and the recorded admin is made to replace the code with a contract that reverts everything — then the sell is tried again. |
| `approvalDrain` | For a wallet: exercises its live approvals to see what a compromised spender could take. |
| `crossVenue` | Compares what the buy cost inside the pool against what the same asset traded at on venues with no relationship to it, in the same hour. |

`ownerTrap` is the one that answers a question reading the source cannot: not
what the token does today, but what one address can still decide to do to you
after you have bought. It reads the owner-only switches straight out of the
deployed bytecode — the PUSH4 constants a solc dispatcher compares against, so
they are there whether or not the source was ever published — and then calls
them. 56 of the 207 recorded addresses carry something an owner can operate
— a switch, or a proxy whose admin can replace the code outright — and 24 of
those failed when it was operated. Sixteen are proxies: USDC, cbBTC and cbETH
among them, where the recorded admin was made to point the proxy at a contract
that reverts everything, and the sell that had just worked stopped working.
That is not an accusation, it is what the contract permits, executed. Where
`mint` exists, Sidik has the owner print supply and sell it into the same pool
the holder has to exit through, and reports what the exit was worth before and
after.

Absence is reported as absence. A token carrying none of the switches Sidik
knows how to operate gets `N/A` with the number it searched for, not a `PASS`
— a bytecode scan cannot prove there is no privileged code under a name
nobody has seen before. What it does carry is named: every PUSH4 selector
across the recorded bytecodes was resolved through the 4byte signature
database (922 of 1,152), and functions that look privileged but that Sidik
has no hostile arguments for are listed on the verdict as found-not-operated.
A renounced owner is not taken on faith either: `unlock()` in the bytecode
means a timed lock, and the verdict says so instead of `PASS`.

## Venue coverage, and a boundary that is not fixable

Probes trade on **Uniswap V2 and V3**. The pre-scan measures both and routes
each token to whichever pool actually holds the liquidity (`scan.venue`,
`scan.poolFee`), which is what lets BRETT, TOSHI and DEGEN — each with under
0.2 WETH left on V2 and hundreds on V3 — return a real verdict instead of "no
liquidity to test". Aerodrome is not covered; when Uniswap has no pool the
pre-scan asks DEX Screener where the liquidity is, and the `N/A` names the
venue and its depth (`scan.otherVenues`) rather than saying "no liquidity"
about a token with a million dollars on Aerodrome Slipstream.

The second boundary is structural rather than fixable. A family of Base tokens
living at `0xb2…` addresses — CLANKER among them — has exactly one byte of
code on chain, `0xef`, which is not a valid EVM opcode. Both Alchemy and
Base's own public RPC answer `symbol()` for them anyway, so the node is
serving these calls outside ordinary EVM execution. anvil can only run what
the code says, so a fork of such a token reverts on every read. Sidik cannot
probe them by executing them, and executing them is the whole point — so it
declines rather than guessing.

## What "assumed" means

The left-hand column is not a quote. Sidik never reads a token's website, its
docs or its metadata, so it has nothing the project actually said to compare
against. That column is the default any listed ERC-20 implies simply by being
tradable: that you can sell what you bought, that a transfer delivers what it
says, that the pool is not one address away from being emptied.

It used to be labelled "claimed", which reads as though the token had made a
promise Sidik caught it breaking. Putting words in a contract's mouth is
exactly the kind of shortcut this tool exists to argue against, so the column
says what it is.

## Recorded runs

`shared/src/fixtures.ts` holds real runs, frozen: the actual event stream each
token produced against a fork at `BASE_FORK_BLOCK`, tx hashes and all. They
are not stand-ins for a run — they *are* runs.

```bash
# re-record the example tokens only
pnpm --filter @sidik/engine fixtures

# also discover and record the N most liquid Uniswap V2 tokens on Base
SIDIK_CATALOG=120 pnpm --filter @sidik/engine fixtures
```

Two things they buy:

- **The engine answers a known token without touching the network** — it seeds
  them into the cache it already replays from. Measured at 64ms versus 13.5s
  for a live run. That matters because every live run spawns one fork per
  probe, and a free-tier archive RPC returns 429 once forks overlap.
- **The demo works with no engine at all.** With `ENGINE_URL` unset, web
  replays them; an address with no recorded run gets an explicit error rather
  than an invented answer.

The generator refuses to freeze a run that broke rather than reached a verdict
— an RPC 429 mid-fork surfaces as an `N/A` verdict, not an error, and would
otherwise be frozen looking like a finding about the token. It is safe to
interrupt and re-run: it skips what is already recorded for the current fork
block and writes after every token.

Adding a probe means re-recording, because a catalogue has to be one probe
set's output — a page where some rows were asked a question and others
silently were not is indistinguishable from the question having been asked
and answered:

```bash
# re-run only the recorded runs that predate the current probe set
SIDIK_RERECORD=1 pnpm --filter @sidik/engine fixtures
```

That converges rather than starting over: 207 tokens is roughly a thousand
anvil forks, Windows stops creating processes long before that (0xC0000142),
and each restart picks up only what is still stale.

## Corroboration

Two things sit beside the verdicts and are deliberately not part of them.
Every finding comes from a transaction mined on a fork; nothing below can
change one.

**Verified source code.** `shared/src/verification.ts` records, per address,
whether Blockscout holds published verified source for it — 203 of the 206 it
could answer for do, as do 59 of the 60 with a finding against them. It is here because it answers the
obvious objection to the whole project: no, reading the contract first would
not have caught these. Sourcify is asked the same question independently
(`SOURCIFY_STATS`: exact and partial matches counted separately, an exact
match including the metadata hash), and where a verifier records the
deploying address it is shown as a fact with a Basescan link — never as a
cluster or a signal.

```bash
# re-read Blockscout for any address not already recorded
pnpm --filter @sidik/engine verification
# SIDIK_REVERIFY=1 re-reads every address instead
```

**Independent venues.** A token you cannot sell cannot sustain a market
somewhere with no relationship to its pool, so a listing supports a `PASS`
and would be alarming next to a `FAIL`. Sidik asks two, matched two different
ways:

- **BingX** publishes tickers and no contract addresses, so those ten pairs
  are matched **by hand**. Exchange symbols collide constantly — this
  catalogue shares DOS, MON, SYS, HYPER and BSV with unrelated coins — and
  claiming "this Base token is listed" about a different coin with the same
  three letters is the exact false claim this project argues against.
- **Gate** publishes the contract address behind every ticker, per chain, so
  those pairs are matched **by address** and the exchange itself asserts the
  pairing. Where both venues cover an address, Gate is used to audit the hand
  matching: it confirms 7 of the 10 and contradicts none, and the generator
  refuses to write a file where they disagree.

**Read-only scanners.** `shared/src/scanners.ts` records what GoPlus — the
check most wallets embed — and honeypot.is, which runs a simulation of its
own, say about each recorded address, and `SCANNER_STATS` counts how that
lines up with what was executed. Both directions are listed, because a
comparison that shows only the flattering half is not one:

- Honeypots, against GoPlus (131 addresses where both answered): 125 agree.
  Execution caught three GoPlus cleared — Anastasia, ROOTED, and TZ, whose
  pool holds WETH but whose buy reverts at every size tried. GoPlus flagged
  three the fork sold: NVO, ANSEMCAT, CASHCAT.
- Honeypots, against honeypot.is (179): 173 agree, and every disagreement is
  honeypot.is flagging a token the fork sold — DGAI, FOLD, COBIE, Alpe,
  KEYCAT, VLTX. The scanners describe the chain on the day they were asked
  and the verdicts describe block 50,200,000, so a token that changed in
  between would look exactly like a scanner being wrong. Execution settles
  that too: `pnpm --filter @sidik/engine recheck` forks **today's head** and
  runs the sell again. On 2026-08-28, 8.6–8.8 days after the pin, every one
  of the twelve disputed addresses was re-executed at that day's head (blocks
  50,572,271 and 50,579,458): Anastasia and ROOTED still could not sell, TZ
  still could not be bought, and the other nine still sold — so those flags
  were wrong that day, not stale. The result is recorded per
  address in `shared/src/rechecks.ts`, shown on the run page and served under
  `corroboration.recheck` in the JSON.
  (COBIE is the token whose owner Sidik proved *could* stop the sell; they
  had not.)
- Owner traps, against GoPlus's `transfer_pausable` / `is_blacklisted` /
  `is_mintable` flags (38): 9 agree. GoPlus did not flag DEGEN or XYJ, whose
  owners' `pause()` stopped the sell on the fork, nor PP, whose owner minted
  ten billion tokens and sold them — nor any of the sixteen proxies (USDC,
  cbBTC, cbETH, USDbC among them) whose admin can replace every byte of code,
  which Sidik did, and the sell stopped. It flagged nine whose switches are
  dead — ownership renounced, the call reverted — BRETT among them. It flags
  that the code exists; Sidik reports what pulling it did.
- Buy tax, where the scanners are on their strongest ground: GoPlus's figure
  matched the executed one on **164 of 164** addresses, within a percentage
  point. honeypot.is matched on 175 of 177 and missed the two it could not
  simulate — 7SiN and ROOTED, the fee-on-transfer tokens on V3, reported at
  0% where the fork measured 2.99% and 6.99%. A comparison that only showed
  the rows execution wins would not be one.

Every reading is dated, shown per token on the run page and in the JSON, and
changes no verdict.

```bash
pnpm --filter @sidik/engine scanners      # ask both scanners about anything not yet recorded
# SIDIK_RESCAN=1 re-asks every address
pnpm --filter @sidik/engine recheck COBIE 0x...   # re-run the sell at today's head
```

`crossVenue` prices the buy against every venue that quotes the token in the
hour containing the fork block, requires that hour to have carried at least
$1,000 of real volume, and lets the venue most favourable to the token decide
the verdict while showing what each one said.

```bash
pnpm --filter @sidik/engine listings
```

## Check it yourself

The site serves recorded runs, so "these are real runs, not mock data" is a
claim you have no reason to take on trust. This is how you check it:

```bash
# fork Base at the same block, execute the same probes, diff the result
# against what is published for that address
pnpm --filter @sidik/engine reproduce 0x48F617e5b1B214a90800348D7944bBc0E9290Fbb

pnpm --filter @sidik/engine reproduce --sample 10   # spread across the catalogue
pnpm --filter @sidik/engine reproduce --all
```

Needs your own `BASE_ARCHIVE_RPC` and nothing else. It exits non-zero if any
verdict differs, so it is a gate as much as a demonstration. Two things are
deliberately not compared, and it says so: the narration, which is model prose
and varies by design, and the transaction hashes, because the planner asks a
model what order to run the probes in and a different order means different
nonces for the same work. Everything a verdict actually asserts — its status,
its title and every row of its table — is compared exactly.

### The live-engine path, from a browser

Every browser test above runs the replay path, because that is what the
public site serves. The path a deployed engine takes — browser, `/api/run`,
the engine's SSE stream, anvil — is exercised by one more spec that needs a
running engine, so it is opt-in:

```bash
pnpm --filter @sidik/engine start                       # :8787, needs BASE_ARCHIVE_RPC
ENGINE_URL=http://127.0.0.1:8787 pnpm --filter web start -p 3213
SIDIK_LIVE_E2E=1 SIDIK_E2E_URL=http://127.0.0.1:3213   pnpm --filter web exec playwright test e2e/live-engine.spec.ts --project=chromium
```

It executes a token that is not in the catalogue (the engine seeds its cache
from the catalogue, so a recorded address would be replayed in milliseconds
and prove nothing), checks that verdicts arrive one at a time rather than all
at once, that the second request is answered from cache, and that a third
concurrent run against the engine's cap of two comes back as a well-formed
"busy" error frame rather than a page that waits forever.

## For agents and other programs

The catalogue is structured data that happens to be rendered as a page. It is
also available as data:

| Endpoint | What it answers |
|---|---|
| `GET /api/catalogue` | Every recorded address, paged. `?filter=` (`all`, `failing`, `honeypot`, `hiddenFee`, `lpRug`, `ownerTrap`), `?q=` (symbol or address), `?page=`. |
| `GET /api/token/<address>` | The full recorded run: every verdict, row, measured figure, the fork block and the narration. **404 when the address has no recorded run** — which is not the same answer as "nothing found wrong". |
| `GET /api/run?token=<address>` | The same run as a Server-Sent Event stream, in the order the probes produced it. |
| `GET /llms.txt` | What the data means, and the two things a consumer will otherwise get wrong. |
| `GET /openapi.json` | OpenAPI 3.1 for the JSON endpoints, Verdict schema included. Every JSON body carries `schemaVersion`, `chainId` and `provenance` (recording date, engine commit, catalogue sha256, site commit). CORS-open. |
| `POST /mcp` (engine, self-hosted) | The engine as a [Model Context Protocol](https://modelcontextprotocol.io) server over Streamable HTTP — `pnpm dev:engine`, then `claude mcp add --transport http sidik http://localhost:8787/mcp`. Tools: `sidik_token` (executed verdicts for an address), `sidik_catalogue` (paged, filtered), `sidik_run` (execute the probes now on a fresh fork). No SDK: the protocol Sidik speaks is `engine/src/mcp.ts`, tested end to end through Hono. There is no hosted engine: forking Base needs an archive RPC and real compute, and no free tier runs it — see [Deployment](#deployment) to stand one up. |
| `GET /api/og?token=<address>` | The 1200x630 card a shared link unfurls into, carrying that token's verdict. |

Corroboration always travels in its own `corroboration` field, never inside a
probe result, so nothing a third party said can be mistaken for something
Sidik executed.

## Deployment

Deploying is two independent pieces: the **engine** (a long-running
container — it shells out to `anvil`, so it needs a real host, not a
serverless function) and the **web app** (a normal Next.js app on Vercel).
**These deploy steps require your own Railway/Vercel accounts and secrets —
they are not run as part of this repository's automation.**

The engine got materially cheaper to host than it used to be. A run once
spawned one `anvil` per probe — seven processes and seven fork-and-replays of
Base archive state for a six-probe token — and now spawns one for the whole
run. A free tier that could not have carried the old shape may carry this one;
the honest limit is memory, since a single anvil holding forked Base state is
the floor, and there is no way to know but to try.

### 1. Engine → Railway (or Fly.io / Render / any Docker host)

`engine/Dockerfile` builds a self-contained image: `node:24-bookworm-slim` +
Foundry (`anvil` on `PATH`) + the `shared`+`engine` workspace packages
(`web/` is deliberately not copied into this image — it deploys separately).

```bash
# from the repo root (the Dockerfile needs the workspace root as build context)
docker build -f engine/Dockerfile -t sidik-engine .
```

The image is verified: built and run locally on 2026-08-21, serving a
recorded example in 64ms and completing a live three-probe fork run against
Base in 13.5s inside the container.

On Fly.io, `engine/fly.toml` carries the deploy commands in its header. On
Railway: create a new service from this repo, set the Dockerfile path to
`engine/Dockerfile` with the **repo root** as the build context, and set the
environment variables below. Either way, confirm `https://<your-host>/health`
returns `{"ok":true}` — that's the URL you'll use as `ENGINE_URL`.

**Required env vars (engine host):**

| Var | Required | Purpose |
|---|---|---|
| `BASE_ARCHIVE_RPC` | yes | Base archive-node RPC URL (e.g. Alchemy free tier) — `anvil --fork-url` forks from this |
| `VENICE_API_KEY` | no | Venice AI key — the planner and narrator calls run through it (`claude-sonnet-5`, OpenAI-compatible endpoint) |
| `SIDIK_MODEL` | no | Overrides the model id, default `claude-sonnet-5` |
| `BASE_FORK_BLOCK` | no | Pins the fork to a specific block for reproducible demo runs; defaults to a hardcoded recent block (see `engine/src/forkBlock.ts`) |
| `WEB_ORIGIN` | no | Restricts CORS to one origin, e.g. `https://sidik-eight.vercel.app`. Defaults to `*`, which lets any site spend your RPC quota |
| `SIDIK_MAX_CONCURRENT_RUNS` | no | Runs allowed in flight at once, default `2`. Beyond it `/run` returns 503 rather than handing everyone rate-limited forks |
| `PORT` | no | Defaults to `8787` |
| `BASE_LOGS_RPC` | no | Endpoint for historical `eth_getLogs`, default `https://mainnet.base.org`. Alchemy's free tier caps a single range at 10 blocks, which makes the approval and holder scans useless |
| `BINGX_BASE_URL` | no | Overrides the BingX public market-data host used by the cross-venue probe |
| `VENICE_BASE_URL` | no | Overrides the Venice API base URL |

`BASE_ARCHIVE_RPC` is the only hard requirement: without it there is no fork
and nothing can be proven. `VENICE_API_KEY` is not. Every verdict is
produced by deterministic code, so the LLM only orders the probes and writes
the prose around them — with the gateway unreachable or unauthorized, the
planner falls back to running every applicable probe and the narrator to a
summary built from the verdicts themselves. A run with no LLM at all still
streams real verdicts with real tx hashes.

### 2. Web → Vercel

Set the project's **Root Directory** to `web` and deploy from the **repo
root** — `web/` alone is not enough, because it imports `@sidik/shared` from
the workspace and an upload scoped to `web/` cannot resolve it. No
`vercel.json` is needed beyond that. Add:

| Var | Required | Purpose |
|---|---|---|
| `ENGINE_URL` | yes (for real runs) | Public URL of the deployed engine, e.g. `https://sidik-engine.up.railway.app` (no trailing slash). Requests to it time out after 180s and surface as an SSE `error` frame, never as a hung page |
| `NEXT_PUBLIC_SITE_URL` | no | Absolute origin used in `sitemap.xml` and `robots.txt`, default `https://sidik-eight.vercel.app` |

**Without `ENGINE_URL` set, `/api/run` replays the recorded example runs**
in `shared/src/fixtures.ts` — **including in production.** Those are the real
output of real fork runs, generated by `pnpm --filter @sidik/engine fixtures`,
not invented verdicts, so the UI labels them "recorded run" rather than
"simulated". An address with no recorded run gets an explicit error instead of
a made-up answer. This is an intentional offline fallback (the page is always
demoable with no live engine), not a silent failure; only the `?replay=1`
query override is gated to non-production. Set `ENGINE_URL` to probe
arbitrary addresses live.

Note that the engine seeds the same recorded runs into its cache at startup,
so an example token is answered without touching the network even when the
engine *is* deployed. That matters under load: every live run spawns one fork
per probe, and a free-tier archive RPC returns 429 once forks overlap.

### 3. Verify end-to-end

Once both are deployed, open the web app's public URL, run one of the
preloaded example tokens, and confirm the split view streams verdicts with
tx hashes and no "recorded run" banner — the banner means web never reached
the engine.

Then check the surfaces a browser will not show you:

```bash
curl -s "$SITE/api/token/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" | head -c 400
curl -s "$SITE/api/catalogue?filter=ownerTrap" | head -c 400
curl -s "$SITE/llms.txt" | head -20
curl -sI "$SITE/api/og?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" | grep -i content-type
```

The last one must answer `image/png`: it is the card every shared link
unfurls into, and a broken one fails silently — nothing on the site looks
wrong, the link just goes out blank.

## Project layout

```
engine/                     Hono SSE server: pre-scan -> plan -> execute -> narrate
  src/server.ts               HTTP entrypoint (/health, /run)
  src/orchestrator.ts         one anvil fork per run; snapshot around each probe
  src/fork.ts                 spawns anvil, wraps it as a ForkClient
  src/prescan.ts              ERC-20? pool? which venue? owner? holder sample
  src/planner.ts              LLM: orders the applicable probes, cannot drop one
  src/narrator.ts             LLM: prose from finished verdicts, guarded digit by digit
  src/probes/                 honeypot, hiddenFee, lpRug, ownerTrap, approvalDrain, crossVenue
  src/selectors.ts            owner switches read out of deployed bytecode (PUSH4 scan)
  src/dex.ts, dexV3.ts        buying and selling on Uniswap V2 and V3
  src/venue.ts                what an independent venue must provide, and when its price counts
  src/bingx.ts, gate.ts       the two venues crossVenue asks
  src/untrusted.ts            flattens text the token's author chose before it is used
  src/rpc.ts                  the historical-logs endpoint, retried, kept off the fork
  scripts/gen-fixtures.mts    records real runs into shared/src/fixtures.ts
  scripts/gen-verification.mts  reads Blockscout into shared/src/verification.ts
  scripts/gen-listings.mts    which catalogue tokens the venues quote
  scripts/reproduce.mts       re-runs recorded addresses and diffs the verdicts
  scripts/counts.mts          every figure this README and the submission quote
  Dockerfile                  deploy artifact for this package

web/                        Next.js demo UI, and the machine-readable surfaces
  app/page.tsx                landing page and the examples
  app/run/                    one address: the live trace and the verdict cards
  app/catalogue/              every recorded run, filtered and paged on the server
  app/api/run/                proxies the engine's SSE stream, or replays a recording
  app/api/token/[address]/    one run as JSON
  app/api/catalogue/          the whole catalogue as JSON, paged
  app/api/og/                 the card a shared link unfurls into
  app/llms.txt/               what the data means, for a reader that is not a person
  e2e/                        Playwright, across three engines and two phone viewports

shared/                     what both sides import, so the contract cannot drift
  src/types.ts                Verdict, PreScan, ForkClient, Probe
  src/fixtures.ts             GENERATED: the recorded runs themselves
  src/verification.ts         GENERATED: who publishes verified source
  src/listings.ts             GENERATED: which venues quote which address
  src/headline.ts             the one rule that turns verdicts into a single word
  src/narration.ts            refuses to serve prose that contradicts its own verdicts
  src/catalogue.ts            rows, filters and paging, used by the page and the API
```
