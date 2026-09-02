import type { Metadata } from "next";
import Link from "next/link";
import AddressBox from "../AddressBox";
import {
  FIXTURES,
  SCANNER_STATS,
  SOURCIFY_STATS,
  VERIFICATION_STATS,
  headlineOf,
  type Verdict,
} from "@sidik/shared";

/**
 * What executing the whole catalogue actually established.
 *
 * Every other page here answers "what about this address?". This one answers
 * "what did the whole exercise find?", which is a different question and the
 * only one that is a result rather than a lookup. Three findings, each with
 * the number, the method, and a link to the rows it came from — so a reader
 * who doubts any of it can go and disagree with the data instead of with a
 * claim about the data.
 *
 * Counted here on the server, like the landing page and for the same two
 * reasons: FIXTURES is every recorded run and must not reach the browser, and
 * a written-down number goes stale the moment the catalogue is re-recorded.
 */
const TITLE = "What Sidik found on Base — executed, not inferred";
const DESCRIPTION =
  "Three measured findings from executing every probe against the Base token surface on a fork: verified source is not safety, scanners agree on tax and not on power, and a token can pass every trade test and still have an exit its owner controls.";

// Its own card and its own description. The layout's defaults describe the
// product; this page is a result, and a shared link to it should say which.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/findings" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/findings",
    type: "article",
    images: [{ url: "/api/og?card=findings", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/api/og?card=findings", width: 1200, height: 630, alt: TITLE }],
  },
};

interface Findings {
  addresses: number;
  txs: number;
  fail: number;
  pass: number;
  na: number;
  traps: number;
  cleanOtherwise: number;
  proxies: number;
  trapNames: string[];
}

function count(): Findings {
  // Verdict rather than a hand-written shape: headlineOf takes the real
  // status union, and a looser local type only moves the mismatch to the
  // call site.
  const runs = Object.values(FIXTURES) as { scan: { symbol: string }; verdicts: Verdict[] }[];
  const tally = { FAIL: 0, PASS: 0, NA: 0 } as Record<string, number>;
  for (const r of runs) tally[headlineOf(r.verdicts)] = (tally[headlineOf(r.verdicts)] ?? 0) + 1;

  const trapped = runs.filter((r) => r.verdicts.some((v) => v.probe === "ownerTrap" && v.status === "FAIL"));
  const cleanOtherwise = trapped.filter((r) => !r.verdicts.some((v) => v.probe !== "ownerTrap" && v.status === "FAIL"));

  return {
    addresses: runs.length,
    txs: runs.reduce((n, r) => n + r.verdicts.reduce((m, v) => m + v.txHashes.length, 0), 0),
    fail: tally.FAIL ?? 0,
    pass: tally.PASS ?? 0,
    na: tally.NA ?? 0,
    traps: trapped.length,
    cleanOtherwise: cleanOtherwise.length,
    proxies: trapped.filter((r) =>
      r.verdicts.some((v) => v.probe === "ownerTrap" && v.status === "FAIL" && /proxy admin/i.test(v.title)),
    ).length,
    trapNames: cleanOtherwise.map((r) => r.scan.symbol),
  };
}

function Figure({ big, sub, children }: { big: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="font-mono text-3xl font-semibold tabular-nums text-fg sm:text-4xl">{big}</div>
      <div className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-accent">{sub}</div>
      <div className="mt-4 space-y-3 text-sm leading-6 text-fg-dim">{children}</div>
    </div>
  );
}

