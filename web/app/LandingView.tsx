"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EXAMPLES, FIXTURE_COUNT, VERIFICATION_STATS } from "@sidik/shared";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// What each example's run ends on. Shown on the button so the page teaches
// its own output before the first tap: a reader who has never seen a verdict
// learns there are exactly two words that matter and what colour each is.
const KIND_VERDICT: Record<string, { word: "PASS" | "FAIL"; tone: string }> = {
  safe: { word: "PASS", tone: "text-pass border-pass/40 bg-pass/15" },
  honeypot: { word: "FAIL", tone: "text-fail border-fail/40 bg-fail/15" },
  highfee: { word: "FAIL", tone: "text-fail border-fail/40 bg-fail/15" },
  wallet: { word: "FAIL", tone: "text-fail border-fail/40 bg-fail/15" },
  ownertrap: { word: "FAIL", tone: "text-fail border-fail/40 bg-fail/15" },
};

export interface TrapStat {
  /** Addresses whose owner can still stop a holder leaving. */
  traps: number;
  /** Of those, how many pass every OTHER probe Sidik ran. */
  cleanOtherwise: number;
  /** How many are a proxy admin swapping the implementation. */
  proxies: number;
  /** A few recognisable symbols among the clean-otherwise set. */
  names: string[];
}

