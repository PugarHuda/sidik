import type { Metadata } from "next";
import { FIXTURES, FIXTURE_BLOCK, headlineOf } from "@sidik/shared";
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
  const run = FIXTURES[token.toLowerCase()];
  if (!run) return { title: "Sidik — run" };

  const headline = headlineOf(run.verdicts);
  const symbol = run.scan.symbol || token.slice(0, 10);
  const said = headline === "FAIL"
    ? "something was proven against it"
    : headline === "PASS"
      ? "every applicable probe passed"
      : "not every probe could answer";
  const block = Number(FIXTURE_BLOCK).toLocaleString("en-US");
  return {
    title: `Sidik — ${symbol}: ${headline}`,
    description: `${symbol} was bought, sold and transferred against a fork of Base at block ${block} — ${said}.`,
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
  return <RunView key={token ?? ""} token={token ?? ""} />;
}
