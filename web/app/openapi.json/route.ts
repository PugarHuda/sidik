import { CATALOGUE_FILTERS, FIXTURE_BLOCK } from "@sidik/shared";

export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidik-eight.vercel.app";

/**
 * The two JSON endpoints, described in a form a client can be generated from.
 *
 * Hand-written against shared/src/types.ts rather than generated: the shapes
 * are small, and a generator would be one more dependency for a document that
 * changes when a probe does. A test in machine-readable.spec.ts asserts that
 * every key a real response carries is declared here, so it cannot drift
 * silently.
 */
const Verdict = {
  type: "object",
  required: ["probe", "status", "title", "rows", "numbers", "txHashes"],
  properties: {
    probe: { type: "string", description: "Probe id: honeypot, hiddenFee, lpRug, ownerTrap, approvalDrain, crossVenue." },
    status: { type: "string", enum: ["PASS", "FAIL", "NA"], description: "NA means the probe could not answer." },
    title: { type: "string", description: "One-line verdict." },
    reason: { type: "string", description: "Why, when there is more to say — typically a revert reason." },
    applicable: {
      type: "boolean",
      description: "False when the mechanism does not exist for this token (LP rug on a V3 pool, owner switch in a contract with none). Not a failure to check.",
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "claimed", "proven", "ok"],
        properties: {
          label: { type: "string" },
          claimed: { type: "string", description: "What a buyer assumes of any listed ERC-20." },
          proven: { type: "string", description: "What the fork transaction showed." },
          ok: { type: "boolean" },
        },
      },
    },
    numbers: { type: "object", additionalProperties: { type: "string" }, description: "Every measured figure, pre-formatted." },
    txHashes: {
      type: "array",
      items: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
      description: "Mined on an ephemeral fork and never broadcast. They do not exist on Base mainnet.",
    },
  },
} as const;

const Provenance = {
  type: "object",
  properties: {
    chainId: { type: "integer", const: 8453 },
    forkBlock: { type: "integer" },
    recordedThrough: { type: "string", description: "ISO date of the last recording written into the catalogue." },
    recordedByCommit: { type: ["string", "null"], description: "Git commit of the engine that recorded the last run." },
    anvil: { type: ["string", "null"], description: "anvil --version at the last recording, when known." },
    probes: { type: "array", items: { type: "string" } },
    catalogueSha256: { type: "string", description: "sha256 of JSON.stringify(FIXTURES) from @sidik/shared; recompute from a checkout to verify." },
    siteCommit: { type: ["string", "null"], description: "The commit this site was built from, when the host reports it." },
  },
} as const;

const ScannerReading = {
  type: "object",
  properties: {
    askedOn: { type: "string", description: "ISO date the scanners were asked. They describe the chain that day, not the fork block." },
    goplus: { type: "object", additionalProperties: true },
    honeypotIs: { type: "object", additionalProperties: true },
  },
} as const;

const Recheck = {
  type: "object",
  required: ["headBlock", "checkedOn", "status", "title"],
  properties: {
    headBlock: { type: "string" },
    checkedOn: { type: "string" },
    status: { type: "string", enum: ["PASS", "FAIL", "NA"] },
    title: { type: "string" },
  },
  description: "The honeypot probe re-executed at that day's head block. Context, never evidence.",
} as const;

const Corroboration = {
  type: "object",
  description: "Third-party context. Never part of a verdict and never changes one.",
  properties: {
    alsoTradesOn: { type: "array", items: { type: "object", properties: { venue: { type: "string" }, ticker: { type: "string" } } } },
    sourceVerified: { type: ["boolean", "null"], description: "Blockscout's answer. Across the catalogue, verified source is not a safety signal." },
    sourcify: {
      anyOf: [
        { type: "object", required: ["match"], properties: { match: { type: "string", enum: ["exact", "partial"] }, verifiedAt: { type: "string" } } },
        { type: "null" },
      ],
      description: "Sourcify's independent answer: exact (metadata hash included), partial, or null when it holds nothing.",
    },
    deployer: { type: ["string", "null"], description: "The deploying address as recorded by the verifier in deployerSource. A fact, not a signal." },
    deployerSource: { type: ["string", "null"], enum: ["sourcify", "blockscout", null] },
    scanners: { anyOf: [ScannerReading, { type: "null" }] },
    recheck: { anyOf: [Recheck, { type: "null" }] },
  },
} as const;

