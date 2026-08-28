// Every figure the README and docs/SUBMISSION.md quote, counted from what is
// actually recorded.
//
//   pnpm --filter @sidik/engine counts
//
// Exists because the submission copy asks the reader to "re-run the counts
// before reusing this", and a document that asks for that without shipping
// the command is asking for the numbers to drift. Reads only the frozen runs
// and the generated corroboration files -- no network, no fork.
import { FIXTURES, SCANNER_STATS, VERIFICATION_STATS, verificationOf, catalogueRows, catalogueSummary, headlineOf, scannersOf, venueListings } from "@sidik/shared";

const rows = catalogueRows();
const s = catalogueSummary(rows);
const runs = Object.entries(FIXTURES);
const txs = runs.reduce((n, [, r]) => n + r.verdicts.reduce((m, v) => m + v.txHashes.length, 0), 0);

console.log(`addresses            ${runs.length}`);
console.log(`fork transactions    ${txs}`);
console.log(`headline FAIL        ${s.failing}`);
console.log(`  honeypot           ${s.honeypots}`);
console.log(`  hiddenFee          ${s.taxed}`);
console.log(`  lpRug              ${s.lpRugs}`);
console.log(`  ownerTrap          ${s.ownerTraps}`);
console.log(`  approvalDrain      ${s.drainableWallets}`);
console.log(`on V3 / V2           ${s.onV3} / ${s.onV2}`);
console.log(`verified source      ${VERIFICATION_STATS.verified}/${VERIFICATION_STATS.checked}`);
console.log(`  of the failing      ${VERIFICATION_STATS.failingVerified}/${VERIFICATION_STATS.failing}`);

// Per-probe verified split, the sentence the README makes.
for (const probe of ["honeypot", "hiddenFee", "lpRug", "ownerTrap", "approvalDrain"]) {
  const hit = runs.filter(([, r]) => r.verdicts.some((v) => v.probe === probe && v.status === "FAIL"));
  const ver = hit.filter(([a]) => verificationOf(a)?.verified);
  if (hit.length) console.log(`  ${probe.padEnd(16)} ${ver.length}/${hit.length} verified`);
}

const ownerTrap = runs.map(([a, r]) => [a, r.verdicts.find((v) => v.probe === "ownerTrap")] as const)
  .filter(([, v]) => v);
const byStatus = new Map<string, number>();
for (const [, v] of ownerTrap) {
  const k = v!.applicable === false ? "n/a here" : v!.status;
  byStatus.set(k, (byStatus.get(k) ?? 0) + 1);
}
console.log(`\nownerTrap ran on     ${ownerTrap.length}`);
for (const [k, n] of [...byStatus].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${n}`);
const trapped = ownerTrap.filter(([, v]) => v!.status === "FAIL");
console.log(`\nowner traps proven:`);
for (const [a, v] of trapped) console.log(`  ${(FIXTURES[a]!.scan.symbol || "?").padEnd(12)} ${v!.title.slice(0, 96)}`);
const cleanButTrapped = trapped.filter(([a]) =>
  FIXTURES[a]!.verdicts.filter((v) => v.probe !== "ownerTrap" && v.applicable !== false).every((v) => v.status !== "FAIL"));
console.log(`\n${cleanButTrapped.length} of those pass every OTHER probe: ${cleanButTrapped.map(([a]) => FIXTURES[a]!.scan.symbol).join(", ")}`);

const withVenues = runs.filter(([a]) => venueListings(a).length > 0);
console.log(`\ncrossVenue listings   ${withVenues.length} addresses; ${withVenues.filter(([a]) => venueListings(a).length > 1).length} on both venues`);
const incomplete = runs.filter(([, r]) => headlineOf(r.verdicts) === "NA" && r.verdicts.length === 0);
console.log(`runs with no verdicts ${incomplete.length}`);

// Read-only scanners beside the executed verdicts. Both directions of
// disagreement are printed; a comparison that shows only the flattering half
// is not one.
const withScanner = runs.filter(([a]) => scannersOf(a));
console.log(`
scanner readings      ${withScanner.length} addresses (goplus ${runs.filter(([a]) => scannersOf(a)?.goplus).length}, honeypot.is ${runs.filter(([a]) => scannersOf(a)?.honeypotIs).length})`);
for (const [name, c] of Object.entries(SCANNER_STATS)) {
  console.log(`  ${name.padEnd(20)} agree ${c.agree}/${c.total}; execution-only ${c.sidikOnly.length} [${c.sidikOnly.join(", ")}]; scanner-only ${c.scannerOnly.length} [${c.scannerOnly.join(", ")}]`);
}
