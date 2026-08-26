import type { NextRequest } from "next/server";
import { FIXTURES, FIXTURE_BLOCK, listedTicker } from "@sidik/shared";
import { headlineOf } from "@/lib/catalogue";

export const runtime = "nodejs";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * The recorded run for one address, as JSON.
 *
 * The SSE route exists to be watched; this one exists to be consumed. A
 * verdict is only worth anything to someone else if they can read it without
 * scraping a page, and everything here — the tx hashes, the measured amounts,
 * the reason a probe could not answer — is already what the run produced.
 *
 * `forkBlock` is part of the answer rather than a footnote: these verdicts
 * describe Base at one specific block, and a caller who does not know which
 * one cannot tell how stale they are.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  if (!ADDRESS_RE.test(address)) {
    return Response.json({
      error: `"${address.slice(0, 40)}" is not a Base address — expected 0x followed by 40 hex characters.`,
    }, { status: 400 });
  }

  const run = FIXTURES[address.toLowerCase()];
  if (!run) {
    // 404 rather than an empty verdict: "no recorded run" is a different
    // statement from "nothing was found wrong", and a consumer must not be
    // able to mistake one for the other.
    return Response.json({
      error: "No recorded run for this address.",
      recordedAddresses: Object.keys(FIXTURES).length,
      forkBlock: FIXTURE_BLOCK,
    }, { status: 404 });
  }

  return Response.json({
    address,
    forkBlock: FIXTURE_BLOCK,
    symbol: run.scan.symbol,
    decimals: run.scan.decimals,
    venue: run.scan.venue ?? null,
    poolAddress: run.scan.poolAddress ?? null,
    headline: headlineOf(run.verdicts),
    verdicts: run.verdicts,
    narration: run.narration,
    alsoListedOn: listedTicker(address) ? { bingx: listedTicker(address) } : null,
    // Said plainly so nobody links these hashes to an explorer and finds
    // nothing: they were mined on a fork and never broadcast.
    transactionsWereBroadcast: false,
  }, {
    headers: {
      // The runs are pinned to one block, so they cannot go stale between
      // deploys — but a new deploy is exactly when they change.
      "cache-control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}
