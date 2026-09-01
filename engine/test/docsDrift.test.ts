import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FIXTURE_COUNT, FIXTURES, SCANNER_STATS, SOURCIFY_STATS, VERIFICATION_STATS, headlineOf, type Verdict } from "@sidik/shared";

/**
 * The documents quote numbers; the catalogue produces them. This fails when
 * they part company.
 *
 * This is the defect this project keeps having. SUBMISSION.md was stale for
 * six days across a re-record and a catalogue widening; the README's
 * corroboration section was stale at the same time in the other direction, so
 * two documents in one repository disagreed about the same measurement. The
 * browser suite already guards the pages this way — it compares what /findings
 * renders against what /api/catalogue returns, with a comment noting that the
 * copy "drifted exactly this way for three commits" — but nothing watched the
 * prose, and the prose is what a judge reads first.
 *
 * Nothing here is hard-coded. Every expected value is computed from the same
 * exports the site renders from, so re-recording the catalogue moves the test
 * and the documents together or fails loudly.
 */
const root = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const README = root("README.md");
const SUBMISSION = root("docs/SUBMISSION.md");
const ACCOUNTS = root("docs/ACCOUNTS.md");

const runs = Object.values(FIXTURES) as { scan: { symbol: string }; verdicts: Verdict[] }[];
const tally = { FAIL: 0, PASS: 0, NA: 0 } as Record<string, number>;
for (const r of runs) tally[headlineOf(r.verdicts)] = (tally[headlineOf(r.verdicts)] ?? 0) + 1;
const trapped = runs.filter((r) => r.verdicts.some((v) => v.probe === "ownerTrap" && v.status === "FAIL"));
const cleanOtherwise = trapped.filter((r) => !r.verdicts.some((v) => v.probe !== "ownerTrap" && v.status === "FAIL"));
const txs = runs.reduce((n, r) => n + r.verdicts.reduce((m, v) => m + v.txHashes.length, 0), 0);

/** Every document that quotes catalogue figures, so a new one cannot be forgotten. */
const DOCS: [string, string][] = [["README.md", README], ["docs/SUBMISSION.md", SUBMISSION]];

// The README spells small counts out. Only as far as the numbers it actually
// uses -- a lookup that guesses past its evidence is the thing being guarded
// against here.
const WORDS: Record<number, string> = { 16: "Sixteen", 17: "Seventeen", 18: "Eighteen", 19: "Nineteen", 20: "Twenty" };

