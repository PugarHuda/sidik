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
    improved: changed.some((c) => c.before === "FAIL" && c.after !== "FAIL" && c.after !== "absent"),
  };
}

/** One sentence a reader can act on, or undefined when nothing moved. */
export function describeDiff(diff: RunDiff, beforeBlock: string, afterBlock: string): string | undefined {
  if (diff.changed.length === 0) return undefined;
  const n = diff.changed.length;
  const which = diff.changed.map((c) => c.probe).join(", ");
  const lead = diff.regressed
    ? "Something that passed at the pinned block does not pass now."
    : diff.improved
      ? "Something that failed at the pinned block no longer does."
      : "The answer changed between the two blocks.";
  return `${lead} ${n} probe${n === 1 ? "" : "s"} changed between block ${beforeBlock} and block ${afterBlock}: ${which}.`;
}
