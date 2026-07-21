import { useCallback, useEffect, useRef, useState } from "react";
import { detectRegion } from "../lib/detect.functions";

type Status = "idle" | "loading-engine" | "ready" | "selecting" | "processing" | "done" | "error";

type Rect = { x: number; y: number; w: number; h: number };

type AppError = {
  title: string;
  message: string;
  stage?: string;
  detail?: string;
};

const ACCEPTED = "video/mp4,video/webm,video/quicktime,video/x-matroska";

// Turns a raw thrown error (often a cryptic ffmpeg/WASM/network message) into
// a clear, actionable explanation for the user, while keeping the raw detail
// around for anyone who wants to see exactly what happened.
function explainError(raw: unknown, stage?: string): AppError {
  const rawMessage =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : JSON.stringify(raw);
  const detail = raw instanceof Error && raw.stack ? raw.stack : rawMessage;
  const text = (rawMessage || "").toLowerCase();

  if (text.includes("sharedarraybuffer") || text.includes("cross-origin") || text.includes("coep")) {
    return {
      title: "Browser isn't set up for in-browser processing",
      message:
        "This tool needs cross-origin isolation (SharedArrayBuffer) to run the video engine. Try a different browser, disable extensions that block it, or reload the page once more.",
      stage,
      detail,
    };
  }
  if (text.includes("out of memory") || text.includes("oom") || text.includes("memory access out of bounds")) {
    return {
      title: "Ran out of memory",
      message:
        "The video is too large or too long for your browser to process in memory. Try a shorter clip, a smaller file, or closing other tabs to free up memory.",
      stage,
      detail,
    };
  }
  if (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("load failed") ||
    text.includes("failed to import")
  ) {
    return {
      title: stage === "Auto-detecting overlay…" ? "Couldn't reach the AI detector" : "Couldn't load the processing engine",
      message:
        stage === "Auto-detecting overlay…"
          ? "The AI detection request failed, likely due to a network issue. You can draw the box manually instead."
          : "The video engine (ffmpeg-core.js) couldn't be downloaded from its CDN. This is usually a network hiccup, an ad-blocker/firewall blocking the CDN, or the CDN being briefly unavailable. Check your connection and try again — it retries a backup CDN automatically.",
      stage,
      detail,
    };
  }
  if (text.includes("unsupported") || text.includes("invalid data found") || text.includes("moov atom not found")) {
    return {
      title: "Unsupported or corrupted video",
      message:
        "The engine couldn't read this file's video/audio format. Try re-exporting the video, or convert it to mp4 first.",
      stage,
      detail,
    };
  }
  if (text.includes("assertionerror") || text.includes("abort(") || text.includes("exited with signal")) {
    return {
      title: "Processing engine crashed",
      message:
        "The in-browser video engine crashed while working on this file. This can happen with unusual codecs or very large frames — try a shorter clip or a different format.",
      stage,
      detail,
    };
  }
  if (!rawMessage || text === "processing failed") {
    return {
      title: "Processing failed",
      message:
        "Something went wrong and no further detail was reported. Try again, or try a shorter/smaller video.",
      stage,
      detail,
    };
  }
  return {
    title: "Processing failed",
    message: rawMessage,
    stage,
    detail,
  };
}

