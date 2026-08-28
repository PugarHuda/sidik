"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * A render error must never read as a finding about a token. The boundary
 * says the page broke, offers a reload, and claims nothing about the address.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Vercel's runtime logs are the only trace this app keeps; a swallowed
    // boundary error would leave none.
    console.error("page render failed", error.digest ?? "", error.message);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="font-mono text-xs uppercase tracking-widest text-fail">Page failed to render</div>
      <p className="text-fg-dim">
        Something in this page threw before it could draw. Nothing here is a verdict about any token.
      </p>
      <div className="flex flex-wrap justify-center gap-3 font-mono text-sm">
        <button type="button" onClick={reset} className="text-accent hover:underline">Reload this page</button>
        <Link href="/" className="text-accent hover:underline">← back to Sidik</Link>
      </div>
    </div>
  );
}
