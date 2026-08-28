import { createHash } from "node:crypto";
import { FIXTURES, FIXTURE_BLOCK, FIXTURE_META } from "@sidik/shared";

/**
 * What a consumer needs to check that the JSON they hold is the JSON this
 * repository produced.
 *
 * The runs are pinned to a block, but a block number alone cannot tell a
 * reader which commit recorded them, which anvil did the executing, or whether
 * the catalogue on the site is the one in git. `vercel deploy` ships the
 * working tree, which is exactly the case where site ≠ commit — so the site's
 * own commit is reported beside the catalogue's, and the digest lets anyone
 * with a checkout confirm the two catalogues are byte-identical.
 *
 * Server-only (node:crypto); never import from a client component.
 */
const catalogueSha256 = createHash("sha256")
  .update(JSON.stringify(FIXTURES))
  .digest("hex");

export const PROVENANCE = {
  chainId: 8453,
  forkBlock: Number(FIXTURE_BLOCK),
  // The generator writes these when it records; see gen-fixtures.mts.
  recordedThrough: FIXTURE_META.recordedThrough,
  recordedByCommit: FIXTURE_META.engineCommit,
  anvil: FIXTURE_META.anvil,
  probes: FIXTURE_META.probes,
  // sha256 of JSON.stringify(FIXTURES) as exported by @sidik/shared. Recompute
  // it from a checkout of `recordedByCommit` to confirm nothing was edited.
  catalogueSha256,
  // Vercel sets this at build; locally it is unknown, and null says so.
  siteCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
} as const;
