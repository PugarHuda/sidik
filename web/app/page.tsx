import { FIXTURES } from "@sidik/shared";
import LandingView, { type TrapStat } from "./LandingView";

/**
 * The landing page's numbers, counted here rather than written down.
 *
 * Same reason RunView takes its corroboration as server props: FIXTURES holds
 * every recorded run, and importing it from a client component ships all
 * of them to every visitor. Counting on the server sends four numbers and a
 * handful of symbols instead.
 *
 * Counted rather than frozen into a constant because a hand-written figure is
 * exactly what went wrong in the submission copy — it was recorded against one
 * catalogue and read against a later one for three commits. This cannot drift:
 * re-record the catalogue and the page follows.
 */
function trapStat(): TrapStat {
  const runs = Object.values(FIXTURES) as { scan: { symbol: string }; verdicts: { probe: string; status: string; title: string }[] }[];
  const trapped = runs.filter((r) => r.verdicts.some((v) => v.probe === "ownerTrap" && v.status === "FAIL"));
  // "Clean otherwise" means the owner switch is the *only* thing against it:
  // every other probe that ran either passed or could not apply. Those are the
  // ones no amount of reading the source would have flagged.
  const cleanOtherwise = trapped.filter(
    (r) => !r.verdicts.some((v) => v.probe !== "ownerTrap" && v.status === "FAIL"),
  );
  const proxies = trapped.filter((r) =>
    r.verdicts.some((v) => v.probe === "ownerTrap" && v.status === "FAIL" && /proxy admin/i.test(v.title)),
  );
  return {
    traps: trapped.length,
    cleanOtherwise: cleanOtherwise.length,
    proxies: proxies.length,
    // The recognisable ones, so the claim lands before anybody clicks.
    names: cleanOtherwise
      .map((r) => r.scan.symbol)
      .filter((s) => ["USDC", "cbBTC", "cbETH", "DEGEN"].includes(s)),
  };
}

export default function Page() {
  return <LandingView trap={trapStat()} />;
}
