import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { fileFromTar } from "../src/anvilBin";

/** One ustar entry: 512-byte header (name at 0, octal size at 124), body padded to 512. */
function tarEntry(name: string, body: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, "utf8");
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  return Buffer.concat([header, padded]);
}

const anvil = Buffer.from("ELF anvil goes here");
const forge = Buffer.from("forge, which is not what we want, and is longer than anvil".repeat(20));

describe("fileFromTar", () => {
  it("finds the wanted file among others and returns exactly its bytes", () => {
    const tar = Buffer.concat([tarEntry("forge", forge), tarEntry("anvil", anvil), tarEntry("cast", forge)]);
    expect(fileFromTar(tar, "anvil")).toEqual(anvil);
  });

  // The size field is what advances the reader. Read it wrong and every
  // following header lands mid-body, so the file after the first one is never
  // found — which would look exactly like "this release has no anvil".
  it("walks past a preceding file whose body is not a whole number of blocks", () => {
    const odd = Buffer.alloc(513, 7); // one byte into a second block
    const tar = Buffer.concat([tarEntry("cast", odd), tarEntry("anvil", anvil)]);
    expect(fileFromTar(tar, "anvil")).toEqual(anvil);
  });

  it("matches a path ending in the name, as a release archive nests it", () => {
    const tar = tarEntry("foundry_stable/anvil", anvil);
    expect(fileFromTar(tar, "anvil")).toEqual(anvil);
  });

  it("does not mistake a similarly named file for it", () => {
    const tar = Buffer.concat([tarEntry("anvil.txt", forge), tarEntry("myanvil", forge)]);
    expect(fileFromTar(tar, "anvil")).toBeUndefined();
  });

  it("returns undefined rather than throwing on padding, empty input and truncation", () => {
    expect(fileFromTar(Buffer.alloc(1024), "anvil")).toBeUndefined();
    expect(fileFromTar(Buffer.alloc(0), "anvil")).toBeUndefined();
    expect(fileFromTar(tarEntry("anvil", anvil).subarray(0, 300), "anvil")).toBeUndefined();
  });

  // The archive really is gzipped, so the round trip is the shape the caller
  // uses; a reader that only works on hand-built buffers proves nothing.
  it("reads what a real gzip round trip produces", async () => {
    const { gunzipSync } = await import("node:zlib");
    const tar = Buffer.concat([tarEntry("forge", forge), tarEntry("anvil", anvil)]);
    expect(fileFromTar(gunzipSync(gzipSync(tar)), "anvil")).toEqual(anvil);
  });
});
