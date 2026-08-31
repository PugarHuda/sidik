import { spawnSync } from "node:child_process";
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
/**
 * Which Foundry release to fetch, newest first.
 *
 * NOT `stable`, and this cost a deployment to learn: the stable build is
 * linked against glibc 2.35 and the serverless runtime does not have it —
 * "/lib64/libm.so.6: version `GLIBC_2.35' not found". The requirement is
 * readable straight out of the binary (the highest `GLIBC_2.x` string it
 * references), and measured across the release history on 2026-08-31:
 *
 *   stable, v1.4.0 and later  2.35   too new for the runtime
 *   v1.3.6 … v1.2.0           2.34
 *   v1.0.0, v0.3.0            2.29
 *
 * Both listed candidates are post-Cancun, so a fork of Base executes the same
 * opcodes either way. They are tried in order and the first one that actually
 * runs is kept, because the exact glibc on the host is not something to guess
 * at from one error message.
 */
const RELEASES = process.env.FOUNDRY_RELEASE_URL
  ? [process.env.FOUNDRY_RELEASE_URL]
  : [
    "https://github.com/foundry-rs/foundry/releases/download/v1.3.6/foundry_v1.3.6_linux_amd64.tar.gz",
    "https://github.com/foundry-rs/foundry/releases/download/v1.0.0/foundry_v1.0.0_linux_amd64.tar.gz",
  ];

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
  if (existsSync(target) && statSync(target).size > MIN_PLAUSIBLE_BYTES && runs(target)) return target;

  mkdirSync(CACHE_DIR, { recursive: true });
  const refused: string[] = [];
  for (const url of RELEASES) {
    const started = performance.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bin = fileFromTar(gunzipSync(Buffer.from(await res.arrayBuffer())), "anvil");
      if (!bin) throw new Error("the release contained no anvil");
      if (bin.length < MIN_PLAUSIBLE_BYTES) throw new Error(`anvil is only ${bin.length} bytes`);

      writeFileSync(target, bin);
      chmodSync(target, 0o755);
      // Downloading it is not the same as being able to run it. A build linked
      // against a newer glibc than the host installs perfectly and then fails
      // at spawn time, where the error surfaces as a probe that could not run.
      if (!runs(target)) throw new Error("it installed but would not execute here");
      log.info({ event: "anvil.fetched", count: bin.length, ms: Math.round(performance.now() - started) });
      return target;
    } catch (e) {
      refused.push(`${url.split("/download/")[1]?.split("/")[0] ?? url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`no Foundry release would run here — ${refused.join("; ")}`);
}

/** Does this binary actually execute on this host? */
function runs(bin: string): boolean {
  const r = spawnSync(bin, ["--version"], { timeout: 30_000, encoding: "utf8" });
  return r.status === 0;
}
