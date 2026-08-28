import type { NextRequest } from "next/server";
import {
  FIXTURES, FIXTURE_BLOCK, headlineOf, recheckOf, recordedRun, safeNarration, scannersOf, venueListings, verificationOf,
  type FrozenRun,
} from "@sidik/shared";
import { PROVENANCE } from "@/lib/provenance";

// The runs store the block as a string because the engine turns it into a
// BigInt; a JSON consumer should not inherit that. Left as a string, comparing
// block numbers silently compares text — "9000000" > "50200000" is true.
const FORK_BLOCK = Number(FIXTURE_BLOCK);

export const runtime = "nodejs";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Every body carries these two, so a consumer holding one response can tell
// which shape it is and which chain it describes without reading the docs.
const STAMP = { schemaVersion: 1, chainId: 8453 } as const;

/**
 * A run the engine has finished but the catalogue does not hold.
 *
 * With an engine configured, /run streams a verdict for any address while
 * this route 404s for the same one and the shared link unfurls generic — one
 * product giving two answers. The engine keeps every finished run in its
 * cache (bounded, in-memory), so ask it. Never a mock: no engine, no answer.
 */
async function fromEngine(address: string): Promise<FrozenRun | undefined> {
  const engineUrl = process.env.ENGINE_URL;
  if (!engineUrl) return undefined;
  try {
    const res = await fetch(`${engineUrl}/token/${address}`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Partial<FrozenRun>;
    return body.scan && Array.isArray(body.verdicts) ? (body as FrozenRun) : undefined;
  } catch {
    return undefined;
  }
}

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
  const { address: raw } = await params;

  if (!ADDRESS_RE.test(raw)) {
    return Response.json({
      ...STAMP,
      error: `"${raw.slice(0, 40)}" is not a Base address — expected 0x followed by 40 hex characters.`,
    }, { status: 400 });
  }
  // One address, one spelling. The catalogue keys are lower-case, the sitemap
  // is lower-case, and a consumer that echoes this field builds the same URL
  // everyone else does.
  const address = raw.toLowerCase();

  const recorded = recordedRun(address);
  const run = recorded ?? await fromEngine(address);
  if (!run) {
    // 404 rather than an empty verdict: "no recorded run" is a different
    // statement from "nothing was found wrong", and a consumer must not be
    // able to mistake one for the other.
    return Response.json({
      ...STAMP,
      error: "No recorded run for this address.",
      recordedAddresses: Object.keys(FIXTURES).length,
      forkBlock: FORK_BLOCK,
    }, { status: 404 });
  }

  return Response.json({
    ...STAMP,
    address,
    forkBlock: FORK_BLOCK,
    symbol: run.scan.symbol,
    decimals: run.scan.decimals,
    venue: run.scan.venue ?? null,
    poolAddress: run.scan.poolAddress ?? null,
    headline: headlineOf(run.verdicts),
    verdicts: run.verdicts,
    narration: safeNarration(run.narration, run.verdicts),
    // Corroboration, kept in its own object so nothing here can be mistaken
    // for part of a verdict. BingX pairs were matched by hand; Gate pairs were
    // matched against the contract address Gate itself publishes.
    corroboration: {
      alsoTradesOn: venueListings(address),
      // Blockscout's answer for this address. Across the catalogue this is
      // the number that matters: almost every token with a finding against it
      // publishes source anyone could have read first.
      sourceVerified: verificationOf(address)?.verified ?? null,
      // Two read-only scanners' readings for the same address, recorded on
      // the date inside. They describe the chain that day, not the fork
      // block above, and nothing in them changes a verdict.
      scanners: scannersOf(address) ?? null,
      // Where a scanner disputes the recorded verdict, the honeypot probe was
      // re-executed at that day's head block. Still context: it says whether
      // the token changed since the pin, not whether the pin was wrong.
      recheck: recheckOf(address) ?? null,
    },
    // Said plainly so nobody links these hashes to an explorer and finds
    // nothing: they were mined on a fork and never broadcast.
    transactionsWereBroadcast: false,
    // False when this came from a live engine's cache rather than the
    // committed catalogue — it is real, but nobody can reproduce it from git.
    recorded: !!recorded,
    provenance: PROVENANCE,
  }, {
    headers: {
      // The runs are pinned to one block, so they cannot go stale between
      // deploys — but a new deploy is exactly when they change. A live-engine
      // answer is not cached: the engine's cache is the only copy.
      "cache-control": recorded ? "public, max-age=300, stale-while-revalidate=86400" : "no-store",
    },
  });
}
