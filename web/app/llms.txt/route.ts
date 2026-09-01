import { FIXTURE_BLOCK, FIXTURE_COUNT, VERIFICATION_STATS } from "@sidik/shared";

export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidik-eight.vercel.app";

/**
 * What this site is, for an agent that arrives without a person attached.
 *
 * Same idea as robots.txt, aimed at a reader that can act on prose: it names
 * the two JSON endpoints, says what the verdicts mean, and states the two
 * things a consumer will otherwise get wrong — that the transactions were
 * never broadcast, and that a missing address is not a clean bill of health.
 *
 * Static: every number in it is frozen at the same fork block as the runs.
 */
export function GET() {
  const block = Number(FIXTURE_BLOCK).toLocaleString("en-US");
  const body = `# Sidik

> Sidik proves what a Base token does to a buyer by doing it: it forks Base
> mainnet at a pinned block, buys the token with a funded test wallet, tries
> to sell it, transfers it, pulls the pool out from under it, and lets its
> owner throw every switch in its bytecode. Every verdict is the result of a
> transaction that was executed, never an inference from source code.

Fork block: ${FIXTURE_BLOCK} (${block})
Recorded addresses: ${FIXTURE_COUNT}

## Read this before using the data

- The transactions were mined on an ephemeral fork and NEVER broadcast. Their
  hashes do not exist on Base mainnet and no block explorer will show them.
  The token address is real; the transaction hashes are not.
- An address with no recorded run returns 404. That is not "nothing found
  wrong" — it means the address was never probed, and the two must not be
  treated as the same answer.
- A verdict is PASS, FAIL or NA. NA means a probe could not answer. A verdict
  carrying "applicable": false means the mechanism does not exist for that
  token at all — an owner switch in a contract that exposes none — and it must
  not be read as a failure to check. Every such verdict in this data set is an
  ownerTrap one; no other probe currently produces the shape.
- ${VERIFICATION_STATS.verified} of ${VERIFICATION_STATS.checked} recorded addresses publish verified source code, and so do
  ${VERIFICATION_STATS.failingVerified} of the ${VERIFICATION_STATS.failing} with a finding against them. Verified source is not a
  safety signal in this data set.
- Anything under "corroboration" is context from a third party. It is never
  part of a verdict and never changes one. That includes "scanners": what
  GoPlus and honeypot.is said about the address on the date given, which is
  the chain that day, not the fork block. Where a scanner and the fork
  disagree, the catalogue row says so (filter=scannerDisagrees); the
  repository's recheck command re-runs the sell at today's head to tell a
  changed token from a wrong flag, and its result is under
  corroboration.recheck (head block, date, status) when one was run.
- Every recorded verdict can be reproduced: the repository's reproduce
  command forks Base at the same block and diffs the result.

## Start here

- ${SITE}/findings — the three measured results of executing the whole
  catalogue, each with its method and how to re-run it. If you only read one
  page, read that one: it is what the exercise found, not what one address did.

## Endpoints

- ${SITE}/api/catalogue — every recorded address, paged.
  Query: filter (all, failing, honeypot, hiddenFee, lpRug, ownerTrap,
  scannerDisagrees), q
  (symbol or address substring), page (1-based).
- ${SITE}/api/token/<address> — the full recorded run for one address:
  every verdict, every row, every measured figure, the fork block, and the
  narration. 404 when the address has no recorded run.
- ${SITE}/api/run?token=<address> — the same run as a Server-Sent Event
  stream, in the order the probes produced it.
- ${SITE}/api/live?token=<address> — executes the probes NOW against a fork
  of Base and streams the same Server-Sent Events as /api/run. Add
  &at=head to fork where Base is at this moment rather than at the pinned
  block: the catalogue answers what a token did in August, and that answers
  what it does today. The first frame is a "forked" event naming the block, so
  a consumer never has to assume which one it got. This is not a
  replay: the transactions are mined while you wait, on an ephemeral fork, and
  are still never broadcast. Any Base address works, recorded or not. Expect
  roughly thirty seconds, and an error event rather than a verdict if the run
  cannot be completed — a failure here is a fact about this deployment, never
  a finding about the token.
- ${SITE}/api/mcp — Sidik as a Model Context Protocol server over Streamable
  HTTP, hosted. Tools: sidik_token (executed verdicts for an address),
  sidik_catalogue (paged, filtered), sidik_run (execute the probes now on a
  fresh fork). Add it with:
  claude mcp add --transport http sidik ${SITE}/api/mcp
  An agent asked "is this token safe" can call a fork execution instead of a
  scanner, without running anything itself.
- ${SITE}/openapi.json — OpenAPI 3.1 for the two JSON endpoints, with the
  Verdict schema. Every JSON body carries schemaVersion, chainId (8453) and a
  provenance object: the recording date, engine commit, and a sha256 of the
  catalogue to check against a checkout.

## Probes

- honeypot: buys, then sells, and measures the proceeds against the pool's own
  quote. A sell that succeeds and pays nothing is not a pass. A reverted buy is
  retried smaller and reported with its reason; a reverted sell is retried
  after 1h and 24h of fork time (a cooldown is not a honeypot); a wallet the
  buyer transferred to also sells.
- hiddenFee: measures buy, sell and transfer() separately, and sells again a
  day later; V2 proceeds come from the router's Swap log, not the pool delta.
- lpRug: classifies the LP holder (EOA, 7702 account, Safe, a recognised
  locker, unknown contract), impersonates it and pulls the pool; where the
  holder is a contract it impersonates that contract's owner instead and calls
  the contract's own ways out, because impersonating the contract would bypass
  the rules being tested; on V3 pulls the
  largest position through the position manager. V3 positions are found from
  the pool's Mint events near the fork block and, when a pool was funded once
  at launch and has none there, from the block the pool was created in.
  Locked LP carries its unlock date.
- ownerTrap: buys, snapshots, sells to prove selling works, rolls back, lets
  the owner throw every switch in the bytecode, and sells again from identical
  state. Fee setters are tried down a ladder; for a proxy the implementation
  is scanned and the admin is made to replace the code before the sell.
  Privileged-looking functions Sidik cannot operate are named, not ignored.
- approvalDrain: for a wallet, exercises its live approvals.
- crossVenue: compares the price paid inside the pool against independent
  venues in the same hour.

## Source

${SITE} — https://github.com/PugarHuda/sidik
`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
