import { generateObject } from "ai";
import { z } from "zod";
import type { PreScan } from "@sidik/shared";
import { PROBES, PROBE_IDS } from "./probes/registry.js";

export function filterApplicable(ids: string[], scan: PreScan): string[] {
  const byId = new Map(PROBES.map((p) => [p.id, p]));
  const seen = new Set<string>();
  return ids.filter((id) => {
    const p = byId.get(id);
    if (!p || seen.has(id) || !p.applicableWhen(scan)) return false;
    seen.add(id);
    return true;
  });
}

export async function planProbes(scan: PreScan): Promise<string[]> {
  // ponytail: bare gateway model string — resolves via Vercel AI Gateway
  // (default provider) when AI_GATEWAY_API_KEY is set. Runtime-deferred: no
  // key configured yet, so this call is untested/uninvoked until then.
  const { object } = await generateObject({
    model: "anthropic/claude-sonnet-5",
    schema: z.object({ probes: z.array(z.enum(PROBE_IDS as [string, ...string[]])) }),
    prompt: `You are a Base token security auditor choosing which executable probes to run.
Token facts: ${JSON.stringify(scan)}.
Available probes: ${PROBES.map((p) => `${p.id}: ${p.title}`).join("; ")}.
Return the probes worth running, most important first. Do not invent probes or numbers.`,
  });
  const filtered = filterApplicable(object.probes, scan);
  // safety net: if the model returned nothing usable, run everything applicable.
  return filtered.length ? filtered : PROBES.filter((p) => p.applicableWhen(scan)).map((p) => p.id);
}
