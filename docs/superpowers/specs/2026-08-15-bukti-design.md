# Bukti — Design Spec

> An autonomous agent that **proves** what a Base token will do to you by
> actually doing it in a forked mainnet sandbox — instead of inferring risk
> from data like every other analytics agent.

- **Project:** Bukti (Indonesian: *proof / evidence*)
- **Event:** Orion Builder Hackathon (Base). Submit deadline 2026-09-02 23:59 UTC.
  Internal target submit: **2026-08-30** (3-day buffer for gas/bugs/retry).
- **Judged on:** usefulness, execution, originality (0–10 each), by
  exchange/launchpad partners (WEEX, BingX, HuoStarter, Up10, Pivot, Noah AI).
- **Optimization target:** judge score. Demo-genic beats long-term-durable.

## Thesis

Every other entry (Rigel, BaseScout) is read-only analytics: they *infer*
risk from on-chain data. Bukti crosses a technical line almost nobody crosses
in a 3-week hackathon — it **executes** the attack on a forked Base mainnet and
shows what actually happens. "Rigel/BaseScout tell you what's wrong; Bukti
tries to sell the token and shows you the revert."

The differentiator is a **technical moat** (mainnet forking + state override +
trace decoding), not just a topic — which is exactly why it is hard to copy in
the remaining time.

## Core abstraction: Probe

The whole system rotates around one seam. A Probe is one executable,
deterministic attack/test with a uniform shape:

```
Probe {
  name           e.g. "honeypot-sell-test"
  applicableWhen (raw) -> bool   // is this an ERC-20 with a DEX pool? etc.
  setup(fork)                    // impersonate whale, fund test wallet, etc.
  execute(fork)  -> rawResult    // run REAL txs on the fork; return raw + txHashes
  interpret(raw) -> Verdict      // PASS | FAIL | N/A + numbers, DETERMINISTIC
}

Verdict { status, title, claimedVsProven[], numbers{}, txHashes[], traceRefs[] }
```

