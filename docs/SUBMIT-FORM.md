# The submission form, field by field

Every value below is checked against the deployed site and the repository.
Two things are deliberately blank because inventing them would be a false
claim, and one field has two versions depending on when you submit.

---

## Which description to paste

**Use Version B.** The live run is deployed and verified on the public site as
of 2026-09-01 15:5x UTC. Three Base tokens that are NOT in the catalogue were
executed against a fork through `/api/live` and returned full verdict sets:
TYBG in 18s, BENJI in 14s, ALB in 11s. The assembled text is in
[version-b.txt](version-b.txt) — copy that file, not the fragments below.

Version A is kept only as the fallback if the live route ever stops answering;
it is the same text with the live paragraph removed. Check before pasting:

```bash
curl -N "https://sidik-eight.vercel.app/api/live?token=0x0d97F261b1e88845184f678e2d1e7a98D9FD38dE" | head -5
```

Everything else on the form is the same either way.

---

## Agent Details

**Agent Name**

```
Sidik
```

**Target Blockchain:** Base (already correct)

**Strategy / Category** — the form defaults to Yield Farming / Yield, which is
wrong. The gallery tags entries `risk`, `research`, `trading`, `social` and
`other`; Sidik belongs in **risk**. Pick the risk or security option in each
dropdown, and if neither list has one, take the closest of research or other.
Do not leave it on Yield: a judge filtering the gallery by category will not
find you, and the tag will contradict the description.

---

## Economics

Leave both at their defaults — **Revenue Sharing 20%**, **Funding Target
100000**. They govern a Store listing rather than the hackathon score, and
putting considered-looking numbers there would imply a business model that
does not exist yet.

**Token Symbol: leave blank.** Sidik has no token. Naming one would be exactly
the kind of unverifiable claim the entry argues against.

---

## Social Links

| Field | Value |
|---|---|
| GitHub URL | `https://github.com/PugarHuda/sidik` |
| Website URL | `https://sidik-eight.vercel.app` |
| Demo Link | `https://sidik-eight.vercel.app/findings` |
| Twitter / X URL | **you must create this** — copy in [ACCOUNTS.md](ACCOUNTS.md) |
| Telegram URL | **you must create this** — copy in [ACCOUNTS.md](ACCOUNTS.md) |
| Discord URL | leave blank; Telegram satisfies the requirement |

The demo link points at `/findings` rather than the front page on purpose: it
is the page that states what the exercise found, and a judge who opens exactly
one thing should open that.

## Submitter Information

Email: your registered address. Wallet: auto-filled, and it must be the
registered one — `0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E`.

## Images

Both are made and sit in [`docs/brand/`](brand/):

| Form field | File | Size |
|---|---|---|
| Agent Logo | `docs/brand/sidik-logo.png` | 1024×1024 |
| Banner Image | `docs/brand/sidik-banner.png` | 1200×630 |

The logo is a fingerprint — *sidik jari* — drawn from the site's own palette
and checked down to 32px, which is roughly how big it lands on a gallery card.
The banner is the site's OG card, so the address count printed on it is
counted from the catalogue rather than typed. [Notes](brand/README.md).

---

## Version A — accurate before the live run is deployed

