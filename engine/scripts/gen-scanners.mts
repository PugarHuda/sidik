// Records what two widely used read-only token scanners say about every
// address in the catalogue, into shared/src/scanners.ts.
//
//   pnpm --filter @sidik/engine scanners
//   SIDIK_RESCAN=1 pnpm --filter @sidik/engine scanners   # re-ask every address
//
// Why this exists: the thesis is that executing a token beats inferring
// about it, and a thesis is worth exactly what it measures. GoPlus is the
// scanner most wallets and DEX front-ends embed; honeypot.is simulates a buy
// and a sell of its own. Recording what each says about the same 194
// addresses turns "read-only tools miss things" from a claim into a table:
// every address where a scanner and an executed verdict disagree is listed,
// in both directions.
//
// What this is NOT: evidence. A scanner's flag changes no verdict. It also
// describes the chain AS IT IS TODAY — neither API can be pinned to a block —
// while every verdict describes block 50,200,000. The file records when it
// was asked so that gap is visible rather than implied away.
//
// Both endpoints are free and keyless, and both are asked one address at a
// time with a pause: GoPlus answered one address of three when given three,
// and honeypot.is publishes no rate limit worth trusting.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "@sidik/shared";

const GOPLUS = process.env.GOPLUS_BASE_URL ?? "https://api.gopluslabs.io";
const HONEYPOT_IS = process.env.HONEYPOT_IS_BASE_URL ?? "https://api.honeypot.is";
const BASE_CHAIN_ID = 8453;
const GAP_MS = 450;
const ATTEMPTS = 4;
const TIMEOUT_MS = 25_000;

/** A yes/no the scanner committed to, or undefined where it gave no answer. */
type Flag = boolean | undefined;

// Every flag optional: a missing key IS the "no answer" case once this has
// been through JSON.stringify, which drops undefined. GoPlus also returns a
// bare `{ is_open_source }` for tokens it has never analysed.
export interface GoPlusReading {
  isHoneypot?: boolean;
  /** Percent, as GoPlus reports it; absent where it could not say. */
  buyTaxPct?: number;
  sellTaxPct?: number;
  isMintable?: boolean;
  transferPausable?: boolean;
  isBlacklisted?: boolean;
  ownerChangeBalance?: boolean;
  canTakeBackOwnership?: boolean;
  hiddenOwner?: boolean;
  isOpenSource?: boolean;
  tradingCooldown?: boolean;
  isAntiWhale?: boolean;
  cannotSellAll?: boolean;
}

export interface HoneypotIsReading {
  isHoneypot: boolean;
  /** "low" | "medium" | "high" | "honeypot" | ... as the service names it. */
  risk: string;
  riskLevel: number;
  buyTaxPct?: number;
  sellTaxPct?: number;
  transferTaxPct?: number;
  /** The service's own flag ids, verbatim. */
  flags: string[];
  simulationSuccess: boolean;
}

export interface ScannerReadings {
  /** ISO date the scanners were asked. They describe the chain then, not the fork block. */
  askedOn: string;
  goplus?: GoPlusReading;
  honeypotIs?: HoneypotIsReading;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GoPlus encodes yes/no as "1"/"0" and "don't know" as "". */
function flag(v: unknown): Flag {
  if (v === "1" || v === 1 || v === true) return true;
  if (v === "0" || v === 0 || v === false) return false;
  return undefined;
}
/** GoPlus taxes are fractions in a string ("0.03"); "" means it could not tell. */
function pctOf(v: unknown): number | undefined {
  if (v === "" || v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10000) / 100 : undefined;
}

async function getJson(url: string): Promise<unknown | undefined> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "sidik" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 429) { await sleep(3_000 * (attempt + 1)); continue; }
      if (!res.ok) return undefined;
      return await res.json();
    } catch {
      await sleep(1_500 * (attempt + 1));
    }
  }
  return undefined;
}

