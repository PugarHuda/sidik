// Records whether each catalogue token's source code is published and
// verified on Blockscout, into shared/src/verification.ts.
//
//   pnpm --filter @sidik/engine verification
//
// Why this exists: "check that the contract is verified" is the standard
// advice, and the catalogue is a way to find out what following it would
// actually have bought you. The answer measured here is: almost nothing.
// Every honeypot, every taxed token and every ruggable pool Sidik caught has
// its source code published, readable and verified.
//
// This is corroboration about the state of the advice, never part of a
// verdict. Sidik's findings come from executed transactions on a fork and
// nowhere else, and a token's verification status changes none of them.
//
// Blockscout, not Basescan: it is open, keyless and the same data. Its v2
// endpoint answers 200 for a verified contract and 404 for anything else,
// which is the whole question — the older `getsourcecode` action carries the
// full source in every response and rate-limits within a few dozen calls.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "@sidik/shared";

const API = process.env.BLOCKSCOUT_BASE_URL ?? "https://base.blockscout.com";
// Sourcify is the second, independent witness: a different verifier with a
// stricter notion of "verified" (an exact match includes the metadata hash;
// a partial match is the same code with different metadata). Its deployment
// record is also where the deployer comes from — Blockscout's address
// endpoint answered HTTP 500 for every address on 2026-08-29.
const SOURCIFY = process.env.SOURCIFY_BASE_URL ?? "https://sourcify.dev/server";
// Sequential with a gap, because it is a free public endpoint and this is a
// once-per-catalogue job. Eight at a time got every one of 194 addresses
// rate-limited into a false "unverified".
const GAP_MS = 350;
const ATTEMPTS = 5;
const TIMEOUT_MS = 20_000;

export interface Verification {
  verified: boolean;
  /** Contract name as published, when there is one. */
  name?: string;
  /** solc version the publisher compiled with. */
  compiler?: string;
  /** Sourcify's answer; null means Sourcify holds nothing for this address. */
  sourcify?: { match: "exact" | "partial"; verifiedAt?: string } | null;
  /** The address that deployed the contract, when a verifier records it. */
  deployer?: string;
  deployerSource?: "sourcify" | "blockscout";
}

type Sourcify = NonNullable<Verification["sourcify"]>;