```
Sidik proves what a Base ERC-20 does to a buyer by doing it, rather than inferring risk from bytecode. Given an address, it forks Base mainnet at a pinned block with anvil and executes six probes as real transactions: it buys and sells (honeypot), measures buy, sell and transfer separately and again a day later in fork time (hidden fee), grants an allowance and drains it (approval drain), classifies the LP holder and impersonates it to pull the pool (LP rug), compares pool pricing against BingX and Gate (cross-venue), and impersonates the privileged address to pull every ownership switch it can find, then makes the identical sell again (owner trap). Every verdict is decided by deterministic code reading the result of a mined transaction. The model orders the probes and writes the prose; a numeric guard rejects any figure that does not appear verbatim in the run data, so it cannot invent a verdict, a hash or a number.

The same run is a pre-listing check. Can it be sold, does the trade get skimmed, can the pool be emptied, can one address close the exit — those are the questions an exchange or a launchpad answers before a token goes live, and they are the four this executes rather than estimates. It never scores a token or says whether to list it; it reports what happened when it tried.

The catalogue is 207 Base addresses and 1,843 fork transactions. 68 fail at least one probe: 37 LP rugs, 25 owner traps, 18 hidden fees, 7 honeypots, 1 drainable wallet. 29 pass everything that applied; 110 return N/A — always reported as "not answered", never as "safe". The largest cause of N/A used to be the LP-rug probe failing to find a V3 position in its own search window; that was our limitation rather than the chain's, and fixing it turned 88 of those rows into statements about the pool.

The finding the project exists for: 203 of the 206 checkable addresses publish verified source code, and so do 59 of the 60 with a finding against them. Sourcify, asked independently, holds 67 exact and 39 partial matches. "Check that the contract is verified" separates almost nothing on Base. The catalogue was also run through GoPlus and honeypot.is, with every disagreement published in both directions: on buy tax GoPlus matched the executed figure on 185 of 185 addresses, and on whether a privileged address can still stop a holder from leaving it agreed on 12 of 42. 25 tokens have such an address, and 9 of them — including USDC, EURC, cbBTC and cbETH — pass every other probe. 17 of the 25 are proxy admins replacing the implementation. That is a proof of capability, not an accusation or a prediction, and the interface says so on the page.

What it refuses to do is as deliberate as what it does. Fork transactions are never linked to a block explorer, because they were never broadcast. An address with no recorded run returns an error, never a clean bill of health. A probe with no mechanism to test returns N/A rather than PASS. The public site replays recorded runs — they are genuine output of the engine in this repository, frozen, and `pnpm --filter @sidik/engine reproduce <address>` re-forks Base at the same block with your own RPC and diffs the result against what is published. It runs in CI on every push.

Reproducibility is the claim it stakes everything on, so it is stated as a number rather than a promise: `reproduce --sample 3` re-forked Base at the same block and returned 9 verdicts reproduced, 0 differed. All three findings, each with its method and the rows behind it, are at /findings — including the one comparison Sidik loses.

Every surface is machine-readable: JSON per address and for the catalogue, an OpenAPI 3.1 schema, an llms.txt, provenance on every body (recording date, engine commit, sha256 of the catalogue), and an MCP server over Streamable HTTP exposing sidik_token, sidik_catalogue and sidik_run, so an agent asked "is this token safe?" can call a fork execution instead of a scanner.
```

---

## Version B — use only once the live run answers on the public site

Identical to A, with one paragraph added after the first and one sentence
changed in the "refuses to do" paragraph.

**Insert as the second paragraph:**

```
Paste any Base address and it will fork the chain and execute the probes while you watch, in about thirty seconds; the 207 already recorded answer instantly instead. Hosting that meant giving up on container hosts — every one of them wanted a card or a paid tier — and putting Foundry inside a serverless function, which is the difference between an agent you can read about and one you can point at your own token.
```

**And replace** `The public site replays recorded runs — they are genuine
output…` **with:**

```
The public site replays the recorded catalogue by default, because a replay answers instantly and cannot be rate-limited, and executes a fresh run on request. The recorded runs are genuine output of the engine in this repository, frozen, and `pnpm --filter @sidik/engine reproduce <address>` re-forks Base at the same block with your own RPC and diffs the result against what is published. It runs in CI on every push.
```

---

## Order

1. Create the X profile and the Telegram channel ([ACCOUNTS.md](ACCOUNTS.md)).
2. If the live run is deployed and verified, use Version B. If not, use
   Version A — do not describe what a judge cannot open.
3. Fix Strategy and Category away from Yield.
4. Submit and pay the ignition fee. It is not refundable, and the entry cannot
   be resubmitted for free, so read the two dropdowns once more first.