export default function Home({ trap }: { trap: TrapStat }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  // A phone's clipboard almost never holds a bare address: it holds a
  // Basescan, DEX Screener or Uniswap URL with the address inside. Take the
  // first address found in whatever was pasted; only a paste with none in it
  // is a mistake.
  const extracted = address.match(/0x[0-9a-fA-F]{40}/)?.[0];
  const trimmed = extracted ?? address.trim();
  const valid = ADDRESS_RE.test(trimmed);
  // Only once something has been typed: an empty box is not a mistake, and
  // scolding someone before they have started is noise. Until this existed
  // the button simply sat there greyed out with nothing saying why, which
  // reads as a broken page rather than as invalid input.
  const problem = !trimmed || valid ? null
    : /^https?:\/\//i.test(trimmed) ? "No 0x… address found in that link."
    : !trimmed.startsWith("0x") ? "A Base address starts with 0x."
    : /[^0-9a-fA-F]/.test(trimmed.slice(2)) ? "Only the digits 0-9 and letters a-f can appear after 0x."
    : `That is ${trimmed.length - 2} characters after 0x; an address has 40.`;

  function run(token: string) {
    router.push(`/run?token=${token}`);
  }

  return (
    <div className="fingerprint-bg flex flex-1 flex-col items-center justify-center px-6 py-16 sm:py-24">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-2 font-mono text-sm tracking-[0.3em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          SIDIK
        </div>

        {/* No forced line break: it orphaned "token" on its own line at every
            width. text-balance lets the browser find the even break. */}
        <h1 className="text-balance font-mono text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-5xl">
          Sidik proves what a Base token does to you —{" "}
          <span className="text-accent">by doing it in a fork.</span>
        </h1>

        <p className="mt-5 max-w-xl text-base leading-7 text-fg-dim sm:text-lg">
          No wallet, no API key, no signup. Sidik bought, sold and transferred{" "}
          <span className="text-fg">{FIXTURE_COUNT} Base addresses</span>{" "}
          against a forked chain and recorded what each one actually did. Paste an
          address to see whether it is covered, or open an example.
        </p>

        <form
          className="mt-8 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) run(trimmed);
          }}
        >
          <label htmlFor="token-address" className="sr-only">
            Token address
          </label>
          <input
            id="token-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            inputMode="text"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "token-address-problem" : undefined}
            className={`flex-1 rounded-md border bg-panel px-4 py-3 font-mono text-sm text-fg placeholder:text-fg-dim/60 outline-none focus:ring-1 ${
              problem
                ? "border-fail/60 focus:border-fail focus:ring-fail"
                : "border-border focus:border-accent focus:ring-accent"
            }`}
          />
          <button
            type="submit"
            disabled={!valid}
            className="rounded-md bg-accent px-6 py-3 font-mono text-sm font-semibold text-ink transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
          >
            Run trace →
          </button>
        </form>

        {/* Announced, not just coloured: someone using a screen reader gets
            the same explanation as someone watching the border turn red. */}
        <p
          id="token-address-problem"
          role="status"
          aria-live="polite"
          className={`mt-2 font-mono text-xs ${problem ? "text-fail" : "sr-only"}`}
        >
          {problem ?? ""}
        </p>

        <div className="mt-10">
          <div className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-fg-dim">
            Or open an example
          </div>
          <div className="flex flex-wrap gap-3">
            {EXAMPLES.map((ex) => {
              const v = KIND_VERDICT[ex.kind] ?? KIND_VERDICT.safe!;
              return (
                <button
                  key={ex.address}
                  onClick={() => run(ex.address)}
                  className="group flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm text-fg transition hover:border-accent/60"
                >
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-widest ${v.tone}`}>
                    {v.word}
                  </span>
                  {ex.label}
                  <span
                    aria-hidden="true"
                    className="text-fg-dim transition group-hover:translate-x-0.5 group-hover:text-accent"
                  >
                    →
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* The number that says why executing beats reading, counted from
            Blockscout across the same catalogue and frozen into a constant at
            generation time — see engine/scripts/gen-verification.mts. Set as
            a figure with its sentence, not as a side-tabbed callout. */}
        <div className="mt-12 rounded-md border border-border bg-panel px-5 py-4">
          <div className="font-mono text-2xl font-semibold tabular-nums text-fg">
            {VERIFICATION_STATS.failingVerified}
            <span className="text-fg-dim"> of </span>
            {VERIFICATION_STATS.failing}
          </div>
          <p className="mt-1 max-w-xl text-sm leading-6 text-fg-dim">
            of the addresses that failed a probe publish verified source code — as do{" "}
            {VERIFICATION_STATS.verified} of all {VERIFICATION_STATS.checked}. &ldquo;Check that the
            contract is verified&rdquo; is the standard advice, and across this catalogue it
            separates almost nothing.
          </p>
          <a
            href="/catalogue"
            className="mt-3 inline-block font-mono text-sm text-accent underline-offset-4 hover:underline"
          >
            Browse all {FIXTURE_COUNT} recorded runs →
          </a>
        </div>

        {/* The second finding, and the one nothing but execution produces: a
            token can pass every trade test and still have somebody who can
            close the exit. Counted on the server from the recorded runs and
            passed in, so it cannot drift from the catalogue the way a
            hand-written number would. */}
        <div className="mt-6 rounded-md border border-border bg-panel px-5 py-4" data-owner-trap-stat>
          <div className="font-mono text-2xl font-semibold tabular-nums text-fg">
            {trap.cleanOtherwise}
            <span className="text-fg-dim"> of </span>
            {trap.traps}
          </div>
          <p className="mt-1 max-w-xl text-sm leading-6 text-fg-dim">
            addresses whose owner can still stop you selling{" "}
            <span className="text-fg">pass every other probe</span> — they buy, sell, transfer and
            price like a clean token{trap.names.length > 0 ? <> ({trap.names.join(", ")})</> : null}.
            Sidik pulled each switch on a fork and made the identical sell again.{" "}
            {trap.proxies} of the {trap.traps} are a proxy admin replacing the code, which is a
            design decision rather than an accusation — but it is the holder&rsquo;s exit either way.
          </p>
          <a
            href="/catalogue?filter=ownerTrap"
            className="mt-3 inline-block font-mono text-sm text-accent underline-offset-4 hover:underline"
          >
            See every one of them →
          </a>
        </div>

        <a
          href="/findings"
          className="mt-6 block rounded-md border border-accent/40 bg-accent/5 px-5 py-4 transition hover:border-accent/70"
        >
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
            All three findings, with the method →
          </div>
          <p className="mt-2 text-sm leading-6 text-fg-dim">
            What executing the whole catalogue established — including the one place inference wins,
            and how to re-run any of it yourself.
          </p>
        </a>
      </div>
    </div>
  );
}
