import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "loading-engine" | "ready" | "selecting" | "processing" | "done" | "error";

type Rect = { x: number; y: number; w: number; h: number };

const ACCEPTED = "video/mp4,video/webm,video/quicktime,video/x-matroska";

export function VideoProcessor() {
  const [file, setFile] = useState<File | null>(null);
  const [inputUrl, setInputUrl] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<"delogo" | "blur">("delogo");

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
    setRect(null);
    setVideoDims(null);
  };

  const accept = useCallback((f: File) => {
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setErr(null);
    setOutputUrl(null);
    setProgress(0);
    setRect(null);
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
      setErr("Unsupported file. Use mp4, webm, mov, or mkv.");
      return;
    }
    if (f.size > 300 * 1024 * 1024) {
      setErr("File too large (max 300MB).");
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
    const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
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

  const process = async () => {
    if (!file || !rect || !videoDims || !overlayRef.current) {
      setErr("Draw a box over the logo, caption, or watermark first.");
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

      const vf =
        mode === "delogo"
          ? `delogo=x=${rx}:y=${ry}:w=${rw}:h=${rh}:show=0`
          : `boxblur=luma_radius=min(h\\,w)/40:luma_power=2:enable='between(t,0,999999)'`;

      // For blur mode we crop-blur-overlay so only the region is blurred
      const args =
        mode === "delogo"
          ? ["-i", inputName, "-vf", vf, "-c:a", "copy", "-y", outputName]
          : [
              "-i",
              inputName,
              "-filter_complex",
              `[0:v]crop=${rw}:${rh}:${rx}:${ry},boxblur=20:2[fg];[0:v][fg]overlay=${rx}:${ry}[v]`,
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
      setErr(e?.message ?? "Processing failed");
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
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/40"
          }`}
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <p className="text-base font-medium">Drop your video here, or click to browse</p>
          <p className="mt-1 text-sm text-muted-foreground">mp4, webm, mov, mkv · up to 300MB · processed privately in your browser</p>
          <div className="mt-6">
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
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                1. Draw a box over the logo / caption / watermark
              </p>
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
                Tip: pause the video on a frame where the mark is clearly visible, then click-drag over it.
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
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{stage} {progress > 0 ? `· ${progress}%` : ""}</p>
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
              disabled={status === "processing" || status === "loading-engine" || !rect}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
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