const TokenRun = {
  type: "object",
  required: ["schemaVersion", "chainId", "address", "forkBlock", "symbol", "decimals", "headline", "verdicts", "narration", "corroboration", "transactionsWereBroadcast", "provenance"],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    chainId: { type: "integer", const: 8453 },
    address: { type: "string", pattern: "^0x[0-9a-f]{40}$", description: "Lower-cased; the canonical form for this address in every URL here." },
    forkBlock: { type: "integer" },
    symbol: { type: "string" },
    decimals: { type: "integer" },
    venue: { type: ["string", "null"], enum: ["v2", "v3", null] },
    poolAddress: { type: ["string", "null"] },
    headline: { type: "string", enum: ["PASS", "FAIL", "NA"], description: "FAIL if any applicable probe failed; NA if any applicable probe could not answer; else PASS." },
    verdicts: { type: "array", items: Verdict },
    narration: { type: "string" },
    corroboration: Corroboration,
    transactionsWereBroadcast: { type: "boolean", const: false },
    recorded: { type: "boolean", description: "True when served from the committed catalogue; false when answered from a live engine's cache." },
    provenance: Provenance,
  },
} as const;

const ErrorBody = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
    schemaVersion: { type: "integer" },
    chainId: { type: "integer" },
    recordedAddresses: { type: "integer" },
    forkBlock: { type: "integer" },
  },
} as const;

export function GET() {
  const doc = {
    openapi: "3.1.0",
    info: {
      title: "Sidik",
      version: "1",
      description:
        "Proves what a Base token does to a buyer by executing it on a fork of Base at block " +
        `${FIXTURE_BLOCK}. Every verdict is the result of a transaction that was mined on that fork; ` +
        "nothing was broadcast. A 404 for an address means it was never probed — not that nothing was found.",
    },
    servers: [{ url: SITE }],
    paths: {
      "/api/token/{address}": {
        get: {
          operationId: "getTokenRun",
          summary: "The recorded run for one Base address.",
          parameters: [{ name: "address", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }],
          responses: {
            "200": { description: "The run.", content: { "application/json": { schema: TokenRun } } },
            "400": { description: "Not a Base address.", content: { "application/json": { schema: ErrorBody } } },
            "404": { description: "No recorded run. Never a clean bill of health.", content: { "application/json": { schema: ErrorBody } } },
          },
        },
      },
      "/api/catalogue": {
        get: {
          operationId: "listCatalogue",
          summary: "Every recorded address, paged, filtered, searchable.",
          parameters: [
            { name: "filter", in: "query", schema: { type: "string", enum: CATALOGUE_FILTERS.map((f) => f.id) } },
            { name: "q", in: "query", schema: { type: "string", maxLength: 100 }, description: "Symbol or address substring." },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          ],
          responses: {
            "200": {
              description: "One page of rows.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["schemaVersion", "chainId", "forkBlock", "transactionsWereBroadcast", "filter", "availableFilters", "summary", "page", "pageCount", "total", "rows", "provenance"],
                    properties: {
                      schemaVersion: { type: "integer", const: 1 },
                      chainId: { type: "integer", const: 8453 },
                      forkBlock: { type: "integer" },
                      transactionsWereBroadcast: { type: "boolean", const: false },
                      filter: { type: "string" },
                      query: { type: ["string", "null"] },
                      availableFilters: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } } } },
                      summary: { type: "object", additionalProperties: { type: "integer" } },
                      page: { type: "integer" },
                      pageCount: { type: "integer" },
                      total: { type: "integer" },
                      rows: { type: "array", items: { type: "object", additionalProperties: true } },
                      provenance: Provenance,
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/run": {
        get: {
          operationId: "streamRun",
          summary: "The same run as a Server-Sent Event stream, in the order the probes produced it.",
          parameters: [{ name: "token", in: "query", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }],
          responses: { "200": { description: "text/event-stream of prescan, plan, probe:start, verdict, narration, done or error frames." } },
        },
      },
    },
    components: { schemas: { Verdict, TokenRun, Corroboration, Provenance, Recheck, ErrorBody } },
  };
  return Response.json(doc, {
    headers: {
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
