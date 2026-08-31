// Re-runs recorded addresses against a real fork and diffs what comes back
// against what is frozen in shared/src/fixtures.ts.
//
//   pnpm --filter @sidik/engine reproduce 0xToken [0xToken ...]
//   pnpm --filter @sidik/engine reproduce --sample 10
//   pnpm --filter @sidik/engine reproduce --all
//
// Why this exists: the site serves recorded runs, and "these are real runs,
// not mock data" is a claim the reader has no way to check. This is the way
// to check it. Point it at any address in the catalogue with your own Base
// archive RPC and it will fork Base at the same block, execute the same
// probes, and tell you whether the verdict it gets is the one published.
//
// Exits non-zero if any verdict differs, so it works as a gate as well as a
// demonstration.
//
// Two things are deliberately NOT compared:
//   - the narration, which is model prose and varies between runs by design;
//   - the transaction hashes, because the planner orders probes by asking a
//     model, and a different order means different nonces for the same work.
// Neither is a verdict. Everything a verdict asserts — its status, its title,
// and every row of its assumed-vs-proven table — is compared exactly.
import { FIXTURES, recordedRun } from "@sidik/shared";
import type { Hex, Verdict } from "@sidik/shared";
import { runSidik } from "../src/orchestrator";
import { BASE_FORK_BLOCK } from "../src/forkBlock";

if (!process.env.BASE_ARCHIVE_RPC) {
  process.stderr.write(
    "BASE_ARCHIVE_RPC is not set.\n"
    + "This command forks Base for real, so it needs an archive RPC — a free\n"
    + "Alchemy or similar key is enough. Put it in engine/.env or the environment.\n",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const recorded = Object.keys(FIXTURES);

function targets(): string[] {
  if (args.includes("--all")) return recorded;
  const sampleAt = args.indexOf("--sample");
  if (sampleAt !== -1) {
    const n = Number(args[sampleAt + 1] ?? "5");
    // Evenly spaced through the catalogue rather than the first N, which are
    // all seeds and examples — a sample of those says nothing about the rest.
    const step = Math.max(1, Math.floor(recorded.length / Math.max(1, n)));
    return recorded.filter((_, i) => i % step === 0).slice(0, n);
  }
  return args.filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
}

const wanted = targets();
if (!wanted.length) {
  process.stderr.write(
    "Usage: reproduce <0xaddress...> | --sample N | --all\n"
    + `The catalogue holds ${recorded.length} addresses at block ${BASE_FORK_BLOCK}.\n`,
  );
  process.exit(2);
}

/** Everything a verdict asserts, in a form two runs can be compared on. */
function claims(v: Verdict): string {
  return JSON.stringify({
    probe: v.probe,
    status: v.status,
    applicable: v.applicable !== false,
    title: v.title,
    rows: v.rows.map((r) => [r.label, r.claimed, r.proven, r.ok]),
  });
}

let matched = 0;
let differed = 0;
let unreachable = 0;

for (const [i, key] of wanted.entries()) {
  // recordedRun, not FIXTURES[key]: the runs are keyed by lowercase address
  // and every address a person can copy — off the run page, off an explorer,
  // out of the JSON API — is checksummed. Looking it up verbatim told the one
  // audience this command exists for that their token was not in a catalogue
  // it was sitting in.
  const frozen = recordedRun(key);
  if (!frozen) {
    process.stdout.write(`${key} is not in the catalogue\n`);
    differed++;
    continue;
  }
  const symbol = frozen.scan.symbol || key.slice(0, 10);
  process.stdout.write(`[${i + 1}/${wanted.length}] ${symbol} ${frozen.scan.token}\n`);

  const fresh: Verdict[] = [];
  let failure: string | undefined;
  for await (const ev of runSidik(frozen.scan.token as Hex, {
    // The cache is seeded from the very file being checked, so reading it
    // would compare the recording against itself.
    getCached: () => undefined,
    setCached: () => {},
  })) {
    if (ev.type === "verdict") fresh.push(ev.verdict);
    if (ev.type === "error") failure = ev.message;
  }

  if (failure) {
    process.stdout.write(`    could not run: ${failure.slice(0, 100)}\n`);
    unreachable++;
    continue;
  }

  for (const before of frozen.verdicts) {
    const after = fresh.find((v) => v.probe === before.probe);
    if (!after) {
      process.stdout.write(`    ${before.probe}: recorded, but did not run this time\n`);
      differed++;
      continue;
    }
    if (claims(after) === claims(before)) {
      process.stdout.write(`    ${before.probe}: ${before.status} — reproduced\n`);
      matched++;
      continue;
    }
    differed++;
    process.stdout.write(`    ${before.probe}: DIFFERS\n`);
    process.stdout.write(`      recorded: ${before.status} ${before.title}\n`);
    process.stdout.write(`      now:      ${after.status} ${after.title}\n`);
  }

  // A probe that did not exist when the run was frozen is not a mismatch, but
  // it is worth naming rather than passing over in silence.
  for (const extra of fresh.filter((v) => !frozen.verdicts.some((b) => b.probe === v.probe))) {
    process.stdout.write(`    ${extra.probe}: ${extra.status} — not in the recording\n`);
  }
}

process.stdout.write(
  `\n${matched} verdict(s) reproduced, ${differed} differed`
  + `${unreachable ? `, ${unreachable} address(es) could not be run` : ""}.\n`,
);
if (differed) {
  process.stdout.write(
    "A difference is worth reading before it is worth trusting: the fork block\n"
    + "is pinned, so the same address should produce the same verdict every time.\n",
  );
}
process.exit(differed ? 1 : 0);
