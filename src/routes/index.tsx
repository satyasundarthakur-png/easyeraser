import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { askAssistant } from "@/lib/assistant.functions";
import veoDemo from "@/assets/veo-demo.gif.asset.json";
import gwtDemo from "@/assets/gwt-demo.gif.asset.json";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Veo Watermark Remover — Clean removal, pure math" },
      {
        name: "description",
        content:
          "Remove the Gemini/Veo diamond and small Veo text watermark from Google Veo videos using mathematically precise reverse alpha blending. Offline, cross-platform, audio preserved.",
      },
      { property: "og:title", content: "Veo Watermark Remover" },
      {
        property: "og:description",
        content:
          "Offline CLI that removes Google Veo watermarks with reverse alpha blending — no generative fill, no quality loss.",
      },
      { property: "og:image", content: veoDemo.url },
      { name: "twitter:image", content: veoDemo.url },
    ],
  }),
});

function Home() {
  const ask = useServerFn(askAssistant);
  const [q, setQ] = useState("");
  const [a, setA] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    setA(null);
    try {
      const res = await ask({ data: { question: q } });
      setA(res.answer);
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary" />
            <span className="text-lg font-semibold tracking-tight">Veo Watermark Remover</span>
          </div>
          <a
            href="https://github.com/allenk/VeoWatermarkRemover/releases/latest"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Download
          </a>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="max-w-3xl">
          <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            v0.6.4 · Demo build
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Remove Veo watermarks with pure math — no hallucinated pixels.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            A cross-platform CLI that erases the Gemini diamond and the small
            "Veo" wordmark from Google Veo videos using reverse alpha blending.
            100% offline. Audio preserved. Auto-detects watermark type,
            resolution, and orientation.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="https://github.com/allenk/VeoWatermarkRemover/releases/latest"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download latest
            </a>
            <a
              href="https://github.com/allenk/VeoWatermarkRemover"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent"
            >
              View on GitHub
            </a>
          </div>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <figure className="overflow-hidden rounded-lg border border-border">
            <img src={veoDemo.url} alt="Drag and drop demo" className="w-full" />
            <figcaption className="border-t border-border p-3 text-sm text-muted-foreground">
              Drag & drop workflow
            </figcaption>
          </figure>
          <figure className="overflow-hidden rounded-lg border border-border">
            <img src={gwtDemo.url} alt="Before / after comparison" className="w-full" />
            <figcaption className="border-t border-border p-3 text-sm text-muted-foreground">
              Before / after
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">Quick start</h2>
          <div className="mt-6 grid gap-4">
            <pre className="overflow-x-auto rounded-md border border-border bg-card p-4 text-sm">
{`# Auto-detects diamond OR small "Veo" text
./GeminiWatermarkTool-Video video.mp4

# Older large Veo text (pre-Gemini-3.5)
./GeminiWatermarkTool-Video --legacy old.mp4

# Opt-in ML intensity assist for tricky clips
./GeminiWatermarkTool-Video --ml video.mp4`}
            </pre>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Ask the AI assistant</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Powered by Lovable AI. Ask anything about flags, workflows, or difficult clips.
        </p>
        <form onSubmit={onAsk} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="How do I fix a clip with a bright background?"
            className="flex-1 rounded-md border border-border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {loading ? "Thinking…" : "Ask"}
          </button>
        </form>
        {err && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {err}
          </p>
        )}
        {a && (
          <div className="mt-6 whitespace-pre-wrap rounded-md border border-border bg-card p-5 text-sm leading-relaxed">
            {a}
          </div>
        )}
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-muted-foreground">
          Based on GeminiWatermarkTool · MIT License · Demo build
        </div>
      </footer>
    </div>
  );
}
