import type { Verdict } from "./types";

/**
 * What changed about a token between two blocks.
 *
 * Every recorded verdict in this catalogue describes one pinned block. That is
 * what makes 207 runs comparable with each other, and it is also a statement
 * with an expiry date: an owner can be renounced, or acquired, and the
 * catalogue would go on saying what was true in August. Executing the same
 * probes at the head of the chain answers the other question, and the
 * interesting part is not either answer on its own — it is the difference.
 *
 * Pure, and separate from both the engine and the page, because a comparison
 * that decides "this token got worse" is the kind of claim that has to be
 * checkable line by line.
 */

/** A probe's state at one block. `absent` means that run has no such verdict. */
export type ProbeState = "PASS" | "FAIL" | "NA" | "n/a here" | "absent";

export interface ProbeChange {
  probe: string;
  before: ProbeState;
  after: ProbeState;
  changed: boolean;
  /** The later run's sentence, which is the one describing the chain now. */
  title?: string;
}

export interface RunDiff {
  changes: ProbeChange[];
  /** Only the probes whose state actually moved. */
  changed: ProbeChange[];
  /** True when a probe that passed now fails, which is the case worth shouting about. */
  regressed: boolean;
  /** True when something that failed no longer does. */
  improved: boolean;
}

function stateOf(v: Verdict | undefined): ProbeState {
  if (!v) return "absent";
  // A probe with no mechanism to test is a different answer from one that
  // tried and could not tell, and collapsing them would report a token that
  // renounced its owner as having "changed from NA to NA".
  if (v.applicable === false) return "n/a here";
  return v.status;
}

/**
 * `before` is the earlier block's verdicts, `after` the later one's.
 *
 * Probes are matched by id and the union is walked, so a probe that ran at
 * only one of the two blocks is reported as appearing or disappearing rather
 * than silently dropped — that is exactly what happens when a contract gains
 * or loses an ownership switch.
 */
export function diffRuns(before: Verdict[], after: Verdict[]): RunDiff {
  const ids = [...new Set([...before.map((v) => v.probe), ...after.map((v) => v.probe)])];
  const changes: ProbeChange[] = ids.map((probe) => {
    const b = stateOf(before.find((v) => v.probe === probe));
    const a = after.find((v) => v.probe === probe);
    const state = stateOf(a);
    return { probe, before: b, after: state, changed: b !== state, ...(a ? { title: a.title } : {}) };
  });
  const changed = changes.filter((c) => c.changed);
  return {
    changes,
    changed,
    regressed: changed.some((c) => c.before === "PASS" && c.after === "FAIL"),
    // Landing on NA is the one move that says nothing about the token: the
    // engine emits a plain NA for a probe that threw or ran out of budget, so
    // "FAIL -> NA" is a probe that could not be re-run, not a fault that got
    // fixed. Counted as an improvement, it announced a honeypot as cured on
    // the strength of a rate-limited RPC. Reaching "n/a here" is different and
    // stays an improvement — the mechanism is genuinely gone from the
    // bytecode, which is what a renounced owner looks like.
    improved: changed.some((c) => c.before === "FAIL" && !UNMEASURED.has(c.after) && c.after !== "FAIL" && c.after !== "absent"),
  };
}

/** States that mean "no answer was obtained", as opposed to an answer. */
const UNMEASURED = new Set<ProbeState>(["NA"]);

/** One sentence a reader can act on, or undefined when nothing moved. */
export function describeDiff(diff: RunDiff, beforeBlock: string, afterBlock: string): string | undefined {
  if (diff.changed.length === 0) return undefined;
  const n = diff.changed.length;
  const which = diff.changed.map((c) => c.probe).join(", ");
  // When every move was into "could not tell", nothing about the token was
  // measured at the later block, and "the answer changed" would be a claim
  // built out of our own failure to get one.
  const measured = diff.changed.filter((c) => !UNMEASURED.has(c.after));
  const lead = diff.regressed
    ? "Something that passed at the pinned block does not pass now."
    : diff.improved
      ? "Something that failed at the pinned block no longer does."
      : measured.length === 0
        ? "No answer could be obtained at the later block for what changed, so nothing here is a finding about the token."
        : "The answer changed between the two blocks.";
  return `${lead} ${n} probe${n === 1 ? "" : "s"} changed between block ${beforeBlock} and block ${afterBlock}: ${which}.`;
}