async function askGoPlus(address: string): Promise<GoPlusReading | undefined> {
  const body = await getJson(`${GOPLUS}/api/v1/token_security/${BASE_CHAIN_ID}?contract_addresses=${address}`) as
    { code?: number; result?: Record<string, Record<string, unknown>> } | undefined;
  const r = body?.result?.[address.toLowerCase()];
  // An address GoPlus has never indexed comes back as an empty result, which
  // is "no reading", not "no flags".
  if (!r || Object.keys(r).length === 0) return undefined;
  return {
    isHoneypot: flag(r.is_honeypot),
    buyTaxPct: pctOf(r.buy_tax),
    sellTaxPct: pctOf(r.sell_tax),
    isMintable: flag(r.is_mintable),
    transferPausable: flag(r.transfer_pausable),
    isBlacklisted: flag(r.is_blacklisted),
    ownerChangeBalance: flag(r.owner_change_balance),
    canTakeBackOwnership: flag(r.can_take_back_ownership),
    hiddenOwner: flag(r.hidden_owner),
    isOpenSource: flag(r.is_open_source),
    tradingCooldown: flag(r.trading_cooldown),
    isAntiWhale: flag(r.is_anti_whale),
    cannotSellAll: flag(r.cannot_sell_all),
  };
}

async function askHoneypotIs(address: string): Promise<HoneypotIsReading | undefined> {
  const body = await getJson(`${HONEYPOT_IS}/v2/IsHoneypot?address=${address}&chainID=${BASE_CHAIN_ID}`) as {
    summary?: { risk?: string; riskLevel?: number; flags?: { flag?: string }[] };
    honeypotResult?: { isHoneypot?: boolean };
    simulationResult?: { buyTax?: number; sellTax?: number; transferTax?: number };
    simulationSuccess?: boolean;
    flags?: { flag?: string }[];
  } | undefined;
  if (!body || !body.summary || !body.honeypotResult) return undefined;
  const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined);
  const flags = [...(body.summary.flags ?? []), ...(body.flags ?? [])]
    .map((f) => f?.flag).filter((f): f is string => Boolean(f));
  return {
    isHoneypot: Boolean(body.honeypotResult.isHoneypot),
    risk: String(body.summary.risk ?? "unknown"),
    riskLevel: Number(body.summary.riskLevel ?? 0),
    buyTaxPct: pct(body.simulationResult?.buyTax),
    sellTaxPct: pct(body.simulationResult?.sellTax),
    transferTaxPct: pct(body.simulationResult?.transferTax),
    flags: [...new Set(flags)],
    simulationSuccess: Boolean(body.simulationSuccess),
  };
}

const out = fileURLToPath(new URL("../../shared/src/scanners.ts", import.meta.url));

function existing(): Record<string, ScannerReadings> {
  try {
    const src = readFileSync(out, "utf8");
    const start = src.indexOf("= {", src.indexOf("SCANNER_READINGS"));
    if (start === -1) return {};
    const open = src.indexOf("{", start);
    const close = src.indexOf("\n};", open);
    if (open === -1 || close === -1) return {};
    return JSON.parse(src.slice(open, close + 2)) as Record<string, ScannerReadings>;
  } catch {
    return {};
  }
}

const found: Record<string, ScannerReadings> = { ...existing() };
const addresses = Object.keys(FIXTURES);
const rescan = process.env.SIDIK_RESCAN === "1";
// A scanner is asked again wherever its reading is missing, not only for
// addresses with no record at all. The first pass asked GoPlus at the same
// pace as honeypot.is and got 39 answers out of 194: it rate-limits well
// below that, and an exhausted retry was recorded as "no reading", which the
// comparison then read as the scanner having nothing to say.
const needGoplus = (a: string) => rescan || !found[a.toLowerCase()]?.goplus;
const needHoneypotIs = (a: string) => rescan || !found[a.toLowerCase()]?.honeypotIs;
const todo = addresses.filter((a) => needGoplus(a) || needHoneypotIs(a));
process.stderr.write(`${todo.length} of ${addresses.length} address(es) to ask
`);
// GoPlus tolerates roughly one request every couple of seconds without a key.
const GOPLUS_GAP_MS = 2_500;

