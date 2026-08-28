"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EXAMPLES, FIXTURE_COUNT, VERIFICATION_STATS } from "@sidik/shared";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const KIND_DOT: Record<string, string> = {
  safe: "bg-pass",
  honeypot: "bg-fail",
  highfee: "bg-na",
  wallet: "bg-fail",
  ownertrap: "bg-fail",
};

export default function Home() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const trimmed = address.trim();
  const valid = ADDRESS_RE.test(trimmed);
  // Only once something has been typed: an empty box is not a mistake, and
  // scolding someone before they have started is noise. Until this existed
  // the button simply sat there greyed out with nothing saying why, which
  // reads as a broken page rather than as invalid input.
  const problem = !trimmed || valid ? null
    : !trimmed.startsWith("0x") ? "A Base address starts with 0x."
    : /[^0-9a-fA-F]/.test(trimmed.slice(2)) ? "Only the digits 0-9 and letters a-f can appear after 0x."
    : trimmed.length < 42 ? `That is ${trimmed.length - 2} characters after 0x; an address has 40.`
    : `That is ${trimmed.length - 2} characters after 0x; an address has 40.`;

  function run(token: string) {
    router.push(`/run?token=${token}`);
  }

  return (
    <div className="fingerprint-bg flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-2 font-mono text-sm tracking-[0.3em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          SIDIK
        </div>

        <h1 className="font-mono text-4xl font-semibold leading-tight tracking-tight text-fg sm:text-5xl">
          Sidik proves what a Base token
          <br />
          does to you —{" "}
          <span className="text-accent">by doing it in a fork.</span>
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-7 text-fg-dim">
          No wallet, no API key, no signup. Sidik bought, sold and transferred{" "}
          <span className="text-fg">{FIXTURE_COUNT} Base addresses</span>{" "}
          against a forked chain and recorded what each one actually did — the
          buy that worked, the sell that reverted, the fee nobody documented.
          Pick one below, or paste an address to see whether it is covered.
        </p>

        {/* The number that says why executing beats reading. Counted from
            Blockscout across the same catalogue, frozen into a constant at
            generation time — see engine/scripts/gen-verification.mts. */}
        <p className="mt-5 max-w-xl border-l-2 border-accent/50 pl-4 text-sm leading-6 text-fg-dim">
          <span className="text-fg">
            {VERIFICATION_STATS.verified} of those {VERIFICATION_STATS.checked} publish verified
            source code
          </span>{" "}
          — and so do {VERIFICATION_STATS.failingVerified} of the{" "}
          {VERIFICATION_STATS.failing} that failed a probe. &ldquo;Check that the contract is
          verified&rdquo; is the standard advice, and across this catalogue it separates almost
          nothing.
        </p>

        <form
          className="mt-10 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) run(address.trim());
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
          {/* The catalogue is the largest thing this project has, and until now
              the only way to reach any of it was to already know an address. */}
          <a
            href="/catalogue"
            className="font-mono text-sm text-accent underline-offset-4 hover:underline"
          >
            Browse all {FIXTURE_COUNT} recorded runs →
          </a>
        </div>

        <div className="mt-14">
          <div className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-fg-dim">
            Or try an example
          </div>
          <div className="flex flex-wrap gap-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.address}
                onClick={() => run(ex.address)}
                className="group flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm text-fg transition hover:border-accent/60"
              >
                <span className={`h-2 w-2 rounded-full ${KIND_DOT[ex.kind]}`} />
                {ex.label}
                <span className="text-fg-dim transition group-hover:translate-x-0.5 group-hover:text-accent">
                  →
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
