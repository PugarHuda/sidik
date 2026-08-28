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
  token at all — an LP rug against a Uniswap V3 pool, an owner switch in a
  contract that has none — and it must not be read as a failure to check.
- ${VERIFICATION_STATS.verified} of ${VERIFICATION_STATS.checked} recorded addresses publish verified source code, and so do
  ${VERIFICATION_STATS.failingVerified} of the ${VERIFICATION_STATS.failing} with a finding against them. Verified source is not a
  safety signal in this data set.
- Anything under "corroboration" is context from a third party. It is never
  part of a verdict and never changes one. That includes "scanners": what
  GoPlus and honeypot.is said about the address on the date given, which is
  the chain that day, not the fork block. Where a scanner and the fork
  disagree, the catalogue row says so (filter=scannerDisagrees); the
  repository's recheck command re-runs the sell at today's head to tell a
  changed token from a wrong flag.
- Every recorded verdict can be reproduced: the repository's reproduce
  command forks Base at the same block and diffs the result.

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

## Probes

- honeypot: buys, then sells, and measures the proceeds against the pool's own
  quote. A sell that succeeds and pays nothing is not a pass.
- hiddenFee: measures buy, sell and transfer() separately.
- lpRug: impersonates the LP holder and pulls the pool.
- ownerTrap: buys, snapshots, sells to prove selling works, rolls back, lets
  the owner throw every switch in the bytecode, and sells again from identical
  state.
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