/** Sourcify v2: 200 with match fields for a verified contract, 404 otherwise. */
async function sourcifyOf(address: string): Promise<{ sourcify: Sourcify | null; deployer?: string } | undefined> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${SOURCIFY}/v2/contract/8453/${address}?fields=deployment`, {
        headers: { accept: "application/json", "user-agent": "sidik" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429) { await sleep(2_500 * (attempt + 1)); continue; }
      if (res.status === 404) return { sourcify: null };
      if (!res.ok) { await sleep(1_500 * (attempt + 1)); continue; }
      const body = await res.json() as {
        creationMatch?: string | null; runtimeMatch?: string | null; verifiedAt?: string;
        deployment?: { deployer?: string };
      };
      const best = body.runtimeMatch === "exact_match" || body.creationMatch === "exact_match" ? "exact"
        : body.runtimeMatch === "match" || body.creationMatch === "match" ? "partial" : undefined;
      if (!best) return { sourcify: null };
      const deployer = body.deployment?.deployer;
      return { sourcify: { match: best, verifiedAt: body.verifiedAt }, ...(deployer ? { deployer } : {}) };
    } catch {
      await sleep(1_500 * (attempt + 1));
    }
  }
  return undefined;
}

/** Blockscout's address record, for the deployer when Sourcify has no deployment. One retry on a 5xx. */
async function blockscoutDeployerOf(address: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API}/api/v2/addresses/${address}`, {
        headers: { accept: "application/json", "user-agent": "sidik" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 500) { await sleep(1_500); continue; }
      if (!res.ok) return undefined;
      const body = await res.json() as { creator_address_hash?: string | null };
      return body.creator_address_hash ?? undefined;
    } catch {
      await sleep(1_500);
    }
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function verificationOf(address: string): Promise<Verification | undefined> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${API}/api/v2/smart-contracts/${address}`, {
        headers: { accept: "application/json", "user-agent": "sidik" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429) { await sleep(2_500 * (attempt + 1)); continue; }
      // 404 is the answer, not a failure: Blockscout has no verified contract
      // at that address. An EOA answers the same way, which is correct — the
      // wallet example has no source to publish.
      if (res.status === 404) return { verified: false };
      if (!res.ok) return undefined;
      const body = await res.json() as { name?: string; compiler_version?: string };
      return { verified: true, name: body.name ?? undefined, compiler: body.compiler_version ?? undefined };
    } catch {
      await sleep(1_500 * (attempt + 1));
    }
  }
  // Unreachable is NOT unverified. Returning false here would publish a claim
  // about a contract that was never actually checked.
  return undefined;
}

const out = fileURLToPath(new URL("../../shared/src/verification.ts", import.meta.url));

// Merge with what is already recorded, so an interrupted run resumes instead
// of replacing the file with a partial one.
function existing(): Record<string, Verification> {
  try {
    const src = readFileSync(out, "utf8");
    const start = src.indexOf("= {", src.indexOf("VERIFIED_SOURCE"));
    if (start === -1) return {};
    const open = src.indexOf("{", start);
    const close = src.indexOf("\n};", open);
    if (open === -1 || close === -1) return {};
    return JSON.parse(src.slice(open, close + 2)) as Record<string, Verification>;
  } catch {
    return {};
  }
}

const found: Record<string, Verification> = { ...existing() };
const addresses = Object.keys(FIXTURES);
// Already-recorded addresses are skipped: whether a contract's source is
// published does not change under us, and re-asking 194 times only spends
// someone else's free endpoint. SIDIK_REVERIFY=1 forces a full refresh.
const reverify = process.env.SIDIK_REVERIFY === "1";
const todo = reverify ? addresses : addresses.filter((a) => !Object.hasOwn(found, a.toLowerCase()));
// Sourcify is asked for every address that has not been asked yet, whether or
// not Blockscout was: the two are independent witnesses.
const todoSourcify = reverify ? addresses : addresses.filter((a) => found[a.toLowerCase()]?.sourcify === undefined);
process.stderr.write(`${todo.length} of ${addresses.length} address(es) need checking on Blockscout, ${todoSourcify.length} on Sourcify\n`);
let checked = 0;
let unreachable = 0;
for (const address of todo) {
  const v = await verificationOf(address);
  if (v) found[address.toLowerCase()] = { ...found[address.toLowerCase()], ...v }; else unreachable++;
  if (++checked % 25 === 0) {
    process.stderr.write(`  ${checked}/${todo.length} checked, ${unreachable} unreachable\n`);
  }
  await sleep(GAP_MS);
}
let sChecked = 0;
let sUnreachable = 0;
for (const address of todoSourcify) {
  const key = address.toLowerCase();
  const rec = found[key];
  if (!rec) continue; // never checked on Blockscout either; nothing to attach to
  const s = await sourcifyOf(address);
  if (!s) { sUnreachable++; }
  else {
    rec.sourcify = s.sourcify;
    if (s.deployer) { rec.deployer = s.deployer; rec.deployerSource = "sourcify"; }
    else if (!rec.deployer) {
      const d = await blockscoutDeployerOf(address);
      if (d) { rec.deployer = d; rec.deployerSource = "blockscout"; }
    }
  }
  if (++sChecked % 25 === 0) {
    process.stderr.write(`  sourcify ${sChecked}/${todoSourcify.length} checked, ${sUnreachable} unreachable\n`);
  }
  await sleep(250);
}

const known = addresses.filter((a) => Object.hasOwn(found, a.toLowerCase()));
const verified = known.filter((a) => found[a.toLowerCase()]!.verified);
// The stat that makes the point, counted here rather than in the browser: the
// pages that show it are client components, and deriving it from FIXTURES
// there would ship all 194 recorded runs to every visitor.
const failing = known.filter((a) => FIXTURES[a]!.verdicts.some((v) => v.status === "FAIL"));
const failingVerified = failing.filter((a) => found[a.toLowerCase()]!.verified);
process.stderr.write(`\n${verified.length} of ${known.length} checked addresses publish verified source\n`);
process.stderr.write(`${failingVerified.length} of ${failing.length} FAILING addresses publish verified source\n`);
const sourcifyStats = {
  exact: known.filter((a) => found[a.toLowerCase()]!.sourcify?.match === "exact").length,
  partial: known.filter((a) => found[a.toLowerCase()]!.sourcify?.match === "partial").length,
  none: known.filter((a) => found[a.toLowerCase()]!.sourcify === null).length,
  deployerKnown: known.filter((a) => found[a.toLowerCase()]!.deployer).length,
};
process.stderr.write(`Sourcify: ${sourcifyStats.exact} exact, ${sourcifyStats.partial} partial, ${sourcifyStats.none} none; deployer known for ${sourcifyStats.deployerKnown}\n`);

const nl = String.fromCharCode(10);
writeFileSync(out, [
  "// GENERATED by engine/scripts/gen-verification.mts — do not edit by hand.",
  "// Whether each recorded address publishes verified source code, read from",
  "// Blockscout. Corroboration about the value of the usual advice, never part",
  "// of a verdict: every finding still comes from an executed transaction.",
  "//",
  "// An address missing from this map was never successfully checked. That is",
  "// deliberately different from being recorded as unverified.",
  'import type { Hex } from "./types";',
  "",
  "export interface Verification {",
  "  verified: boolean;",
  "  name?: string;",
  "  compiler?: string;",
  "  /** Sourcify's answer: exact (metadata hash included) or partial; null when it holds nothing. */",
  '  sourcify?: { match: "exact" | "partial"; verifiedAt?: string } | null;',
  "  /** The deploying address, as recorded by the verifier named in deployerSource. */",
  "  deployer?: string;",
  '  deployerSource?: "sourcify" | "blockscout";',
  "}",
  "",
  `export const VERIFIED_SOURCE: Record<string, Verification> = ${JSON.stringify(
    Object.fromEntries(Object.entries(found).map(([a, v]) => [a.toLowerCase(), v])), null, 2)};`,
  "",
  "/**",
  " * The counts, frozen at generation time.",
  " *",
  " * Constants rather than a function over FIXTURES because the pages that",
  " * show this are client components: deriving it in the browser would ship",
  " * every recorded run to every visitor.",
  " */",
  "export const VERIFICATION_STATS = {",
  `  checked: ${known.length},`,
  `  verified: ${verified.length},`,
  `  failing: ${failing.length},`,
  `  failingVerified: ${failingVerified.length},`,
  "} as const;",
  "",
  "/** Sourcify's independent count over the same addresses, and how many deployers are on record. */",
  `export const SOURCIFY_STATS = ${JSON.stringify(sourcifyStats)} as const;`,
  "",
  "/**",
  " * What is known about one address, or undefined if it was never checked.",
  " *",
  " * Object.hasOwn rather than a bare index: a plain object literal inherits",
  ' * from Object.prototype, so VERIFIED_SOURCE["constructor"] is a function,',
  " * not undefined, and a caller checking for undefined would sail past it.",
  " */",
  "export function verificationOf(address: Hex | string): Verification | undefined {",
  "  const key = String(address).toLowerCase();",
  "  return Object.hasOwn(VERIFIED_SOURCE, key) ? VERIFIED_SOURCE[key] : undefined;",
  "}",
  "",
].join(nl));
process.stderr.write(`wrote ${Object.keys(found).length} record(s) -> ${out}${nl}`);
