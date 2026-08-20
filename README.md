# Sidik

**Sidik** (Indonesian: *to investigate / detect* — *sidik jari* = fingerprint)
is an agent that proves what a Base token will actually do to you, by doing
it — on a forked mainnet sandbox, in real time, in front of you.

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
verdict exposes the tx hash it came from plus an expandable panel of the
raw data behind it — not a decoded call-trace view.

## Architecture

```
token address
  -> pre-scan (deterministic): is it an ERC-20? does it have a pool? owner? top holders?
  -> planner (LLM, structured output): picks which probes apply, in what order
  -> executor: per probe -> fresh anvil fork of Base -> setup -> execute (real txs) -> interpret (code, not LLM)
  -> narrator (LLM): writes prose from the finished verdicts; numbers are injected, never generated
  -> output: claimed-vs-proven table, tx hashes (linked to Basescan), an
     expandable raw-verdict-data panel, streamed live over SSE
```

Two packages, one shared types package:

- **`engine/`** — a small Hono server. `GET /run?token=0x...` streams the
  flow above as Server-Sent Events. `GET /health` for liveness. Spawns a
  fresh `anvil` fork (via Foundry) per request against a Base archive RPC,
  runs the probes, tears the fork down.
- **`web/`** — a Next.js demo app. `GET /api/run` proxies the engine's SSE
  stream straight through to the browser and renders the split view (claim
  vs. proof) live as events arrive. With no engine configured it replays the
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
# tier) and AI_GATEWAY_API_KEY (Vercel AI Gateway) in the environment to run
# real fork proofs. Runs on :8787.
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

On Railway: create a new service from this repo, set the Dockerfile path to
`engine/Dockerfile` with the **repo root** as the build context, and set the
environment variables below. Confirm `https://<your-service>/health` returns
`{"ok":true}` once deployed — that's the URL you'll use as `ENGINE_URL`.

**Required env vars (engine host):**

| Var | Required | Purpose |
|---|---|---|
| `BASE_ARCHIVE_RPC` | yes | Base archive-node RPC URL (e.g. Alchemy free tier) — `anvil --fork-url` forks from this |
| `AI_GATEWAY_API_KEY` | yes | Vercel AI Gateway key — the planner and narrator LLM calls run through this |
| `BASE_FORK_BLOCK` | no | Pins the fork to a specific block for reproducible demo runs; defaults to a hardcoded recent block (see `engine/src/examples.ts`) |
| `PORT` | no | Defaults to `8787` |

The engine needs **both** `BASE_ARCHIVE_RPC` and `AI_GATEWAY_API_KEY` to
produce a real fork-proof run — missing either breaks the flow, not just
degrades it.

### 2. Web → Vercel

Vercel auto-detects the Next.js app in `web/` (Next.js's own build/runtime
defaults are sufficient here — no `vercel.json` needed). Set the project
root to `web/` and add:

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
