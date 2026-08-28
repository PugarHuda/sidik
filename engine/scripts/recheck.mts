// Re-executes the honeypot probe against a fork of Base at TODAY's head for
// recorded addresses, prints the verdict then, the verdict now, and what the
// scanners say today — and writes the result into shared/src/rechecks.ts so
// the run page and the JSON can show it.
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
// Only the honeypot probe is run, one address at a time, written as it comes
// (merge-on-write, so an interrupted run keeps what it finished).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { withFork } from "../src/fork.js";
import { prescan } from "../src/prescan.js";
import { honeypotProbe } from "../src/probes/honeypot.js";
import { ANVIL_ACCOUNT_0 } from "../src/base.js";
import { FIXTURES, scannersOf } from "@sidik/shared";
import type { Hex, ProbeCtx, Recheck } from "@sidik/shared";

const OUT = fileURLToPath(new URL("../../shared/src/rechecks.ts", import.meta.url));
const log = (s: string) => process.stdout.write(s + "\n");

function loadExisting(): Record<string, Recheck> {
  try {
    const src = readFileSync(OUT, "utf8");
    const m = src.match(/export const RECHECKS: Record<string, Recheck> = (\{[\s\S]*?\n\});/);
    return m?.[1] ? (JSON.parse(m[1]) as Record<string, Recheck>) : {};
  } catch {
    return {};
  }
}

function write(entry: Record<string, Recheck>): void {
  const merged = { ...loadExisting(), ...entry };
  const src = readFileSync(OUT, "utf8");
  const next = src.replace(
    /export const RECHECKS: Record<string, Recheck> = \{[\s\S]*?\n?\};/,
    `export const RECHECKS: Record<string, Recheck> = ${JSON.stringify(merged, null, 2)};`,
  );
  writeFileSync(OUT, next);
}

const pub = createPublicClient({ chain: base, transport: http(process.env.BASE_ARCHIVE_RPC!) });
const head = (await pub.getBlockNumber()) - 20n;
const checkedOn = new Date().toISOString().slice(0, 10);
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
      if (!scan.hasPool) {
        log(`${r.scan.symbol.padEnd(8)} at head: NO POOL (then honeypot=${then.status}) [${Date.now() - t0}ms]`);
        write({ [a]: { headBlock: head.toString(), checkedOn, status: "NA", title: "No pool at head — nothing to trade against" } });
        return;
      }
      const ctx: ProbeCtx = { token: r.scan.token as Hex, scan, testWallet: ANVIL_ACCOUNT_0, block: head };
      await honeypotProbe.setup(fork, ctx);
      const v = honeypotProbe.interpret(await honeypotProbe.execute(fork, ctx), ctx);
      log(`${r.scan.symbol.padEnd(8)} then=${then.status} ownerTrap=${trap?.status ?? "-"} | HEAD=${v.status} "${v.title.slice(0, 64)}" | goplus=${sc?.goplus?.isHoneypot} honeypot.is=${sc?.honeypotIs?.isHoneypot} [${Date.now() - t0}ms]`);
      write({ [a]: { headBlock: head.toString(), checkedOn, status: v.status, title: v.title } });
    });
  } catch (e) { log(`${r.scan.symbol.padEnd(8)} head fork failed: ${String(e).slice(0, 90)}`); }
}
