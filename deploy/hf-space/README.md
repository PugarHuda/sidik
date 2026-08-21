---
title: Sidik Engine
emoji: 🔎
colorFrom: indigo
colorTo: gray
sdk: docker
app_port: 8787
pinned: false
short_description: Proves what a Base token does to you by executing it on a fork
---

# Sidik — engine

The backend for [Sidik](https://github.com/PugarHuda/sidik): it proves what a
Base token does to you by doing it, on an ephemeral [anvil](https://book.getfoundry.sh/anvil/)
fork of Base mainnet, rather than inferring risk from bytecode.

This Space is the API only. The demo UI lives at
[sidik-eight.vercel.app](https://sidik-eight.vercel.app).

## Endpoints

| Route | What it does |
|---|---|
| `GET /health` | Liveness. Returns `{"ok":true}` |
| `GET /run?token=0x…` | Streams a full run as Server-Sent Events |

A run pre-scans the address, plans which probes apply, then executes each one
on its own fresh fork — a real buy, a real sell, a real `transferFrom` — and
streams back a `PASS` / `FAIL` / `N/A` verdict per probe with the tx hashes
behind it.

Every verdict is decided by deterministic code reading the result of a real
EVM transaction. The LLM only orders the probes and writes the prose around
them, and a numeric guard rejects any figure that does not appear verbatim in
the run. It cannot invent a verdict or a number.

## Source

This Space carries no source of its own. Its Dockerfile clones
[PugarHuda/sidik](https://github.com/PugarHuda/sidik) at build time, so there
is exactly one copy of the code. Rebuild the Space to pick up new commits.
