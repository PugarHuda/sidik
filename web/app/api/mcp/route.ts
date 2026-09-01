import type { NextRequest } from "next/server";

/**
 * Sidik as a tool an agent can call, hosted.
 *
 * The engine has spoken Model Context Protocol for a while, but only on a
 * machine somebody ran themselves — which made "an agent asked *is this token
 * safe* can call a fork execution instead of a scanner" true in principle and
 * false in practice. It is a hosted endpoint now:
 *
 *   claude mcp add --transport http sidik https://sidik-eight.vercel.app/api/mcp
 *
 * Tools: sidik_token (the executed verdicts for an address), sidik_catalogue
 * (paged and filtered), sidik_run (execute the probes now, on a fresh fork).
 *
 * The protocol lives in engine/src/mcp.ts and is shared with the self-hosted
 * engine rather than reimplemented here, so an agent gets the same Sidik
 * whichever URL it found.
 */
export const runtime = "nodejs";
// sidik_run forks Base and executes; the others answer from the catalogue in
// milliseconds. The budget is set for the slow one.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// An MCP client is somebody else's program, frequently a browser extension or
// a local agent on an origin we cannot know. The catalogue is public data and
// the endpoint takes no credentials, so there is nothing here to protect with
// a same-origin rule.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** No server-initiated stream, the same answer the engine gives. */
export function GET() {
  return new Response(
    "Sidik MCP: POST JSON-RPC 2.0 messages here (Streamable HTTP). No server-initiated stream.\n"
    + "claude mcp add --transport http sidik https://sidik-eight.vercel.app/api/mcp\n",
    { status: 405, headers: { "content-type": "text/plain; charset=utf-8", ...CORS } },
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  }

  const { mcpHandle } = await import("@sidik/engine/mcp");
  const out = await mcpHandle(body);
  if (out.status === 202) return new Response(null, { status: 202, headers: CORS });
  return json(out.body);
}