const askedOn = new Date().toISOString().slice(0, 10);
let n = 0;
for (const address of todo) {
  const key = address.toLowerCase();
  const checksummed = FIXTURES[address]!.scan.token;
  const prior = found[key];
  const askG = needGoplus(address);
  const goplus = askG ? await askGoPlus(checksummed) : prior?.goplus;
  if (askG) await sleep(GOPLUS_GAP_MS);
  const honeypotIs = needHoneypotIs(address) ? await askHoneypotIs(checksummed) : prior?.honeypotIs;
  // Nothing recorded for an address neither scanner answered: absence has to
  // stay distinguishable from "both said it was fine".
  if (goplus || honeypotIs) {
    found[key] = { askedOn: prior?.askedOn ?? askedOn, ...(goplus ? { goplus } : {}), ...(honeypotIs ? { honeypotIs } : {}) };
  }
  if (++n % 25 === 0) process.stderr.write(`  ${n}/${todo.length}
`);
  await sleep(GAP_MS);
}

// ---- the comparison, counted here so no page has to import the runs ------
type Cmp = { total: number; agree: number; sidikOnly: string[]; scannerOnly: string[] };
const fresh = (): Cmp => ({ total: 0, agree: 0, sidikOnly: [], scannerOnly: [] });
const cmp = {
  honeypotGoplus: fresh(), honeypotHoneypotIs: fresh(), ownerTrapGoplus: fresh(),
  // Taxes: both scanners report a buy tax; Sidik measured one against the
  // pool's own quote. "Agree" means within a percentage point of each other,
  // or both under the reporting floor. This is the comparison where a scanner
  // is on its strongest ground — a simulated buy is close to an executed one
  // — so it is the fairest test of whether execution adds anything.
  buyTaxGoplus: fresh(), buyTaxHoneypotIs: fresh(),
};
const TAX_TOLERANCE_PP = 1;
const TAX_FLOOR_PCT = 0.5; // hiddenFee's own floor: below this it reports no tax
function taxAgrees(sidikPct: number, scannerPct: number): boolean {
  if (sidikPct < TAX_FLOOR_PCT && scannerPct < TAX_FLOOR_PCT) return true;
  return Math.abs(sidikPct - scannerPct) <= TAX_TOLERANCE_PP;
}
/** hiddenFee records its measured buy tax as "2.99%"; "n/a" when unmeasured. */
function measuredBuyTax(run: (typeof FIXTURES)[string]): number | undefined {
  const v = run.verdicts.find((x) => x.probe === "hiddenFee");
  const raw = v?.numbers.buyTaxPct;
  if (!raw || raw === "n/a") return undefined;
  const n = Number(String(raw).replace("%", ""));
  return Number.isFinite(n) ? n : undefined;
}

for (const address of addresses) {
  const run = FIXTURES[address]!;
  const r = found[address.toLowerCase()];
  const sym = run.scan.symbol || address.slice(0, 10);
  const hp = run.verdicts.find((v) => v.probe === "honeypot");
  const trap = run.verdicts.find((v) => v.probe === "ownerTrap");

  // Honeypot: Sidik FAIL means it executed a buy and could not sell (or was
  // paid a sliver). Compared against each scanner's own honeypot verdict, on
  // the addresses where both sides have an answer.
  if (hp && hp.status !== "NA") {
    const sidik = hp.status === "FAIL";
    if (r?.goplus?.isHoneypot !== undefined) {
      const c = cmp.honeypotGoplus; c.total++;
      if (sidik === r.goplus.isHoneypot) c.agree++; else (sidik ? c.sidikOnly : c.scannerOnly).push(sym);
    }
    if (r?.honeypotIs) {
      const c = cmp.honeypotHoneypotIs; c.total++;
      if (sidik === r.honeypotIs.isHoneypot) c.agree++; else (sidik ? c.sidikOnly : c.scannerOnly).push(sym);
    }
  }

  // Buy tax, measured against quoted. Listed as "execution-only" when Sidik
  // measured a tax the scanner did not report, "scanner-only" the reverse.
  const sidikTax = measuredBuyTax(run);
  if (sidikTax !== undefined) {
    for (const [name, scannerTax] of [["buyTaxGoplus", r?.goplus?.buyTaxPct], ["buyTaxHoneypotIs", r?.honeypotIs?.buyTaxPct]] as const) {
      if (scannerTax === undefined) continue;
      const c = cmp[name]; c.total++;
      if (taxAgrees(sidikTax, scannerTax)) c.agree++;
      else (sidikTax > scannerTax ? c.sidikOnly : c.scannerOnly).push(`${sym} ${sidikTax}% vs ${scannerTax}%`);
    }
  }

  // Owner traps: GoPlus has flags for the three mechanisms the probe pulls —
  // pausable transfers, a blacklist, minting. The comparison is against the
  // executed outcome, not against whether the code exists: GoPlus flags code,
  // Sidik reports whether pulling it actually stopped the sell.
  if (trap && trap.applicable !== false && trap.status !== "NA" && r?.goplus) {
    const g = r.goplus;
    const flagged = g.transferPausable === true || g.isBlacklisted === true || g.isMintable === true;
    const sidik = trap.status === "FAIL";
    const c = cmp.ownerTrapGoplus; c.total++;
    if (sidik === flagged) c.agree++; else (sidik ? c.sidikOnly : c.scannerOnly).push(sym);
  }
}

