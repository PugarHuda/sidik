# Sidik

**Sidik** (Indonesian: *to investigate / detect* — *sidik jari* = fingerprint)
is an agent that proves what a Base token will actually do to you, by doing
it — on a forked mainnet sandbox, in real time, in front of you.

## Try it

**[sidik-eight.vercel.app](https://sidik-eight.vercel.app)**

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
  wallet, tries to sell it, and shows you the revert — with the on-chain tx
  hash (linked to Basescan) and the raw verdict data behind it to back it up.

The verdict (`PASS` / `FAIL` / `N/A`) is produced entirely by deterministic
code reading the result of a real EVM transaction — never by an LLM. The LLM
only decides *which probes to run* (planner) and *how to narrate the
results in prose* (narrator); it never invents a number or a verdict. Every
figure on screen traces back to a real call on a real fork, and every
verdict exposes the fork tx hash it came from plus an expandable panel of
the raw data behind it — not a decoded call-trace view.

## Architecture

```
token address
  -> pre-scan (deterministic): is it an ERC-20? does it have a pool? owner? top holders?
  -> planner (LLM, structured output): picks which probes apply, in what order
  -> executor: per probe -> fresh anvil fork of Base -> setup -> execute (real txs) -> interpret (code, not LLM)
  -> narrator (LLM): writes prose from the finished verdicts; numbers are injected, never generated
  -> output: assumed-vs-proven table, fork tx hashes, an expandable
     raw-verdict-data panel, streamed live over SSE
```

Two packages, one shared types package:

- **`engine/`** — a small Hono server. `GET /run?token=0x...` streams the
  flow above as Server-Sent Events. `GET /health` for liveness. Spawns a
  fresh `anvil` fork (via Foundry) per request against a Base archive RPC,
  runs the probes, tears the fork down.
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

# engine test suite (vitest)
pnpm test

# re-record the example runs against a real fork (needs BASE_ARCHIVE_RPC).
# Run this after changing EXAMPLES or BASE_FORK_BLOCK.
pnpm --filter @sidik/engine fixtures
```

### Reproducibility: the pinned fork block

`BASE_FORK_BLOCK` (see `engine/src/examples.ts`) pins every fork to a fixed,
known-good Base block instead of "latest". Without a pin, a demo run against
a live chain tip is not reproducible — token balances, pool liquidity, and
even contract behavior can shift between runs. Pinning means the same token
address produces the same verdict every time, which is what lets the demo
examples be pre-verified rather than "probably still works." Override with
`BASE_FORK_BLOCK=<blockNumber>` if you need a different pin (e.g. a block
close to a specific incident).

## What Sidik can and cannot probe

Every probe trades through **Uniswap V2** on Base. That is where the liquidity
is for the tokens this tool exists to judge — new listings, memecoins, and the
scams among them — and it is enough: USDC holds 274 WETH there, KEYCAT 151,
MIGGLES 89.

It is also a real boundary. Several well-known Base tokens have left V2 for
Uniswap V3 or Aerodrome — BRETT, TOSHI and DEGEN each have well under 0.2 WETH
left in their V2 pair — so Sidik reports `N/A` for them rather than guessing.
Covering those means adding an adapter alongside `engine/src/dex.ts`, which is
isolated to that file plus pre-scan's pool detection.

A second boundary is structural rather than fixable. A family of Base tokens
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

## Deployment

Deploying is two independent pieces: the **engine** (a long-running
container — it shells out to `anvil`, so it needs a real host, not a
serverless function) and the **web app** (a normal Next.js app on Vercel).
**These deploy steps require your own Railway/Vercel accounts and secrets —
they are not run as part of this repository's automation.**

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
| `BASE_FORK_BLOCK` | no | Pins the fork to a specific block for reproducible demo runs; defaults to a hardcoded recent block (see `engine/src/examples.ts`) |
| `WEB_ORIGIN` | no | Restricts CORS to one origin, e.g. `https://sidik-eight.vercel.app`. Defaults to `*`, which lets any site spend your RPC quota |
| `SIDIK_MAX_CONCURRENT_RUNS` | no | Runs allowed in flight at once, default `2`. Beyond it `/run` returns 503 rather than handing everyone rate-limited forks |
| `PORT` | no | Defaults to `8787` |

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
| `ENGINE_URL` | yes (for real runs) | Public URL of the deployed engine, e.g. `https://sidik-engine.up.railway.app` (no trailing slash) |

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

## Project layout

```
engine/         Hono SSE server: pre-scan -> plan -> execute probes on an anvil fork -> narrate
  src/server.ts     HTTP entrypoint (/health, /run)
  src/fork.ts       spawns anvil, wraps it as a ForkClient
  src/planner.ts    LLM: pick applicable probes
  src/narrator.ts   LLM: prose from finished verdicts
  src/examples.ts   preloaded demo tokens + BASE_FORK_BLOCK
  Dockerfile        deploy artifact for this package
web/            Next.js demo UI + SSE proxy (app/api/run/route.ts)
shared/         types shared between engine and web (Verdict, ForkClient, ...)
```