describe("the documents quote the catalogue that exists", () => {
  // The address count is the first number in every pitch and the easiest to
  // leave behind: widening the catalogue changes it and touches nothing else.
  it.each(DOCS)("%s uses the current address count", (_name, text) => {
    expect(text).toContain(`${FIXTURE_COUNT} addresses`);
  });

  // The headline finding. It has two halves and they went stale separately
  // once already, which is why both are asserted rather than just the one the
  // landing page shows.
  it.each(DOCS)("%s quotes verified-source both ways", (_name, text) => {
    expect(text).toContain(`${VERIFICATION_STATS.verified} of the ${VERIFICATION_STATS.checked}`);
    expect(text).toContain(`${VERIFICATION_STATS.failingVerified} of the ${VERIFICATION_STATS.failing}`);
  });

  // Where inference beats execution, and where it does not. The pitch quotes
  // these two by name, so they are asserted by name.
  it("SUBMISSION.md quotes both halves of the GoPlus comparison", () => {
    const tax = SCANNER_STATS.buyTaxGoplus;
    const trap = SCANNER_STATS.ownerTrapGoplus;
    expect(SUBMISSION).toContain(`${tax.agree} of ${tax.total}`);
    expect(SUBMISSION).toContain(`${trap.agree} of ${trap.total}`);
  });

  // The README carries a longer corroboration section than the pitch does, and
  // every figure in it had gone stale against an older catalogue. Matched as
  // the two numbers near each other rather than as one phrasing, so the check
  // constrains the figures and not the sentence around them.
  it.each(Object.entries(SCANNER_STATS))("README.md quotes %s against the current verdicts", (_key, c) => {
    const { agree, total } = c as { agree: number; total: number };
    const near = String.raw`\b${agree}\b[^.]{0,40}\b${total}\b|\b${total}\b[^.]{0,40}\b${agree}\b`;
    expect(README).toMatch(new RegExp(near));
  });

  // The second verifier. Caught stale only because a frame of the demo video
  // showed the site saying 42 where every document said 39 -- a number nobody
  // was watching, in the paragraph the pitch leads with.
  it("SUBMISSION.md quotes what Sourcify actually holds", () => {
    expect(SUBMISSION).toContain(`${SOURCIFY_STATS.exact} exact`);
    expect(SUBMISSION).toContain(`${SOURCIFY_STATS.partial} partial`);
  });

  it("SUBMISSION.md quotes the current verdict split and transaction count", () => {
    expect(SUBMISSION).toContain(`${txs.toLocaleString("en-US")} fork transactions`);
    expect(SUBMISSION).toContain(`${tally.FAIL} fail at least one probe`);
  });

  // The README states the same owner-trap result in words rather than digits
  // ("Seventeen are proxies"), and it was the half that went stale: it still
  // said 24 and sixteen after the catalogue had moved to 25 and 17.
  it("README.md quotes the owner-trap result", () => {
    const applicable = runs
      .map((r) => r.verdicts.find((v) => v.probe === "ownerTrap"))
      .filter((v): v is Verdict => Boolean(v) && v!.applicable !== false);
    const proxies = applicable.filter((v) => v.status === "FAIL" && /proxy admin/i.test(v.title));
    expect(README).toContain(`${applicable.length} of the ${FIXTURE_COUNT} recorded addresses`);
    expect(README).toContain(`${trapped.length} of
those failed`);
    expect(README).toContain(`${WORDS[proxies.length] ?? proxies.length} are proxies`);
  });

  it("SUBMISSION.md quotes the owner-trap result the pitch leads with", () => {
    expect(SUBMISSION).toContain(`${trapped.length} tokens have a privileged address`);
    expect(SUBMISSION).toContain(`${cleanOtherwise.length} of them pass every other probe`);
  });

  // The account copy is posted once and cannot be edited afterwards on some
  // platforms, so it is the worst place for a number to be wrong.
  it("the X and Telegram copy quotes the current catalogue", () => {
    expect(ACCOUNTS).toContain(`${FIXTURE_COUNT} Base tokens`);
    expect(ACCOUNTS).toContain(`${FIXTURE_COUNT} addresses recorded`);
    expect(ACCOUNTS).toContain(`${VERIFICATION_STATS.failingVerified} of the ${VERIFICATION_STATS.failing} we caught`);
    expect(ACCOUNTS).toContain(`${trapped.length} of the ${FIXTURE_COUNT}`);
    // The post that publishes the comparison Sidik loses. Both halves, because
    // posting only the winning one is the thing that post exists to avoid.
    expect(ACCOUNTS).toContain(`${SCANNER_STATS.buyTaxGoplus.agree} of ${SCANNER_STATS.buyTaxGoplus.total}`);
    expect(ACCOUNTS).toContain(`${SCANNER_STATS.ownerTrapGoplus.agree} of ${SCANNER_STATS.ownerTrapGoplus.total}`);
  });

  // Not a number, a refusal: the fork transactions were never broadcast, so no
  // document may send a reader to an explorer to check one.
  it.each([...DOCS, ["docs/ACCOUNTS.md", ACCOUNTS] as [string, string]])(
    "%s never points at an explorer for a fork transaction",
    (_name, text) => {
      expect(text).not.toMatch(/(basescan\.org|etherscan\.io)\/tx/);
    },
  );
});
