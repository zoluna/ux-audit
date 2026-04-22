"use client";

import { useRef, useState } from "react";

type ScrapeResult = {
  markdown: string;
  title: string;
  description: string;
};

type Severity = "critical" | "major" | "minor";

type Finding = {
  severity: Severity;
  issue: string;
  evidence: string;
  recommendation: string;
};

type Analysis = {
  heuristic: string;
  heuristic_label: string;
  score: number;
  summary: string;
  findings: Finding[];
};

type Status = "idle" | "loading" | "done" | "error";

const MAX_FILE_BYTES = 4_500_000; // ~4.5MB — Netlify Function payload cap is ~6MB after base64
const MAX_IMAGE_DIMENSION = 7800; // Claude vision rejects anything > 8000px on any side

async function resizeForClaude(file: File, maxDim: number): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Image decode failed"));
    im.src = dataUrl;
  });

  const longest = Math.max(img.width, img.height);
  if (longest <= maxDim) return dataUrl;

  const scale = maxDim / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported in this browser");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [url, setUrl] = useState("");
  const [scrapeStatus, setScrapeStatus] = useState<Status>("idle");
  const [analysisStatus, setAnalysisStatus] = useState<Status>("idle");
  const [scrape, setScrape] = useState<ScrapeResult | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [errors, setErrors] = useState<{ scrape?: string; analysis?: string }>({});

  async function handleFile(f: File) {
    setFileError(null);
    if (!f.type.startsWith("image/")) {
      setFileError("File must be an image (PNG, JPEG, or WebP).");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError(
        `Image is ${(f.size / 1_000_000).toFixed(1)}MB. Max is ${(MAX_FILE_BYTES / 1_000_000).toFixed(1)}MB.`
      );
      return;
    }
    setFile(f);
    try {
      const processed = await resizeForClaude(f, MAX_IMAGE_DIMENSION);
      setFilePreview(processed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read file";
      setFileError(message);
    }
  }

  function clearFile() {
    setFile(null);
    setFilePreview(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!filePreview) return;

    const trimmedUrl = url.trim();

    setScrape(null);
    setAnalysis(null);
    setErrors({});
    setScrapeStatus(trimmedUrl ? "loading" : "idle");
    setAnalysisStatus("loading");

    const scrapePromise: Promise<ScrapeResult | null> = trimmedUrl
      ? (async () => {
          const r = await fetch("/api/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: trimmedUrl }),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error ?? "Scrape failed");
          setScrape(data);
          setScrapeStatus("done");
          return data as ScrapeResult;
        })()
      : Promise.resolve(null);

    const analyzePromise: Promise<Analysis> = (async () => {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          screenshot: filePreview,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Analysis failed");
      setAnalysis(data);
      setAnalysisStatus("done");
      return data as Analysis;
    })();

    const [scrapeResult, analyzeResult] = await Promise.allSettled([
      scrapePromise,
      analyzePromise,
    ]);

    if (scrapeResult.status === "rejected") {
      setErrors((p) => ({
        ...p,
        scrape: scrapeResult.reason?.message ?? "Scrape failed",
      }));
      setScrapeStatus("error");
    }
    if (analyzeResult.status === "rejected") {
      setErrors((p) => ({
        ...p,
        analysis: analyzeResult.reason?.message ?? "Analysis failed",
      }));
      setAnalysisStatus("error");
    }
  }

  const isRunning =
    scrapeStatus === "loading" || analysisStatus === "loading";
  const hasResults =
    scrapeStatus !== "idle" || analysisStatus !== "idle";
  const canSubmit = !!filePreview && !isRunning;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-16">
      <div className="w-full max-w-3xl mx-auto">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-3">
            UX Audit · v0.4
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-4">
            Audit any UI in under a minute.
          </h1>
          <p className="text-neutral-400 text-lg leading-relaxed">
            Drop a screenshot of any interface — live website, internal
            dashboard, Figma mockup, design export. A panel of AI specialists
            reviews it for visual hierarchy, microcopy, accessibility, mobile
            responsiveness, and conversion patterns — then hands you a
            prioritized report.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            className={`relative rounded-lg border-2 border-dashed cursor-pointer transition ${
              dragging
                ? "border-neutral-300 bg-neutral-900"
                : "border-neutral-800 hover:border-neutral-700 bg-neutral-900/40"
            } ${filePreview ? "p-4" : "p-12"}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />

            {filePreview ? (
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={filePreview}
                  alt="Upload preview"
                  className="w-20 h-20 object-cover rounded border border-neutral-800 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-200 truncate">
                    {file?.name}
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    {file && `${(file.size / 1000).toFixed(0)} KB`}
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearFile();
                    }}
                    className="text-xs text-neutral-500 hover:text-neutral-200 mt-2 underline"
                  >
                    Replace
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-neutral-300 text-base">
                  Drop a screenshot here, or{" "}
                  <span className="underline">click to browse</span>
                </p>
                <p className="text-neutral-500 text-xs mt-2">
                  PNG, JPEG, or WebP · max 4.5 MB
                </p>
              </div>
            )}
          </div>

          {fileError && (
            <p className="text-xs text-red-400">{fileError}</p>
          )}

          <input
            type="url"
            placeholder="Page URL (optional — adds context to the analysis)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isRunning}
            className="w-full px-4 py-3 rounded-lg bg-neutral-900 border border-neutral-800 focus:border-neutral-600 focus:outline-none text-base disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full sm:w-auto px-6 py-3 rounded-lg bg-white text-neutral-950 font-medium hover:bg-neutral-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isRunning ? "Working…" : "Run audit"}
          </button>
        </form>

        {hasResults && (
          <section className="mt-10 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {scrapeStatus !== "idle" && (
                <StatusCard
                  label="Extracting content"
                  status={scrapeStatus}
                  error={errors.scrape}
                />
              )}
              <StatusCard
                label="Analyzing hierarchy"
                status={analysisStatus}
                error={errors.analysis}
              />
            </div>

            {analysis && <AnalysisCard analysis={analysis} />}

            {scrape && (
              <details className="rounded-lg border border-neutral-800 overflow-hidden">
                <summary className="px-4 py-2 bg-neutral-900 border-b border-neutral-800 text-xs text-neutral-400 uppercase tracking-wider cursor-pointer hover:text-neutral-200">
                  Scraped content · {scrape.markdown.length.toLocaleString()} chars · click to expand
                </summary>
                <div className="p-4 space-y-4">
                  {scrape.title && (
                    <div>
                      <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">
                        Title
                      </p>
                      <p className="text-neutral-100">{scrape.title}</p>
                    </div>
                  )}
                  {scrape.description && (
                    <div>
                      <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">
                        Description
                      </p>
                      <p className="text-neutral-300 text-sm">
                        {scrape.description}
                      </p>
                    </div>
                  )}
                  <pre className="text-xs text-neutral-400 bg-neutral-950 border border-neutral-800 rounded p-3 max-h-80 overflow-auto whitespace-pre-wrap font-mono">
                    {scrape.markdown.slice(0, 1500)}
                    {scrape.markdown.length > 1500 && "\n\n… (truncated)"}
                  </pre>
                </div>
              </details>
            )}
          </section>
        )}

        <footer className="mt-16 text-xs text-neutral-600">
          Built by Alex Born · Powered by Claude &amp; Firecrawl
        </footer>
      </div>
    </main>
  );
}

function StatusCard({
  label,
  status,
  error,
}: {
  label: string;
  status: Status;
  error?: string;
}) {
  const config: Record<Status, { color: string; icon: string; pulse: boolean }> = {
    idle: { color: "text-neutral-600", icon: "·", pulse: false },
    loading: { color: "text-amber-400", icon: "•", pulse: true },
    done: { color: "text-emerald-400", icon: "✓", pulse: false },
    error: { color: "text-red-400", icon: "✗", pulse: false },
  };
  const { color, icon, pulse } = config[status];

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-center gap-2">
        <span
          className={`text-base leading-none ${color} ${pulse ? "animate-pulse" : ""}`}
        >
          {icon}
        </span>
        <span className="text-sm text-neutral-200">{label}</span>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-400 break-words">{error}</p>
      )}
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: Analysis }) {
  return (
    <div className="rounded-lg border border-neutral-800 overflow-hidden">
      <div className="px-5 py-4 bg-neutral-900 border-b border-neutral-800 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-neutral-500 uppercase tracking-[0.15em] mb-1">
            Heuristic
          </p>
          <h2 className="text-lg text-neutral-100 font-medium">
            {analysis.heuristic_label}
          </h2>
        </div>
        <ScoreBadge score={analysis.score} />
      </div>
      <div className="p-5 space-y-5">
        <p className="text-neutral-200 text-base leading-relaxed">
          {analysis.summary}
        </p>
        <div className="space-y-3">
          {analysis.findings.map((f, i) => (
            <FindingCard key={i} finding={f} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tier =
    score >= 85
      ? { ring: "ring-emerald-500/40", text: "text-emerald-300" }
      : score >= 70
      ? { ring: "ring-green-500/40", text: "text-green-300" }
      : score >= 55
      ? { ring: "ring-amber-500/40", text: "text-amber-300" }
      : score >= 40
      ? { ring: "ring-orange-500/40", text: "text-orange-300" }
      : { ring: "ring-red-500/40", text: "text-red-300" };

  return (
    <div
      className={`shrink-0 w-16 h-16 rounded-full bg-neutral-950 ring-2 ${tier.ring} flex items-center justify-center`}
    >
      <span className={`text-2xl font-semibold ${tier.text} tabular-nums`}>
        {score}
      </span>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const severityStyle: Record<Severity, string> = {
    critical: "bg-red-500/10 text-red-300 border-red-900/60",
    major: "bg-amber-500/10 text-amber-300 border-amber-900/60",
    minor: "bg-neutral-800 text-neutral-300 border-neutral-700",
  };

  return (
    <div className="border border-neutral-800 rounded-lg p-4 space-y-3 bg-neutral-950">
      <div className="flex items-start gap-3 flex-wrap">
        <span
          className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] rounded border ${severityStyle[finding.severity]}`}
        >
          {finding.severity}
        </span>
        <h3 className="text-neutral-100 font-medium leading-snug flex-1 min-w-0">
          {finding.issue}
        </h3>
      </div>
      <div className="space-y-2 text-sm pl-1">
        <p className="text-neutral-400">
          <span className="text-neutral-500 text-xs uppercase tracking-wider mr-2">
            Evidence
          </span>
          {finding.evidence}
        </p>
        <p className="text-neutral-200">
          <span className="text-neutral-500 text-xs uppercase tracking-wider mr-2">
            Fix
          </span>
          {finding.recommendation}
        </p>
      </div>
    </div>
  );
}
