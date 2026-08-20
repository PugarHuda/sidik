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

function allApplicable(scan: PreScan): string[] {
  return PROBES.filter((p) => p.applicableWhen(scan)).map((p) => p.id);
}

export async function planProbes(scan: PreScan): Promise<string[]> {
  // The plan is an ordering hint, never a source of truth — every verdict is
  // produced by deterministic code either way. So an unreachable or
  // unauthorized gateway must not take the run down with it: fall back to
  // running everything applicable, exactly as an unusable answer already did.
  let picked: string[];
  try {
    // ponytail: bare gateway model string — resolves via Vercel AI Gateway
    // (default provider) when AI_GATEWAY_API_KEY is set.
    const { object } = await generateObject({
      model: "anthropic/claude-sonnet-5",
      schema: z.object({ probes: z.array(z.enum(PROBE_IDS as [string, ...string[]])) }),
      prompt: `You are a Base token security auditor choosing which executable probes to run.
Token facts: ${JSON.stringify(scan)}.
Available probes: ${PROBES.map((p) => `${p.id}: ${p.title}`).join("; ")}.
Return the probes worth running, most important first. Do not invent probes or numbers.`,
    });
    picked = filterApplicable(object.probes, scan);
  } catch {
    return allApplicable(scan);
  }
  // safety net: if the model returned nothing usable, run everything applicable.
  return picked.length ? picked : allApplicable(scan);
}
