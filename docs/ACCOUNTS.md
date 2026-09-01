# Copy for the two accounts the submission form requires

An X profile and one of Discord/Telegram are mandatory fields — the entry
cannot be submitted without them, and they are the only two blockers left that
the repository cannot clear. Everything below is written to be pasted as-is.

Every figure here is checked against `pnpm --filter @sidik/engine counts`. Two
of them never move — 207 addresses, and 203 of 206 publishing verified source —
because a re-record changes verdicts and not the address list or Blockscout's
answer. The ones to re-check before posting are the counts of what failed: "59
of the 60 we caught", the 25 owner traps and the 9 that pass everything else,
and both halves of the GoPlus comparison.

---

## X profile

**Name:** `Sidik`

**Handle:** whatever is free, in this order of preference —
`sidik_base`, `sidikbase`, `sidik_onchain`, `getsidik`. Avoid anything with
"AI" or "audit" in it: the entry's whole argument is that it does not infer,
and "audit" invites a comparison to firms that ship PDFs.

**Bio** (150 characters, counted; the limit is 160):

```
Proves what a Base token does to you by doing it — buys, sells and rugs it on a forked mainnet, then shows the transactions. Executed, never inferred.
```

**Location:** `Base` · **Link:** `https://sidik-eight.vercel.app`

**Attach the demo video to the pinned post.** It is 95 seconds, 14 MB, and
within X's limits: `https://sidik-eight.vercel.app/sidik-demo.mp4`. A post with
video reaches far more people than one without, and upvotes are the one part of
the score that cannot be improved by writing more code.

**One more post worth making, now that the live run is deployed and verified:**

```
You can now paste any Base token into Sidik and it will fork the chain and
execute the probes while you watch. Buy, sell, transfer, pull the pool, throw
the owner switches. About thirty seconds.

Not a scan. Not a score. The transactions, and what they did.
```

**Profile image:** the site's own mark — a fingerprint over the dark ground.
Screenshot the header at `https://sidik-eight.vercel.app` at 2× and crop
square; it matches the OG cards a judge will already have seen.

### Pinned post

Post this first and pin it. It leads with the finding rather than the tool,
because the finding is the part that is hard to argue with:

```
We executed every probe against 207 Base tokens on a forked mainnet — buying,
selling, transferring, pulling the liquidity and throwing the owner switches.

203 of the 206 addresses with a verifiable answer publish verified source code.
So do 59 of the 60 we caught.

"Check that the contract is verified" separates almost nothing.

sidik-eight.vercel.app/findings
```

### Second post, for the thread

The result nothing but execution produces. Post it as a reply to the pinned one:

```
A token can pass every trade test and still have an exit its owner controls.

25 of the 207 have a privileged address that can stop a holder leaving.
9 of those pass every other probe we run — they buy, sell, transfer and price
like a clean token.

We pulled each switch on a fork and made the identical sell again.
```

### Third post — the comparison we lose

Publish this too. An entry that only shows the flattering half of a comparison
invites the question of what it left out, and one of the competing entries
scored well partly by publishing its own unflattering number.

```
We ran the same 207 tokens through GoPlus, the scanner most wallets embed.

On buy tax it matched our executed figure on 185 of 185. Perfectly.
On whether an owner can still trap a holder, it agreed on 12 of 42.

Where inference is good it is very good. We are saying so.
```

**What not to post:** anything naming a token as a scam. Every finding is a
proof of capability at one block, and the run pages say so under the verdict.
A post that drops that qualifier is a claim the data does not support.

---

## Telegram

Prefer Telegram over Discord: a channel is one field and needs no moderation,
where a Discord server judged empty reads worse than no server at all.

**Type:** public **channel** (not a group — nothing needs to be discussed).

**Name:** `Sidik`

**Handle:** `@sidik_base`, matching the X handle if it is free.

**Description** (216 characters, counted; the limit is 255):

```
Sidik proves what a Base token does to you by executing it on a forked mainnet — buying, selling and rugging it, then showing the transactions. 207 addresses recorded. Executed, never inferred. sidik-eight.vercel.app
```

### First message

Pin it, so the channel is not empty when a judge opens it:

```
Sidik forks Base mainnet at a pinned block, buys a token with a funded test
wallet, tries to sell it, transfers it, pulls the pool out from under it, and
lets its owner throw every switch in its bytecode.

Every verdict is what a transaction did. Nothing is inferred from source code.

207 addresses are recorded and browsable, with the raw data behind every
figure and a command that re-forks Base and diffs the result against what is
published.

Start here: sidik-eight.vercel.app/findings
Code: github.com/PugarHuda/sidik
```

---

## Order to do this in

1. Create the X profile, post the three posts, pin the first.
2. Create the Telegram channel, post and pin the first message.
3. Put both handles in the submission form.
4. Submit, and pay the ignition fee. Do not wait for anything else in the
   repository — upvotes accrue from the moment the entry is live, and the
   leaders are already in the teens.
