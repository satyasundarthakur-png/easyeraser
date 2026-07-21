import { useCallback, useRef, useState } from "react";

type Status = "idle" | "loading" | "processing" | "done" | "error";

const ACCEPTED = "video/mp4,video/webm,video/quicktime,video/x-matroska,audio/wav,audio/x-wav";

export function VideoProcessor() {
  const [file, setFile] = useState<File | null>(null);
  const [inputUrl, setInputUrl] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(null);
    setInputUrl(null);
    setOutputUrl(null);
    setStatus("idle");
    setProgress(0);
    setErr(null);
  };

  const accept = useCallback((f: File) => {
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setErr(null);
    setOutputUrl(null);
    setProgress(0);
    setStatus("idle");
    setFile(f);
    setInputUrl(URL.createObjectURL(f));
  }, [inputUrl, outputUrl]);

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    const okType =
      f.type.startsWith("video/") ||
      f.type === "audio/wav" ||
      f.type === "audio/x-wav" ||
      /\.(mp4|webm|mov|mkv|wav)$/i.test(f.name);
    if (!okType) {
      setErr("Unsupported file. Use mp4, webm, mov, mkv, or wav.");
      return;
    }
    if (f.size > 500 * 1024 * 1024) {
      setErr("File too large (max 500MB in demo).");
      return;
    }
    accept(f);
  };

  const process = async () => {
    if (!file) return;
    setStatus("processing");
    setProgress(0);
    setErr(null);
    try {
      // Simulate reverse-alpha-blend processing pipeline stages
      const stages = [
        "Detecting watermark region",
        "Analyzing alpha channel",
        "Reverse blending pixels",
        "Muxing audio track",
        "Finalizing output",
      ];
      for (let i = 0; i < stages.length; i++) {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 400));
        setProgress(Math.round(((i + 1) / stages.length) * 100));
      }
      // Read file into a fresh blob so the "processed" download is distinct
      const buf = await file.arrayBuffer();
      const blob = new Blob([buf], { type: file.type || "video/mp4" });
      setOutputUrl(URL.createObjectURL(blob));
      setStatus("done");
    } catch (e: any) {
      setErr(e?.message ?? "Processing failed");
      setStatus("error");
    }
  };

  const runDemo = async () => {
    setStatus("loading");
    setErr(null);
    try {
      // Tiny sample MP4 from a public CDN
      const url = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch demo video");
      const blob = await res.blob();
      const demoFile = new File([blob], "demo-veo-sample.mp4", { type: "video/mp4" });
      accept(demoFile);
      setStatus("idle");
      // auto-start
      setTimeout(() => {
        void processWith(demoFile);
      }, 50);
    } catch (e: any) {
      setErr(e?.message ?? "Demo failed");
      setStatus("error");
    }
  };

  const processWith = async (f: File) => {
    setStatus("processing");
    setProgress(0);
    try {
      for (let i = 1; i <= 5; i++) {
        await new Promise((r) => setTimeout(r, 500));
        setProgress(i * 20);
      }
      const buf = await f.arrayBuffer();
      const blob = new Blob([buf], { type: f.type || "video/mp4" });
      setOutputUrl(URL.createObjectURL(blob));
      setStatus("done");
    } catch (e: any) {
      setErr(e?.message ?? "Processing failed");
      setStatus("error");
    }
  };

  const downloadName = file
    ? file.name.replace(/(\.[^.]+)?$/, "-clean$1")
    : "output-clean.mp4";

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      {!file ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/40"
          }`}
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <p className="text-base font-medium">Drop your video here, or click to browse</p>
          <p className="mt-1 text-sm text-muted-foreground">mp4, webm, mov, mkv, wav · up to 500MB</p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Choose file
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void runDemo();
              }}
              disabled={status === "loading"}
              className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
            >
              {status === "loading" ? "Loading demo…" : "Try with sample video"}
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / (1024 * 1024)).toFixed(2)} MB · {file.type || "video"}
              </p>
            </div>
            <button
              onClick={reset}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Remove
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Input</p>
              {inputUrl && (
                <video src={inputUrl} controls className="w-full rounded-lg border border-border bg-black" />
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Output</p>
              {outputUrl ? (
                <video src={outputUrl} controls className="w-full rounded-lg border border-border bg-black" />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  {status === "processing" ? "Processing…" : "Awaiting processing"}
                </div>
              )}
            </div>
          </div>

          {status === "processing" && (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{progress}% · reverse alpha blending</p>
            </div>
          )}

          {err && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {err}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={process}
              disabled={status === "processing"}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {status === "processing" ? "Processing…" : status === "done" ? "Re-process" : "Process video"}
            </button>
            {outputUrl && (
              <a
                href={outputUrl}
                download={downloadName}
                className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent"
              >
                Download clean video
              </a>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Browser demo simulates the pipeline. For real watermark removal at full fidelity, run the{" "}
            <a href="https://github.com/allenk/VeoWatermarkRemover/releases/latest" className="underline">
              offline CLI
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}
