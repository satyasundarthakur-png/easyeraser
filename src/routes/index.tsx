import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { askAssistant } from "@/lib/assistant.functions";
import { VideoProcessor } from "@/components/VideoProcessor";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Clean Frame — Remove logos, captions & watermarks from video" },
      {
        name: "description",
        content:
          "Upload a video and remove any logo, caption, subtitle, or watermark. Runs privately in your browser — no upload, no account, audio preserved.",
      },
      { property: "og:title", content: "Clean Frame — Video watermark remover" },
      {
        property: "og:description",
        content:
          "Drag a box over any logo, caption, or watermark and remove it from your video. Fully in-browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
            <span className="text-lg font-semibold tracking-tight">Clean Frame</span>
          </div>
          <a
            href="#upload"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Start cleaning
          </a>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="max-w-3xl">
          <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            100% in-browser · private by default
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Remove logos, captions and watermarks from any video.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Drop a video, drag a rectangle over the mark, and download the cleaned
            file. Works on logos, subtitles, timecodes, and watermarks — from any
            source. Your file never leaves your device.
          </p>
        </div>

        <div id="upload" className="mt-12">
          <VideoProcessor />
        </div>
      </section>

      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { n: "1", t: "Upload", d: "Drop an mp4, webm, mov, or mkv up to 300MB." },
              { n: "2", t: "Select", d: "Click-drag a box over the logo, caption, or watermark." },
              { n: "3", t: "Download", d: "Get a clean mp4 with the region removed and audio preserved." },
            ].map((s) => (
              <div key={s.n} className="rounded-xl border border-border bg-card p-5">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {s.n}
                </div>
                <p className="text-base font-medium">{s.t}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Ask the AI assistant</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tips on getting the cleanest result — box sizing, tricky captions, moving marks.
        </p>
        <form onSubmit={onAsk} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="How do I remove scrolling subtitles?"
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
          Clean Frame · Private, in-browser video cleanup
        </div>
      </footer>
    </div>
  );
}