**Non-negotiable invariant:** the verdict is produced by `interpret` (code),
never by the LLM. If the sell reverts, `interpret` returns
`FAIL: honeypot` with the revert reason from the trace. This is the property
that let BaseScout score 86 — every figure traces to a real call. Bukti keeps
it and adds one thing no read-only tool has: an honest **N/A** ("could not
execute / not applicable"), which reads as integrity to judges.

Probes are plugins: adding a capability = adding one probe file. This is what
keeps scope tunable — ship 4, grow to 10.

## Flow

```
token address
  -> Pre-scan (cheap, deterministic): is ERC-20? has pool? top holders? owner?
  -> Planner (LLM): pick applicable probes + order  [structured output only]
  -> Executor: for each probe -> fresh anvil fork -> setup -> execute -> interpret
  -> Narrator (LLM): write prose from finished Verdicts  [numbers injected, not generated]
  -> Output: "claimed vs proven" table + txHash + expandable call trace per row
  -> (stretch) EAS attestation of the verdict written on Base = permanent receipt
```

LLM appears at exactly two points: **planner** (which probes) and **narrator**
(explain results). Everything between is deterministic code and real EVM.

### LLM guardrails

- **Planner:** structured output constrained to a fixed enum of probe ids +
  ordering. Cannot invent probes or numbers.
- **Narrator:** receives Verdicts whose numbers are already strings. Numbers are
  injected via template, not generated. **Guard (ponytail check):** a regex
  rejects any narrator output containing a numeric token not present in the
  Verdict set; on failure, fall back to the template rendering. One runnable
  assert-based self-check covers this.
- **Model:** Claude Sonnet 5 via Vercel AI Gateway (`"anthropic/claude-sonnet-5"`
  style provider string). No provider SDK hardcoding.

## Fork execution infrastructure (the decisive infra choice)

Multi-tx sequences (buy THEN sell against resulting state) need a **stateful**
EVM fork; isolated `eth_call` is insufficient. anvil is the tool, and it cannot
run on Vercel serverless.

**Decision:** a dedicated long-running **container backend** (Railway/Fly/Render)
that runs **one ephemeral anvil fork per request**:

```
anvil --fork-url <BASE_ARCHIVE_RPC> --fork-block-number <N>
  -> run probe sequence via viem test client
  -> tear down
```

- **Fork at a pinned block number** => reproducible. A judge who re-runs gets
  the identical result. Credibility.
- Next.js (Vercel) = frontend + thin API that calls this backend and streams
  results back via SSE.
- Rejected alternatives: Vercel Sandbox (newer/riskier for deadline);
  third-party simulation API (user chose full local fork).

**External dependency (only paid-ish one):** a **Base archive RPC**
(Alchemy/QuickNode free tier is enough for the demo). Required for forking at a
past block and reading historical state.

## Demo / frontend (this is where the competition is won)

- Next.js App Router on Vercel, single URL, Tailwind + shadcn.
- Input: a Base token address, OR pick a **preloaded example** — a known
  honeypot, a known-safe token, a known high-fee token — so judges click and
  see a result in <10s with **no wallet, no API key, no signup**.
- Live streaming (SSE): as each probe runs, stream the trace. Split view:
  - left column: **Claimed / Expected**
  - right column: **Proven in fork** (red/green), with sandbox txHash and an
    expandable decoded call trace per row.
- Final: a shareable verdict card (screenshot-friendly for judges + X).

## Scope for 18 days

**MVP probes (must ship — 4):**
1. `honeypot-sell-test` — buy token, then try to sell; sell revert = honeypot
   (capture revert reason from trace).
2. `hidden-fee-test` — transfer; measure actual received vs sent => hidden
   tax/fee, exact %.
3. `approval-drain-test` — for a target wallet's live approvals, simulate the
   spender calling `transferFrom`; show balance moving.
4. `lp-rug-test` — impersonate LP/deployer owner, pull liquidity, show a holder
   position going toward zero.

**Stretch probes (add if time — target 10 total):**
5. `blacklist-test` 6. `mint-authority-test` 7. `pausable-test`
8. `ownership-renounce-check` 9. `max-tx / max-wallet limits`
10. `slippage-reality` (actual price impact for a given trade size).

**Stretch artifact:** write the verdict onchain as an **EAS attestation on
Base** — a permanent receipt with a Basescan link. Real tx, real gas, an
artifact no read-only entry has. High judge value; not MVP.

## Tech stack

- **Frontend:** Next.js (App Router), Vercel, Tailwind, shadcn/ui.
- **Backend:** Node + TypeScript service (Hono or Express) in a container with
  **Foundry (anvil + cast)** and **viem**; deployed on Railway/Fly.
- **LLM:** Claude Sonnet 5 via Vercel AI Gateway (planner + narrator).
- **RPC:** Base archive node (Alchemy free tier).
- **Optional onchain:** EAS SDK for attestation.

## Non-goals (YAGNI)

- No user auth / accounts. No database beyond an ephemeral run cache.
- No support for non-Base chains.
- No wallet connection in the demo path.
- No production hardening beyond what the demo needs (this is judge-optimized).

## Hard requirements checklist (non-code, do NOT leave to last night)

- [ ] Register the submitting wallet BEFORE submit (free signature, no gas).
- [ ] Website (landing page).  [ ] X profile for the agent.  [ ] Public GitHub.
- [ ] Discord or Telegram link.
- [ ] ETH on Base for ignition fee (~$10) + gas.
- [ ] Submit from the registered wallet (prize pays to it).
- [ ] Demo link live and runnable with no setup.

## Open assumptions (flag if wrong)

- We have or can obtain a Base archive RPC endpoint.
- Sonnet 5 via AI Gateway is acceptable (vs a pinned direct provider).
- EAS attestation is stretch, not a submission blocker.