export function VideoProcessor() {
  const [file, setFile] = useState<File | null>(null);
  const [inputUrl, setInputUrl] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [err, setErr] = useState<AppError | null>(null);
  const [showErrDetail, setShowErrDetail] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<"delogo" | "blur">("delogo");
  const [detecting, setDetecting] = useState(false);
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const ffmpegRef = useRef<any>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);

  const reset = () => {
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(null);
    setInputUrl(null);
    setOutputUrl(null);
    setStatus("idle");
    setProgress(0);
    setStage("");
    setErr(null);
    setShowErrDetail(false);
    setRect(null);
    setVideoDims(null);
    setDetectedLabel(null);
  };

  const accept = useCallback((f: File) => {
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setErr(null);
    setOutputUrl(null);
    setProgress(0);
    setRect(null);
    setDetectedLabel(null);
    setStatus("selecting");
    setFile(f);
    setInputUrl(URL.createObjectURL(f));
  }, [inputUrl, outputUrl]);

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    const okType =
      f.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(f.name);
    if (!okType) {
      setErr({
        title: "Unsupported file type",
        message: "This file isn't a recognized video. Use mp4, webm, mov, or mkv.",
      });
      return;
    }
    if (f.size > 500 * 1024 * 1024) {
      setErr({
        title: "File too large",
        message: `Your file is ${(f.size / (1024 * 1024)).toFixed(0)}MB, which is over the 500MB limit. Try a shorter clip or compress it first.`,
      });
      return;
    }
    accept(f);
  };

  // Load ffmpeg lazily
  const ensureEngine = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    setStatus("loading-engine");
    setStage("Loading processing engine…");
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress: p }: { progress: number }) => {
      const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
      setProgress(pct);
    });

    // ffmpeg-core.js/.wasm are fetched from a CDN at runtime. A single CDN
    // being down, rate-limited, or blocked (ad-blocker/corporate firewall)
    // would otherwise fail the whole app with an opaque "failed to import"
    // error — so try a couple of CDNs before giving up.
    const CORE_VERSION = "0.12.10";
    const CDN_BASES = [
      `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
      `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
    ];

    let lastErr: unknown;
    for (const base of CDN_BASES) {
      try {
        const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
        const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");
        await ffmpeg.load({ coreURL, wasmURL });
        ffmpegRef.current = ffmpeg;
        return ffmpeg;
      } catch (e) {
        lastErr = e;
        console.warn(`Failed to load ffmpeg-core from ${base}, trying next CDN if available.`, e);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Failed to load the video engine from any CDN");
  };

  const onVideoLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    setVideoDims({ w: v.videoWidth, h: v.videoHeight });
  };

  // Region draw handlers (in displayed pixel coords, normalized 0..1)
  const onPointerDown = (e: React.PointerEvent) => {
    const el = overlayRef.current;
    if (!el) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    drawStart.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    setRect({ x: drawStart.current.x, y: drawStart.current.y, w: 0, h: 0 });
    setDetectedLabel(null);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawStart.current) return;
    const el = overlayRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const x = Math.min(drawStart.current.x, cx);
    const y = Math.min(drawStart.current.y, cy);
    const w = Math.abs(cx - drawStart.current.x);
    const h = Math.abs(cy - drawStart.current.y);
    setRect({ x, y, w, h });
  };
  const onPointerUp = () => {
    drawStart.current = null;
  };

  // Captures the current video frame, sends it to the AI detector, and
  // pre-fills the same draggable/resizable selection box the user would
  // draw manually — so the AI's guess is always a starting point the user
  // can edit, never a black box.
  const autoDetect = async () => {
    const v = videoRef.current;
    const overlayEl = overlayRef.current;
    if (!v || !overlayEl || !videoDims) return;

    setDetecting(true);
    setErr(null);
    setShowErrDetail(false);
    setStage("Auto-detecting overlay…");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoDims.w;
      canvas.height = videoDims.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported in this browser");
      ctx.drawImage(v, 0, 0, videoDims.w, videoDims.h);
      const imageDataUrl = canvas.toDataURL("image/jpeg", 0.8);

      const result = await detectRegion({ data: { imageDataUrl } });

      if (!result.found) {
        setErr({
          title: "No overlay found",
          message:
            "The AI didn't find an obvious logo, watermark, or caption to remove. Try a frame where the mark is clearly visible, or draw the box manually.",
          stage: "Auto-detecting overlay…",
        });
        return;
      }

      // Convert the AI's normalized (0..1) box into the same displayed
      // pixel coordinates the manual drag-box uses.
      const overlayRect = overlayEl.getBoundingClientRect();
      setRect({
        x: result.x * overlayRect.width,
        y: result.y * overlayRect.height,
        w: result.w * overlayRect.width,
        h: result.h * overlayRect.height,
      });
      setDetectedLabel(result.label);
    } catch (e: any) {
      console.error(e);
      setErr(explainError(e, "Auto-detecting overlay…"));
    } finally {
      setDetecting(false);
      setStage("");
    }
  };

  const process = async () => {
    if (!file || !rect || !videoDims || !overlayRef.current) {
      setErr({
        title: "No region selected",
        message: "Draw a box over the logo, caption, or watermark first.",
      });
      return;
    }
    const overlayRect = overlayRef.current.getBoundingClientRect();
    // scale from displayed coords -> real video pixel coords
    const sx = videoDims.w / overlayRect.width;
    const sy = videoDims.h / overlayRect.height;
    let rx = Math.round(rect.x * sx);
    let ry = Math.round(rect.y * sy);
    let rw = Math.round(rect.w * sx);
    let rh = Math.round(rect.h * sy);
    // delogo requires min 1px inside frame; also constrain
    rx = Math.max(1, Math.min(videoDims.w - 2, rx));
    ry = Math.max(1, Math.min(videoDims.h - 2, ry));
    rw = Math.max(4, Math.min(videoDims.w - rx - 1, rw));
    rh = Math.max(4, Math.min(videoDims.h - ry - 1, rh));

    setErr(null);
    setShowErrDetail(false);
    setOutputUrl(null);
    setProgress(0);
    setStage("Preparing engine…");
    try {
      const ffmpeg = await ensureEngine();
      setStatus("processing");
      setStage("Loading file into memory…");
      const { fetchFile } = await import("@ffmpeg/util");
      const inputName = "input" + (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4");
      const outputName = "output.mp4";
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      const vf = `delogo=x=${rx}:y=${ry}:w=${rw}:h=${rh}:show=0`;
      // boxblur's radius must scale down for small selections — a fixed
      // radius of 20 fails on small crops (e.g. a typical small logo box)
      // because it exceeds what the cropped region/chroma planes support.
      const blurRadius = Math.max(2, Math.min(20, Math.floor(Math.min(rw, rh) / 6)));

      // For blur mode we crop-blur-overlay so only the region is blurred
      const args =
        mode === "delogo"
          ? ["-i", inputName, "-vf", vf, "-c:a", "copy", "-y", outputName]
          : [
              "-i",
              inputName,
              "-filter_complex",
              `[0:v]crop=${rw}:${rh}:${rx}:${ry},boxblur=${blurRadius}:2[fg];[0:v][fg]overlay=${rx}:${ry}[v]`,
              "-map",
              "[v]",
              "-map",
              "0:a?",
              "-c:a",
              "copy",
              "-y",
              outputName,
            ];

      setStage("Removing selected region across all frames…");
      await ffmpeg.exec(args);
      setStage("Finalizing output…");
      const data: any = await ffmpeg.readFile(outputName);
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      setOutputUrl(URL.createObjectURL(blob));
      setProgress(100);
      setStatus("done");
      setStage("");
    } catch (e: any) {
      console.error(e);
      setErr(explainError(e, stage));
      setStatus("error");
    }
  };

  useEffect(() => {
    return () => {
      if (inputUrl) URL.revokeObjectURL(inputUrl);
      if (outputUrl) URL.revokeObjectURL(outputUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadName = file
    ? file.name.replace(/(\.[^.]+)?$/, "-clean.mp4")
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
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl p-12 text-center transition ${
            dragOver
              ? "rainbow-ring"
              : "border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/40"
          }`}
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <p className="text-base font-medium">Drop your video here, or click to browse</p>
          <p className="mt-1 text-sm text-muted-foreground">mp4, webm, mov, mkv · up to 500MB · processed privately in your browser</p>
          <div className="mt-6">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              className="bg-rainbow-flow rounded-md px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-transform hover:scale-[1.03]"
            >
              Choose file
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
                {(file.size / (1024 * 1024)).toFixed(2)} MB
                {videoDims ? ` · ${videoDims.w}×${videoDims.h}` : ""}
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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  1. Draw a box over the logo / caption / watermark
                </p>
                <button
                  type="button"
                  onClick={autoDetect}
                  disabled={detecting || !videoDims || status === "processing" || status === "loading-engine"}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${
                    detecting
                      ? "rainbow-ring text-foreground"
                      : "border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                  }`}
                >
                  {detecting ? (
                    "Detecting…"
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v2m0 14v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M3 12h2m14 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>
                      Auto-detect (AI)
                    </>
                  )}
                </button>
              </div>
              <div className="relative overflow-hidden rounded-lg border border-border bg-black">
                {inputUrl && (
                  <video
                    ref={videoRef}
                    src={inputUrl}
                    controls
                    onLoadedMetadata={onVideoLoaded}
                    className="block w-full"
                  />
                )}
                <div
                  ref={overlayRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  className="absolute inset-0 cursor-crosshair"
                  style={{ touchAction: "none" }}
                >
                  {rect && rect.w > 2 && rect.h > 2 && (
                    <div
                      className="absolute border-2 border-primary bg-primary/20"
                      style={{
                        left: rect.x,
                        top: rect.y,
                        width: rect.w,
                        height: rect.h,
                      }}
                    />
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {detectedLabel
                  ? `AI suggested a "${detectedLabel}" region — drag a new box over the video to adjust it.`
                  : "Tip: pause the video on a frame where the mark is clearly visible, then click-drag over it, or use Auto-detect (AI)."}
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Output</p>
              {outputUrl ? (
                <video src={outputUrl} controls className="w-full rounded-lg border border-border bg-black" />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  {status === "processing" || status === "loading-engine"
                    ? stage || "Processing…"
                    : "Awaiting processing"}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Removal mode</span>
            <div className="inline-flex rounded-md border border-border p-0.5">
              <button
                onClick={() => setMode("delogo")}
                className={`rounded px-3 py-1 text-xs font-medium ${mode === "delogo" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                Inpaint (delogo)
              </button>
              <button
                onClick={() => setMode("blur")}
                className={`rounded px-3 py-1 text-xs font-medium ${mode === "blur" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                Blur region
              </button>
            </div>
          </div>

          {(status === "processing" || status === "loading-engine") && (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-rainbow-flow h-full transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{stage} {progress > 0 ? `· ${progress}%` : ""}</p>
            </div>
          )}

          {err && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">{err.title}</p>
              <p className="mt-1 text-destructive/90">{err.message}</p>
              {err.stage && (
                <p className="mt-1 text-xs text-destructive/70">Happened during: {err.stage}</p>
              )}
              {err.detail && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowErrDetail((v) => !v)}
                    className="text-xs font-medium underline underline-offset-2 text-destructive/80 hover:text-destructive"
                  >
                    {showErrDetail ? "Hide technical details" : "Show technical details"}
                  </button>
                  {showErrDetail && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-destructive/5 p-2 text-xs text-destructive/80">
                      {err.detail}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={process}
              disabled={status === "processing" || status === "loading-engine" || !rect}
              className="bg-rainbow-flow rounded-md px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-transform hover:scale-[1.02] disabled:animate-none disabled:opacity-60 disabled:hover:scale-100"
            >
              {status === "processing"
                ? "Processing…"
                : status === "loading-engine"
                  ? "Loading engine…"
                  : status === "done"
                    ? "Re-process"
                    : "2. Remove selection"}
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
        </div>
      )}
    </div>
  );
}
