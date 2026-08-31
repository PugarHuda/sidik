import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { log } from "./log";

/**
 * Where anvil is, fetching it first if the machine does not have one.
 *
 * On a laptop this does nothing: `anvil` is on PATH and the engine spawns it
 * by name. It exists for a serverless host, which has no Foundry and no
 * package manager, and where the alternative was no live engine at all —
 * every free container host wants a card (Fly), a paid tier (Hugging Face
 * Spaces), or a signup that did not complete (Koyeb).
 *
 * Measured on Vercel 2026-08-31: the release tarball is 79,867,740 bytes and
 * downloads in under a second. The archive is unpacked here rather than
 * shelled out to `tar`, because the runtime has no tar — the first attempt
 * failed with "tar: command not found".
 */
const RELEASE = process.env.FOUNDRY_RELEASE_URL
  ?? "https://github.com/foundry-rs/foundry/releases/download/stable/foundry_stable_linux_amd64.tar.gz";

/** Writable on every serverless runtime, and the only place a binary can be made executable. */
const CACHE_DIR = process.env.ANVIL_CACHE_DIR ?? "/tmp/foundry";

/** A truncated download would be cached and spawned forever; anvil is tens of megabytes. */
const MIN_PLAUSIBLE_BYTES = 5_000_000;

/**
 * One file out of a tar archive.
 *
 * ustar is 512-byte headers: the name at offset 0, the size as octal ASCII at
 * 124, the body immediately after, padded to the next 512-byte boundary. Only
 * enough of it to find one known file — a general tar reader would be a
 * dependency for something this shape does not need.
 */
export function fileFromTar(tar: Buffer, want: string): Buffer | undefined {
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const name = tar.toString("utf8", offset, offset + 100).replace(/\0.*$/s, "");
    if (!name) { offset += 512; continue; } // padding, or the two empty blocks that end an archive
    const octal = tar.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/s, "").trim();
    const size = parseInt(octal || "0", 8);
    if (!Number.isFinite(size) || size < 0) return undefined;
    const body = offset + 512;
    if (name === want || name.endsWith(`/${want}`)) return tar.subarray(body, body + size);
    offset = body + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

let provisioning: Promise<string> | undefined;

/**
 * The command to spawn for anvil.
 *
 * `ANVIL_BIN` wins when it is set. Otherwise the plain name, so a developer's
 * PATH is used exactly as before — unless `SIDIK_FETCH_ANVIL=1` asks for the
 * download, which is how the serverless deployment turns it on without
 * changing what happens anywhere else.
 */
export async function anvilCommand(): Promise<string> {
  if (process.env.ANVIL_BIN) return process.env.ANVIL_BIN;
  if (process.env.SIDIK_FETCH_ANVIL !== "1") return "anvil";
  // One download per instance even when several runs start at once: the
  // second caller waits on the first one's promise rather than racing it to
  // the same path with a half-written file in between.
  provisioning ??= fetchAnvil();
  return provisioning;
}

async function fetchAnvil(): Promise<string> {
  const target = `${CACHE_DIR}/anvil`;
  if (existsSync(target) && statSync(target).size > MIN_PLAUSIBLE_BYTES) return target;

  const started = performance.now();
  mkdirSync(CACHE_DIR, { recursive: true });
  const res = await fetch(RELEASE, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`could not fetch Foundry: HTTP ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const bin = fileFromTar(gunzipSync(gz), "anvil");
  if (!bin) throw new Error("the Foundry release contained no anvil");
  if (bin.length < MIN_PLAUSIBLE_BYTES) throw new Error(`anvil is only ${bin.length} bytes; refusing to cache it`);

  writeFileSync(target, bin);
  chmodSync(target, 0o755);
  log.info({ event: "anvil.fetched", count: bin.length, ms: Math.round(performance.now() - started) });
  return target;
}
