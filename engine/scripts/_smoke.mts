import { withFork } from "../src/fork.js";
import { prescan } from "../src/prescan.js";
import { lpRugProbe } from "../src/probes/lpRug.js";
import { ANVIL_ACCOUNT_0 } from "../src/base.js";
import { FIXTURES } from "@sidik/shared";
import type { Hex, ProbeCtx } from "@sidik/shared";
const BLOCK = 50_200_000n;
const say = (s: string) => process.stderr.write("### " + s + "\n");
const WANT = new Set(process.argv.slice(2).map((a) => a.toLowerCase()));
for (const [addr, rec] of Object.entries(FIXTURES) as [string, any][]) {
  if (!WANT.has(addr.toLowerCase())) continue;
  const before = rec.verdicts.find((v: any) => v.probe === "lpRug");
  try {
    await withFork(BLOCK, async (fork) => {
      const scan = await prescan(fork, rec.scan.token as Hex);
      const ctx: ProbeCtx = { token: rec.scan.token as Hex, scan, testWallet: ANVIL_ACCOUNT_0, block: BLOCK };
      await lpRugProbe.setup(fork, ctx);
      const v = lpRugProbe.interpret(await lpRugProbe.execute(fork, ctx), ctx);
      say(`${rec.scan.symbol.padEnd(9)} was ${before?.status}: ${before?.title.slice(0, 46)}`);
      say(`${" ".repeat(9)} now ${v.status}: ${v.title.slice(0, 78)}`);
      say(`${" ".repeat(9)} ${(v.rows[0]?.proven ?? "").slice(0, 150)}`);
    });
  } catch (e) { say(`${rec.scan.symbol}: FAILED ${String(e).slice(0, 100)}`); }
}
