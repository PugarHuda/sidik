import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Venice serves claude-sonnet-5 over an OpenAI-compatible API, so the model
// the probes were designed around stays the same — only the route to it
// changes. Its /models endpoint reports supportsResponseSchema and
// supportsFunctionCalling for this model, which is what the planner's
// structured output needs.
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
