"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * The one control that starts everything, shared by the landing page and the
 * findings page.
 *
 * It lived only on the landing until the findings page was submitted as the
 * demo link — the page a judge is told to open first, which had no way to try
 * anything on it. Extracting it beats a second copy: the paste handling below
 * is the part with the judgement in it, and two copies of a judgement drift.
 */
export default function AddressBox(
  { id, label, cta, className = "" }: { id: string; label: string; cta: string; className?: string },
) {
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
  // scolding someone before they have started is noise.
  const problem = !trimmed || valid ? null
    : /^https?:\/\//i.test(trimmed) ? "No 0x… address found in that link."
    : !trimmed.startsWith("0x") ? "A Base address starts with 0x."
    : /[^0-9a-fA-F]/.test(trimmed.slice(2)) ? "Only the digits 0-9 and letters a-f can appear after 0x."
    : `That is ${trimmed.length - 2} characters after 0x; an address has 40.`;

  return (
    <form
      className={`flex flex-col gap-3 sm:flex-row ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) router.push(`/run?token=${trimmed}`);
      }}
    >
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="0x…"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        className={`flex-1 rounded-md border bg-panel px-4 py-3 font-mono text-sm text-fg placeholder:text-fg-dim/60 outline-none focus:ring-1 ${
          problem ? "border-fail/60 focus:border-fail focus:ring-fail" : "border-border focus:border-accent focus:ring-accent"
        }`}
      />
      <button
        type="submit"
        disabled={!valid}
        className="rounded-md bg-accent px-6 py-3 font-mono text-sm font-semibold text-ink transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
      >
        {cta}
      </button>
      <p id={`${id}-problem`} role="status" aria-live="polite" className={`font-mono text-xs ${problem ? "text-fail" : "sr-only"}`}>
        {problem ?? ""}
      </p>
    </form>
  );
}
