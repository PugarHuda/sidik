import { generateText } from "ai";
import type { Verdict } from "@sidik/shared";

const NUM = /\d[\d,]*(?:\.\d+)?/g;
const norm = (s: string) => s.replace(/,/g, "");

export function allowedNumbers(verdicts: Verdict[]): Set<string> {
  const set = new Set<string>();
  const eat = (s: string) => { for (const m of s.matchAll(NUM)) set.add(norm(m[0])); };
  for (const v of verdicts) {
    Object.values(v.numbers).forEach(eat);
    v.rows.forEach((r) => { eat(r.claimed); eat(r.proven); eat(r.label); });
    if (v.reason) eat(v.reason);
    v.title && eat(v.title);
  }
  return set;
}

export function guardProse(prose: string, allowed: Set<string>): string {
  for (const m of prose.matchAll(NUM)) if (!allowed.has(norm(m[0]))) return ""; // hallucinated number
  return prose;
}

export async function narrate(verdicts: Verdict[]): Promise<string> {
  const allowed = allowedNumbers(verdicts);
  let text: string;
  try {
    // ponytail: bare gateway model string — resolves via Vercel AI Gateway
    // (default provider) when AI_GATEWAY_API_KEY is set.
    ({ text } = await generateText({
      model: "anthropic/claude-sonnet-5",
      prompt: `Write a short, hype-free summary of these executed token-safety verdicts.
Every number you use MUST appear verbatim in the data. Do not invent figures.
Data: ${JSON.stringify(verdicts)}`,
    }));
  } catch {
    // The prose is decoration; the verdicts are the product. An unreachable
    // or unauthorized gateway degrades to the template, it does not fail the run.
    return templateFallback(verdicts);
  }
  return guardProse(text, allowed) || templateFallback(verdicts);
}

export function templateFallback(verdicts: Verdict[]): string {
  return verdicts.map((v) => `${v.status === "FAIL" ? "⚠️" : v.status === "PASS" ? "✓" : "—"} ${v.title}`).join("\n");
}
