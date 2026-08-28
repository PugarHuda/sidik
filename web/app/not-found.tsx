import Link from "next/link";
import { FIXTURE_COUNT } from "@sidik/shared";

/**
 * Every other dead end in the app says plainly what happened and where to go;
 * an unknown path used to fall through to Next's unstyled default, in the
 * wrong fonts and with none of that.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="font-mono text-xs uppercase tracking-widest text-na">No page here</div>
      <p className="text-fg-dim">
        Sidik has two kinds of page: a run for one Base address, and the catalogue of
        every address it has traded — {FIXTURE_COUNT} so far.
      </p>
      <div className="flex flex-wrap justify-center gap-3 font-mono text-sm">
        <Link href="/" className="text-accent hover:underline">← paste an address</Link>
        <Link href="/catalogue" className="text-accent hover:underline">browse every recorded run →</Link>
      </div>
    </div>
  );
}
