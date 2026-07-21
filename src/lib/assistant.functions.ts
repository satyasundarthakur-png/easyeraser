import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

const Input = z.object({
  question: z.string().min(1).max(2000),
});

const SYSTEM = `You are a helpful assistant for a browser-based video cleanup tool that removes logos, captions, subtitles, and watermarks from user-uploaded videos.

How the tool works:
- Runs 100% in the browser — no upload, no cloud, private by default.
- The user drags a rectangle over the logo / caption / watermark region on the first frame.
- The tool applies a de-logo / inpainting filter across every frame at full resolution.
- Original audio is preserved without re-encoding when possible.
- Supported inputs: mp4, webm, mov, mkv, wav.

Answer clearly and concisely. Give step-by-step tips when useful (e.g. "select a slightly larger box than the logo", "for moving captions, cover the entire caption band"). If unsure, say so.`;

export const askAssistant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("Missing GROQ_API_KEY");
    const groq = createOpenAICompatible({
      name: "groq",
      baseURL: "https://api.groq.com/openai/v1",
      headers: { Authorization: `Bearer ${key}` },
    });
    const { text } = await generateText({
      model: groq("openai/gpt-oss-120b"),
      system: SYSTEM,
      prompt: data.question,
    });
    return { answer: text };
  });
