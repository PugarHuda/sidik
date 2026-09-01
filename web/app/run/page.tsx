import type { Metadata } from "next";
import { FIXTURE_BLOCK, headlineOf, recheckOf, recordedRun, scannersOf, verificationOf } from "@sidik/shared";
import RunView from "./RunView";

/**
 * A title that says which token and what was found.
 *
 * Every run link shared anywhere previously read "Sidik — proof, not
 * promises", so a link to a proven honeypot and a link to a clean token were
 * indistinguishable in a browser tab, a bookmark list or a chat preview — on
 * a page whose entire purpose is to tell those two apart.
 *
 * Derived on the server from the recorded run, so it cannot claim a verdict
 * the page does not go on to show.
 */
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ token?: string | string[] }> },
): Promise<Metadata> {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const run = recordedRun(token);
  if (!run) return { title: "Sidik — run" };

  const headline = headlineOf(run.verdicts);
  const symbol = run.scan.symbol || token.slice(0, 10);
  const said = headline === "FAIL"
    ? "something was proven against it"
    : headline === "PASS"
      ? "every applicable probe passed"
      : "not every probe could answer";
  const block = Number(FIXTURE_BLOCK).toLocaleString("en-US");
  const title = `Sidik — ${symbol}: ${headline}`;
  const description = `${symbol} was bought, sold and transferred against a fork of Base at block ${block} — ${said}.`;
  // The card this link unfurls into carries the verdict. Without it a proven
  // honeypot and a clean token share one grey rectangle in every Discord
  // thread, Telegram group and post the link is ever pasted into.
  const image = { url: `/api/og?token=${encodeURIComponent(token)}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    // Example links are checksummed and the sitemap is lower-case, so every
    // run had two URLs; indexers were told they were two pages.
    alternates: { canonical: `/run?token=${token.toLowerCase()}` },
    openGraph: { title, description, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function RunPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; instant?: string | string[]; live?: string | string[]; at?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  // ?instant=1 skips the paced replay. Presentation only — same events, same
  // figures, no pauses between them.
  const rawInstant = params.instant;
  const instant = (Array.isArray(rawInstant) ? rawInstant[0] : rawInstant) === "1";
  // ?live=1 executes the probes now, against a fork of Base, instead of
  // replaying a recorded run. It is the one thing on this site that is not
  // frozen, so it is opt-in rather than the default: a replay answers in
  // milliseconds and cannot be rate-limited.
  const rawLive = params.live;
  const live = (Array.isArray(rawLive) ? rawLive[0] : rawLive) === "1";
  // ?at=head forks where Base is now rather than at the pinned block, so the
  // answer describes today. Only meaningful alongside live=1.
  const rawAt = params.at;
  const atHead = (Array.isArray(rawAt) ? rawAt[0] : rawAt) === "head";
  // Looked up here rather than in the client: the map covers every recorded
  // addresses and the page shows exactly one of them. Handing the component
  // the whole thing is how the catalogue got shipped to the browser twice
  // before.
  const source = verificationOf(token ?? "");
  const scanners = scannersOf(token ?? "");
  // Same reason as the two above: the recheck map holds verdict titles for
  // every rechecked address, and importing it from the client component
  // shipped all of them to every visitor.
  const recheck = recheckOf(token ?? "");
  // The pinned run's verdicts, for the head-block comparison. Looked up here
  // for the same reason as everything above it: FIXTURES holds every recorded
  // run, and importing it from the client component ships all of them to every
  // visitor. Only this token's verdicts cross the boundary, and only when the
  // page is going to compare them against something.
  const pinned = atHead ? (recordedRun(token ?? "")?.verdicts ?? null) : null;
  // Keyed by token AND instant. RunView never resets its event list — it
  // relies on being remounted — so changing only `instant` (which is exactly
  // what the "skip the replay" link does) would re-run the stream effect and
  // append a second copy of the trace to the first.
  return <RunView key={`${token ?? ""}:${instant}:${live}:${atHead}`} token={token ?? ""} instant={instant} live={live} atHead={atHead} pinned={pinned} source={source ?? null} scanners={scanners ?? null} recheck={recheck ?? null} />;
}
