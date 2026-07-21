import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Shared Groq client factory used by all server functions that call Groq
 * (text assistant, AI region detection, etc.) so the base URL, auth header,
 * and missing-key check live in exactly one place.
 */
export function createGroqProvider() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY");
  return createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${key}` },
  });
}
