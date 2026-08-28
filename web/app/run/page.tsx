import type { Metadata } from "next";
import { FIXTURE_BLOCK, headlineOf, recordedRun, scannersOf, verificationOf } from "@sidik/shared";
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
    openGraph: { title, description, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function RunPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  // Looked up here rather than in the client: the map covers all 194 recorded
  // addresses and the page shows exactly one of them. Handing the component
  // the whole thing is how the catalogue got shipped to the browser twice
  // before.
  const source = verificationOf(token ?? "");
  const scanners = scannersOf(token ?? "");
  return <RunView key={token ?? ""} token={token ?? ""} source={source ?? null} scanners={scanners ?? null} />;
}
