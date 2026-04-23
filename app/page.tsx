"use client";

import { useRef, useState } from "react";

// ---------- Types ----------

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

type Heuristic =
  | "visual_hierarchy"
  | "microcopy"
  | "accessibility"
  | "mobile_responsiveness"
  | "conversion";

type AgentState = {
  status: Status;
  analysis: Analysis | null;
  error: string | null;
};

// ---------- Constants ----------

const HEURISTICS_ORDER: Heuristic[] = [
  "visual_hierarchy",
  "microcopy",
  "accessibility",
  "mobile_responsiveness",
  "conversion",
];

const HEURISTIC_LABELS: Record<Heuristic, string> = {
  visual_hierarchy: "Visual Hierarchy",
  microcopy: "Microcopy",
  accessibility: "Accessibility",
  mobile_responsiveness: "Mobile",
  conversion: "Conversion",
};

const MAX_FILE_BYTES = 4_500_000;
const MAX_IMAGE_DIMENSION = 7800;

// ---------- Helpers ----------

function initialAgents(): Record<Heuristic, AgentState> {
  const entries = HEURISTICS_ORDER.map(
    (h): [Heuristic, AgentState] => [h, { status: "idle", analysis: null, error: null }]
  );
  return Object.fromEntries(entries) as Record<Heuristic, AgentState>;
}

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

