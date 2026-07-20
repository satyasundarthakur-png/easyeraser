import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  question: z.string().min(1).max(2000),
});

const SYSTEM = `You are an expert assistant for "Veo Watermark Remover" — an open-source CLI tool that removes the Gemini/Veo diamond watermark and the small "Veo" text wordmark from Google Veo-generated videos using mathematically precise reverse alpha blending (no generative fill, no hallucinated pixels).

Key facts:
- Runs fully offline. No cloud. Cross-platform single executable (Windows / Linux / macOS).
- Auto-detects the watermark (Gemini diamond OR small Veo text), landscape or portrait, 720p and 1080p.
- Preserves audio without re-encoding.
- Flags: --legacy (older large Veo text pre-Gemini-3.5), --ml (opt-in Alpha Judge intensity assist), --variant 720p-1/720p-2, --sigma N, -i/-o.
- Latest release v0.6.4: ML assist is opt-in; more reliable small "Veo" detection; adds 1080p small Veo wordmark.
- Manual touch-up workflow uses ffmpeg to decompose frames and the GUI GeminiWatermarkTool Alpha slider.

Answer clearly, concisely, with code examples when useful. If unsure, say so.`;

export const askAssistant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system: SYSTEM,
      prompt: data.question,
    });
    return { answer: text };
  });
