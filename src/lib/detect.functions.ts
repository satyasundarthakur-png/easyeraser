import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createGroqProvider } from "./groq.server";

const Input = z.object({
  // data URL (data:image/jpeg;base64,...) of a single video frame
  imageDataUrl: z.string().min(1),
});

const SYSTEM = `You are a computer vision assistant for a video-cleanup tool that removes logos, watermarks, channel bugs, and burned-in captions/subtitles from videos.

Given a single frame, find the ONE most prominent overlay that a user would want removed. Prefer: channel/brand logos, watermarks, and channel bugs over incidental text that is part of the actual scene.

Respond with ONLY strict JSON and nothing else — no markdown fences, no prose, no explanation:
{"found":true,"label":"logo","x":0.02,"y":0.03,"w":0.18,"h":0.12,"confidence":0.9}

Rules:
- x, y, w, h are fractions of the frame width/height (0..1), where x,y is the top-left corner of the box.
- label is one of: "logo", "watermark", "caption", "channel_bug", "other".
- Pad the box slightly (5-10%) beyond the visible mark so removal fully covers it.
- If there is genuinely nothing removable in the frame, respond exactly: {"found":false}
- Never wrap the JSON in backticks or add any other text.`;

export type DetectResult =
  | { found: true; label: string; x: number; y: number; w: number; h: number; confidence?: number }
  | { found: false; reason?: string };

export const detectRegion = createServerFn({ method: "POST" })
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<DetectResult> => {
    const groq = createGroqProvider();

    const { text } = await generateText({
      // Current Groq production vision model (image + text input).
      model: groq("meta-llama/llama-4-maverick-17b-128e-instruct"),
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Find the overlay to remove in this frame." },
            { type: "image", image: data.imageDataUrl },
          ],
        },
      ],
    });

    const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { found: false, reason: "Detection model returned an unreadable response" };
    }

    if (!parsed?.found) {
      return { found: false };
    }

    const clamp01 = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));
    const x = clamp01(parsed.x);
    const y = clamp01(parsed.y);
    const w = Math.max(0.02, Math.min(1 - x, clamp01(parsed.w)));
    const h = Math.max(0.02, Math.min(1 - y, clamp01(parsed.h)));

    return {
      found: true,
      label: typeof parsed.label === "string" ? parsed.label : "region",
      x,
      y,
      w,
      h,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    };
  });