// ---------- Page ----------

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [url, setUrl] = useState("");

  const [scrapeStatus, setScrapeStatus] = useState<Status>("idle");
  const [scrape, setScrape] = useState<ScrapeResult | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const [agents, setAgents] = useState<Record<Heuristic, AgentState>>(initialAgents());

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

    // Reset everything.
    setScrape(null);
    setScrapeError(null);
    setScrapeStatus(trimmedUrl ? "loading" : "idle");
    setAgents(() => {
      const next = initialAgents();
      HEURISTICS_ORDER.forEach((h) => {
        next[h] = { status: "loading", analysis: null, error: null };
      });
      return next;
    });

    // Step 1: scrape for context if a URL was provided. Agents still run if this fails.
    let scrapeData: ScrapeResult | null = null;
    if (trimmedUrl) {
      try {
        const r = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmedUrl }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Scrape failed");
        scrapeData = d as ScrapeResult;
        setScrape(scrapeData);
        setScrapeStatus("done");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Scrape failed";
        setScrapeError(message);
        setScrapeStatus("error");
      }
    }

    // Step 2: fire all 5 specialist agents in parallel. Each updates its own state.
    HEURISTICS_ORDER.forEach((heuristic) => {
      fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heuristic,
          url: trimmedUrl,
          screenshot: filePreview,
          markdown: scrapeData?.markdown ?? "",
          title: scrapeData?.title ?? "",
          description: scrapeData?.description ?? "",
        }),
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error ?? "Analysis failed");
          setAgents((prev) => ({
            ...prev,
            [heuristic]: { status: "done", analysis: data as Analysis, error: null },
          }));
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : "Failed";
          setAgents((prev) => ({
            ...prev,
            [heuristic]: { status: "error", analysis: null, error: message },
          }));
        });
    });
  }

  const anyAgentLoading = HEURISTICS_ORDER.some((h) => agents[h].status === "loading");
  const isRunning = anyAgentLoading || scrapeStatus === "loading";
  const hasResults = HEURISTICS_ORDER.some((h) => agents[h].status !== "idle");
  const canSubmit = !!filePreview && !isRunning;

  const completedScores = HEURISTICS_ORDER
    .map((h) => agents[h].analysis?.score)
    .filter((s): s is number => typeof s === "number");
  const overallScore =
    completedScores.length > 0
      ? Math.round(completedScores.reduce((a, b) => a + b, 0) / completedScores.length)
      : null;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-16">
      <div className="w-full max-w-3xl mx-auto">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-3">
            UX Audit · v0.5
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-4">
            Five specialists. One screenshot. One minute.
          </h1>
          <p className="text-neutral-400 text-lg leading-relaxed">
            Drop a screenshot of any interface — live website, internal
            dashboard, Figma mockup. Five AI specialists review it in parallel
            for visual hierarchy, microcopy, accessibility, mobile readiness,
            and conversion patterns.
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
                  <p className="text-sm text-neutral-200 truncate">{file?.name}</p>
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

          {fileError && <p className="text-xs text-red-400">{fileError}</p>}

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
            {isRunning ? "Specialists reviewing…" : "Run audit"}
          </button>
        </form>

        {hasResults && (
          <section className="mt-10 space-y-6">
            <Scorecard agents={agents} overall={overallScore} />

            {scrapeStatus !== "idle" && (
              <div className="text-xs text-neutral-500 flex items-center gap-2">
                <span>
                  Context:{" "}
                  {scrapeStatus === "loading" && "fetching page content…"}
                  {scrapeStatus === "done" && `fetched ${scrape?.markdown.length.toLocaleString()} chars`}
                  {scrapeStatus === "error" && (
                    <span className="text-amber-400">
                      scrape failed ({scrapeError}) — agents running on screenshot alone
                    </span>
                  )}
                </span>
              </div>
            )}

            <div className="space-y-4">
              {HEURISTICS_ORDER.map((h) => (
                <div key={h} id={`agent-${h}`}>
                  <AgentCard state={agents[h]} label={HEURISTIC_LABELS[h]} />
                </div>
              ))}
            </div>

            {scrape && (
              <details className="rounded-lg border border-neutral-800 overflow-hidden">
                <summary className="px-4 py-2 bg-neutral-900 border-b border-neutral-800 text-xs text-neutral-400 uppercase tracking-wider cursor-pointer hover:text-neutral-200">
                  Scraped content · click to expand
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
                      <p className="text-neutral-300 text-sm">{scrape.description}</p>
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

// ---------- Components ----------

function Scorecard({
  agents,
  overall,
}: {
  agents: Record<Heuristic, AgentState>;
  overall: number | null;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <p className="text-xs text-neutral-500 uppercase tracking-[0.15em]">
          Overall
        </p>
        <div className="flex items-center gap-3">
          <span className="text-3xl font-semibold tabular-nums text-neutral-100">
            {overall !== null ? overall : "—"}
          </span>
          <span className="text-xs text-neutral-500">/ 100</span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {HEURISTICS_ORDER.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() =>
              document
                .getElementById(`agent-${h}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="flex flex-col items-center gap-1 py-2 rounded hover:bg-neutral-800/50 transition"
          >
            <ScoreDot state={agents[h]} />
            <span className="text-[10px] text-neutral-400 uppercase tracking-wider text-center">
              {HEURISTIC_LABELS[h]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ScoreDot({ state }: { state: AgentState }) {
  if (state.status === "loading") {
    return (
      <div className="w-12 h-12 rounded-full border-2 border-dashed border-neutral-700 animate-pulse" />
    );
  }
  if (state.status === "error") {
    return (
      <div className="w-12 h-12 rounded-full bg-neutral-950 ring-2 ring-red-500/40 flex items-center justify-center">
        <span className="text-red-300 text-lg">!</span>
      </div>
    );
  }
  if (state.status === "done" && state.analysis) {
    const score = state.analysis.score;
    const tier =
      score >= 85
        ? { ring: "ring-emerald-500/50", text: "text-emerald-300" }
        : score >= 70
        ? { ring: "ring-green-500/50", text: "text-green-300" }
        : score >= 55
        ? { ring: "ring-amber-500/50", text: "text-amber-300" }
        : score >= 40
        ? { ring: "ring-orange-500/50", text: "text-orange-300" }
        : { ring: "ring-red-500/50", text: "text-red-300" };
    return (
      <div
        className={`w-12 h-12 rounded-full bg-neutral-950 ring-2 ${tier.ring} flex items-center justify-center`}
      >
        <span className={`text-base font-semibold ${tier.text} tabular-nums`}>
          {score}
        </span>
      </div>
    );
  }
  return <div className="w-12 h-12 rounded-full border-2 border-neutral-800" />;
}

function AgentCard({ state, label }: { state: AgentState; label: string }) {
  if (state.status === "loading") {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-[0.15em] mb-1">
              Specialist
            </p>
            <h2 className="text-lg text-neutral-100 font-medium">{label}</h2>
          </div>
          <span className="text-xs text-amber-400 animate-pulse">Reviewing…</span>
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-3 bg-neutral-800 rounded animate-pulse" />
          <div className="h-3 bg-neutral-800 rounded animate-pulse w-5/6" />
          <div className="h-3 bg-neutral-800 rounded animate-pulse w-4/6" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-5">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h2 className="text-lg text-red-200 font-medium">{label}</h2>
          <span className="text-xs text-red-300">Failed</span>
        </div>
        <p className="text-xs text-red-300 break-words">{state.error}</p>
      </div>
    );
  }

  if (state.status === "done" && state.analysis) {
    return <AnalysisCard analysis={state.analysis} />;
  }

  return null;
}

function AnalysisCard({ analysis }: { analysis: Analysis }) {
  return (
    <div className="rounded-lg border border-neutral-800 overflow-hidden">
      <div className="px-5 py-4 bg-neutral-900 border-b border-neutral-800 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-neutral-500 uppercase tracking-[0.15em] mb-1">
            Specialist
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