export default function FindingsPage() {
  const f = count();
  const tax = SCANNER_STATS.buyTaxGoplus;
  const trap = SCANNER_STATS.ownerTrapGoplus;

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
      <div className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Findings</div>
      <h1 className="mt-4 text-balance font-mono text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
        What executing {f.addresses} Base tokens actually established
      </h1>
      <p className="mt-5 text-base leading-7 text-fg-dim">
        Not a scan and not a score. Sidik bought, sold, transferred, pulled liquidity from and
        threw the ownership switches on {f.addresses} Base addresses against a fork of mainnet
        pinned at one block — <span className="text-fg">{f.txs.toLocaleString("en-US")} transactions</span>{" "}
        mined to reach {f.fail} findings. These three results are what the exercise produced. Each
        one is a number you can go and check.
      </p>

      <div className="mt-10 space-y-6">
        <Figure
          big={`${VERIFICATION_STATS.failingVerified} of ${VERIFICATION_STATS.failing}`}
          sub="Verified source is not safety"
        >
          <p>
            Addresses Sidik caught that <span className="text-fg">publish verified source code</span> —
            as do {VERIFICATION_STATS.verified} of all {VERIFICATION_STATS.checked}. Every honeypot,
            every hidden fee, every ruggable pool, every owner trap.
          </p>
          <p>
            Sourcify was asked the same question independently and agrees: {SOURCIFY_STATS.exact}{" "}
            exact matches including the metadata hash, {SOURCIFY_STATS.partial} partial. &ldquo;Check
            that the contract is verified&rdquo; is the advice everyone gives, and across this
            catalogue it separates almost nothing.
          </p>
        </Figure>

        <Figure
          big={`${tax.agree}/${tax.total} vs ${trap.agree}/${trap.total}`}
          sub="Inference agrees about tax, and not about power"
        >
          <p>
            The same catalogue was read by GoPlus, the check most wallets embed. On{" "}
            <span className="text-fg">buy tax it matched the executed figure on all {tax.total}</span>{" "}
            addresses — where inference is good, it is very good, and this page says so.
          </p>
          <p>
            On whether a privileged address can still stop a holder leaving, it agreed on{" "}
            <span className="text-fg">{trap.agree} of {trap.total}</span>. Execution found{" "}
            {trap.sidikOnly.length} the scanner did not; the scanner flagged{" "}
            {trap.scannerOnly.length} that execution could not confirm. Both directions are
            published, because a comparison that shows only the flattering half is not one.
          </p>
          <Link href="/catalogue?filter=scannerDisagrees" className="inline-block text-accent underline-offset-4 hover:underline">
            Every row where they disagree →
          </Link>
        </Figure>

        <Figure
          big={`${f.cleanOtherwise} of ${f.traps}`}
          sub="A clean token can still have an owner who closes the exit"
        >
          <p>
            Addresses whose owner can stop you selling that{" "}
            <span className="text-fg">pass every other probe</span> — they buy, sell, transfer and
            price like any healthy token. Sidik impersonated the privileged address, pulled the
            switch, and made the identical sell again.
          </p>
          <p className="font-mono text-xs text-fg">{f.trapNames.join(" · ")}</p>
          <p>
            {f.proxies} of the {f.traps} are a proxy admin replacing the implementation, which is
            why household names are on that list. That is a proof of capability and nothing more:
            it has not happened, it may never, and none of it happened on Base. A contract having
            an admin is a design decision, not an accusation — but the exit is that admin&rsquo;s
            either way, and no amount of reading the source tells you which way they will go.
          </p>
          <Link href="/catalogue?filter=ownerTrap" className="inline-block text-accent underline-offset-4 hover:underline">
            Every one of them →
          </Link>
        </Figure>
      </div>

      {/* This page is the demo link, and the rules say judges try what they
          can run. Until now there was nothing on it to run: three findings, a
          few deep links, and no way to point Sidik at anything. */}
      <section className="mt-14 rounded-xl border border-accent/40 bg-accent/5 p-6" data-try-it>
        <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Try it on your own token</h2>
        <p className="mt-3 text-sm leading-6 text-fg-dim">
          Paste any Base address. If it is one of the {f.addresses} already recorded you get that
          run instantly; if it is not,{" "}
          <span className="text-fg">Sidik forks Base and executes the probes while you watch</span>,
          in about half a minute. Nothing is broadcast, and nothing needs a wallet.
        </p>
        <div className="mt-4">
          <AddressBox id="findings-address" label="Base token address" cta="Run it →" />
        </div>
        <div className="mt-5 grid gap-3 text-sm leading-6 text-fg-dim sm:grid-cols-2">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-fg-dim">At today&rsquo;s block</div>
            <p className="mt-1">
              Every recorded verdict describes one block in August. Add{" "}
              <code className="font-mono text-fg">&amp;live=1&amp;at=head</code> to any run and Sidik
              forks Base where it is now, then says what changed since.
            </p>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-fg-dim">As a tool</div>
            <p className="mt-1">
              An agent can call a fork execution instead of a scanner:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-ink p-3 font-mono text-[11px] leading-5 text-fg">
claude mcp add --transport http   sidik https://sidik-eight.vercel.app/api/mcp</pre>
          </div>
        </div>
      </section>

      <h2 className="mt-14 font-mono text-xs uppercase tracking-[0.3em] text-accent">
        If you decide what gets listed
      </h2>
      <div className="mt-4 space-y-3 text-sm leading-6 text-fg-dim">
        <p>
          The three findings above are the same three questions an exchange or a launchpad answers
          before a token goes live, and the standard checks answer two of them badly.
        </p>
        <ul className="ml-4 list-disc space-y-2">
          <li>
            <span className="text-fg">Verified source tells you nothing about safety.</span>{" "}
            {VERIFICATION_STATS.failingVerified} of the {VERIFICATION_STATS.failing} addresses with a
            finding against them publish it.
          </li>
          <li>
            <span className="text-fg">A scanner is the right tool for tax and the wrong one for
            power.</span> {tax.agree}/{tax.total} against {trap.agree}/{trap.total} — use both, but
            not interchangeably.
          </li>
          <li>
            <span className="text-fg">Nothing static tells you who can close the exit.</span> The
            only way to know is to pull the switch and try to sell again, which is what the{" "}
            {f.traps} rows behind that third figure are.
          </li>
        </ul>
        <p>
          Sidik answers the last one by executing it. It does not score a token, rank it, or tell
          you whether to list it — it reports what happened when it tried, and the decision stays
          where it belongs.
        </p>
      </div>

      <h2 className="mt-14 font-mono text-xs uppercase tracking-[0.3em] text-accent">How to disagree with this</h2>
      <div className="mt-4 space-y-3 text-sm leading-6 text-fg-dim">
        <p>
          {f.pass} of the {f.addresses} passed everything that applied and {f.na} returned N/A —
          a probe that finds no mechanism to test says so rather than calling the token clean.
          Nothing here is a prediction, a score, or a rating.
        </p>
        <p>
          Every figure came from a transaction mined on an ephemeral fork. Those transactions were
          never broadcast, so no block explorer will resolve their hashes, and the pages say that
          rather than linking somewhere empty. To check any of it, fork Base at the same block with
          your own archive RPC and re-run the probes:
        </p>
        <pre className="overflow-x-auto rounded-md border border-border bg-ink p-4 font-mono text-xs text-fg">
          pnpm --filter @sidik/engine reproduce &lt;address&gt;
        </pre>
        <p>
          It diffs what comes back against what is published, and runs in CI on every push. Every
          JSON response carries the recording date, the engine commit and a sha256 of the catalogue
          you can recompute from a checkout.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap gap-4 font-mono text-sm">
        <Link href="/catalogue" className="text-accent underline-offset-4 hover:underline">
          Browse all {f.addresses} runs →
        </Link>
        <Link href="/" className="text-fg-dim underline-offset-4 hover:underline">
          ← back to Sidik
        </Link>
      </div>
    </div>
  );
}