const withAny = addresses.filter((a) => found[a.toLowerCase()]);
process.stderr.write(`\n${withAny.length} of ${addresses.length} addresses have at least one scanner reading\n`);
for (const [k, c] of Object.entries(cmp)) {
  process.stderr.write(`${k}: ${c.agree}/${c.total} agree; Sidik-only ${c.sidikOnly.length} [${c.sidikOnly.join(", ")}]; scanner-only ${c.scannerOnly.length} [${c.scannerOnly.join(", ")}]\n`);
}

const nl = String.fromCharCode(10);
writeFileSync(out, [
  "// GENERATED by engine/scripts/gen-scanners.mts — do not edit by hand.",
  "// What two read-only scanners said about each recorded address. Context for",
  "// the executed verdicts, never part of one: no flag here changes a status.",
  "//",
  "// These describe the chain on the day they were asked (`askedOn`), not the",
  "// fork block the verdicts describe — neither service can be pinned to a",
  "// block. An address missing from this map was answered by neither scanner.",
  'import type { Hex } from "./types";',
  "",
  "// Every flag is optional: an absent key means the scanner gave no answer.",
  "export interface GoPlusReading {",
  "  isHoneypot?: boolean; buyTaxPct?: number; sellTaxPct?: number;",
  "  isMintable?: boolean; transferPausable?: boolean; isBlacklisted?: boolean;",
  "  ownerChangeBalance?: boolean; canTakeBackOwnership?: boolean; hiddenOwner?: boolean;",
  "  isOpenSource?: boolean; tradingCooldown?: boolean; isAntiWhale?: boolean; cannotSellAll?: boolean;",
  "}",
  "",
  "export interface HoneypotIsReading {",
  "  isHoneypot: boolean; risk: string; riskLevel: number;",
  "  buyTaxPct?: number; sellTaxPct?: number; transferTaxPct?: number;",
  "  flags: string[]; simulationSuccess: boolean;",
  "}",
  "",
  "export interface ScannerReadings { askedOn: string; goplus?: GoPlusReading; honeypotIs?: HoneypotIsReading }",
  "",
  `export const SCANNER_READINGS: Record<string, ScannerReadings> = ${JSON.stringify(
    Object.fromEntries(Object.entries(found).map(([a, v]) => [a.toLowerCase(), v])), null, 2)};`,
  "",
  "/**",
  " * How the scanners' answers line up with the executed verdicts, counted at",
  " * generation time. `sidikOnly` are addresses where execution found what the",
  " * scanner did not; `scannerOnly` the reverse. Both directions are listed",
  " * because a comparison that only shows the flattering half is not one.",
  " */",
  `export const SCANNER_STATS = ${JSON.stringify(cmp, null, 2)} as const;`,
  "",
  "export function scannersOf(address: Hex | string): ScannerReadings | undefined {",
  "  const key = String(address).toLowerCase();",
  "  return Object.hasOwn(SCANNER_READINGS, key) ? SCANNER_READINGS[key] : undefined;",
  "}",
  "",
].join(nl));
process.stderr.write(`wrote ${Object.keys(found).length} record(s) -> ${out}${nl}`);
