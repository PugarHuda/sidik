"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EXAMPLES } from "@sidik/shared";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const KIND_DOT: Record<string, string> = {
  safe: "bg-pass",
  honeypot: "bg-fail",
  highfee: "bg-na",
};

export default function Home() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const valid = ADDRESS_RE.test(address.trim());

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
          No wallet, no API key, no signup. Drop in a token address and watch
          Sidik buy it, sell it, and transfer it against a live Base fork —
          then show you exactly where the claims and the proof disagree.
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
            className="flex-1 rounded-md border border-border bg-panel px-4 py-3 font-mono text-sm text-fg placeholder:text-fg-dim/60 outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={!valid}
            className="rounded-md bg-accent px-6 py-3 font-mono text-sm font-semibold text-ink transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
          >
            Run trace →
          </button>
        </form>

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
