import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Venice serves claude-sonnet-5 over an OpenAI-compatible API, so the model
// the probes were designed around stays the same — only the route to it
// changes.
const BASE_URL = process.env.VENICE_BASE_URL ?? "https://api.venice.ai/api/v1";

export const MODEL = process.env.SIDIK_MODEL ?? "claude-sonnet-5";

// ponytail: one provider instance for the whole engine. Both callers wrap
// their request in a try/catch and fall back to deterministic behaviour, so
// a missing key costs prose and probe ordering — never a verdict.
const venice = createOpenAICompatible({
  name: "venice",
  baseURL: BASE_URL,
  apiKey: process.env.VENICE_API_KEY ?? "",
});

export const llm = venice(MODEL);

// Venice prepends a large system prompt of its own to every request. Measured
// 2026-08-20: a 14-token prompt billed as 2,435 input tokens with it on, and
// 14 with it off. It is both the dominant cost here and an uncontrolled
// instruction sitting in front of ours, so it stays off.
export const VENICE_OPTIONS = {
  venice: { venice_parameters: { include_venice_system_prompt: false } },
} as const;
