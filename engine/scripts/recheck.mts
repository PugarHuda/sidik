// Re-executes the honeypot probe against a fork of Base at TODAY's head for
// recorded addresses, and prints the verdict then, the verdict now, and what
// the scanners say today.
//
//   pnpm --filter @sidik/engine recheck COBIE KEYCAT 0xabc...
//
// Why this exists: every verdict describes block 50,200,000 and every scanner
// reading describes the day it was asked. When they disagree, "the token
// changed since the pin" and "the scanner is wrong" look identical from the
// outside — and only executing at the head tells them apart. On 2026-08-28
// it did: COBIE, KEYCAT, NVO and CASHCAT, all flagged by a scanner that day,
// all sold on a fork of that day's head, 8.1 days after the pin.
//
// Only the honeypot probe is run, one address at a time, output as it comes.
// The fork itself takes seconds; what can take minutes is the holder sample
// in prescan, which retries a too-large getLogs on a busy token.
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { withFork } from "../src/fork.js";
import { prescan } from "../src/prescan.js";
import { honeypotProbe } from "../src/probes/honeypot.js";
import { ANVIL_ACCOUNT_0 } from "../src/base.js";
import { FIXTURES, scannersOf } from "@sidik/shared";
import type { Hex, ProbeCtx } from "@sidik/shared";
const log = (s: string) => process.stdout.write(s + "\n");
const pub = createPublicClient({ chain: base, transport: http(process.env.BASE_ARCHIVE_RPC!) });
const head = (await pub.getBlockNumber()) - 20n;
log(`head block ${head}; ${Number(head - 50200000n).toLocaleString()} blocks (~${(Number(head - 50200000n) * 2 / 86400).toFixed(1)} days) after the pin`);
const WANT = process.argv.slice(2);
if (!WANT.length) { log("usage: recheck <symbol|0xaddress> ..."); process.exit(2); }
const wanted = (a: string, symbol: string) =>
  WANT.some((w) => w.toLowerCase() === a.toLowerCase() || w === symbol);
for (const [a, r] of Object.entries(FIXTURES)) {
  if (!wanted(a, r.scan.symbol)) continue;
  const then = r.verdicts.find((v) => v.probe === "honeypot")!;
  const trap = r.verdicts.find((v) => v.probe === "ownerTrap");
  const sc = scannersOf(a);
  const t0 = Date.now();
  try {
    await withFork(head, async (fork) => {
      const scan = await prescan(fork, r.scan.token as Hex);
      if (!scan.hasPool) { log(`${r.scan.symbol.padEnd(8)} at head: NO POOL (then honeypot=${then.status}) [${Date.now() - t0}ms]`); return; }
      const ctx: ProbeCtx = { token: r.scan.token as Hex, scan, testWallet: ANVIL_ACCOUNT_0, block: head };
      await honeypotProbe.setup(fork, ctx);
      const v = honeypotProbe.interpret(await honeypotProbe.execute(fork, ctx), ctx);
      log(`${r.scan.symbol.padEnd(8)} then=${then.status} ownerTrap=${trap?.status ?? "-"} | HEAD=${v.status} "${v.title.slice(0, 64)}" | goplus=${sc?.goplus?.isHoneypot} honeypot.is=${sc?.honeypotIs?.isHoneypot} [${Date.now() - t0}ms]`);
    });
  } catch (e) { log(`${r.scan.symbol.padEnd(8)} head fork failed: ${String(e).slice(0, 90)}`); }
}
