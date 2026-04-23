"use client";

import { useEffect, useRef, useState } from "react";

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

type Pointer = {
  x: number;
  y: number;
};

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
  mobile_responsiveness: "Mobile Systems",
  conversion: "Conversion Flow",
};

const HEURISTIC_BLURBS: Record<Heuristic, string> = {
  visual_hierarchy: "How clearly the interface guides attention.",
  microcopy: "Whether the words are clear, sharp, and useful.",
  accessibility: "Contrast, semantics, and cognitive inclusivity risks.",
  mobile_responsiveness: "How well the layout should hold on smaller screens.",
  conversion: "Friction, trust, and CTA effectiveness.",
};

const MAX_FILE_BYTES = 4_500_000;
const MAX_IMAGE_DIMENSION = 7800;

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

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [url, setUrl] = useState("");
  const [pointer, setPointer] = useState<Pointer>({ x: 48, y: 18 });

  const [scrapeStatus, setScrapeStatus] = useState<Status>("idle");
  const [scrape, setScrape] = useState<ScrapeResult | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const [agents, setAgents] = useState<Record<Heuristic, AgentState>>(initialAgents());

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const x = (event.clientX / window.innerWidth) * 100;
      const y = (event.clientY / window.innerHeight) * 100;
      setPointer({ x, y });
    };

    window.addEventListener("pointermove", handleMove);
    return () => window.removeEventListener("pointermove", handleMove);
  }, []);

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
    setScrapeError(null);
    setScrapeStatus(trimmedUrl ? "loading" : "idle");
    setAgents(() => {
      const next = initialAgents();
      HEURISTICS_ORDER.forEach((h) => {
        next[h] = { status: "loading", analysis: null, error: null };
      });
      return next;
    });

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

  const completedCount = HEURISTICS_ORDER.filter((h) => agents[h].status === "done").length;

  return (
    <main
      className="relative min-h-screen overflow-hidden"
      style={
        {
          ["--pointer-x" as string]: `${pointer.x}%`,
          ["--pointer-y" as string]: `${pointer.y}%`,
        } as React.CSSProperties
      }
    >
      <div className="hero-glow" />
      <div className="noise-overlay" />
      <div className="ambient-grid absolute inset-0 opacity-40" />

      <div className="floating-orb left-[8%] top-[12%] h-40 w-40 bg-[#521684]/30" />
      <div className="floating-orb right-[10%] top-[18%] h-56 w-56 bg-[#b165ea]/24" />
      <div className="floating-orb bottom-[14%] left-[28%] h-44 w-44 bg-[#d69dfb]/18" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <section className="glass-panel relative overflow-hidden rounded-[30px] px-6 py-8 sm:px-8 sm:py-10 lg:px-10">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),transparent_35%,transparent_65%,rgba(255,255,255,0.04))]" />
          <div className="relative">
            <header className="mb-10 flex flex-col gap-8 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-5 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-[#d8b1ff]">
                  Parallel UX Audit
                  <span className="h-1 w-1 rounded-full bg-[#f6e5ff]" />
                  Portfolio Edition
                </div>
                <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.05em] text-white sm:text-6xl xl:text-7xl">
                  Turn one interface screenshot into a cinematic, multi-agent UX teardown.
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-8 text-[#d6c2f0] sm:text-lg">
                  Upload a product screen, add a URL if you want richer context, and let five
                  specialized reviewers audit hierarchy, copy, accessibility, mobile readiness,
                  and conversion friction in parallel.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:w-[420px]">
                <StatPill label="Agents" value="05" detail="running in parallel" />
                <StatPill label="Signals" value="100" detail="weighted score" />
                <StatPill
                  label="Context"
                  value={url.trim() ? "URL+" : "IMG"}
                  detail={url.trim() ? "screenshot + scrape" : "screenshot only"}
                />
              </div>
            </header>

            <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
              <aside className="xl:sticky xl:top-6 xl:self-start">
                <form
                  onSubmit={handleSubmit}
                  className="glass-panel rounded-[28px] p-5 sm:p-6"
                >
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-[#bb8df0]">
                        Control Deck
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                        Stage the audit
                      </h2>
                    </div>
                    <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[#f5d8ff]">
                      {isRunning ? "Live" : "Ready"}
                    </div>
                  </div>

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
                      if (f) void handleFile(f);
                    }}
                    className={`group relative cursor-pointer overflow-hidden rounded-[24px] border p-4 ${
                      dragging
                        ? "border-[#d7a7ff]/60 bg-white/10"
                        : "border-white/10 bg-white/[0.04] hover:border-[#c897ff]/40 hover:bg-white/[0.06]"
                    } ${filePreview ? "min-h-[260px]" : "min-h-[280px]"}`}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(213,168,255,0.18),transparent_45%)] opacity-80" />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleFile(f);
                      }}
                    />

                    {filePreview ? (
                      <div className="relative flex h-full flex-col gap-4">
                        <div className="overflow-hidden rounded-[18px] border border-white/10 bg-black/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={filePreview}
                            alt="Upload preview"
                            className="h-[220px] w-full object-cover object-top"
                          />
                        </div>
                        <div className="flex items-end justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-white">{file?.name}</p>
                            <p className="mt-1 text-xs text-[#caacfa]">
                              {file && `${(file.size / 1000).toFixed(0)} KB`} · ready for analysis
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearFile();
                            }}
                            className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white hover:bg-white/14"
                          >
                            Replace
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative flex h-full flex-col justify-between">
                        <div className="space-y-3">
                          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-xl text-white">
                            +
                          </div>
                          <div>
                            <p className="text-xl font-medium tracking-[-0.03em] text-white">
                              Drop a screenshot or click to browse
                            </p>
                            <p className="mt-2 max-w-sm text-sm leading-6 text-[#d0b4f3]">
                              Bring in a landing page, dashboard, checkout flow, internal tool, or
                              Figma frame. PNG, JPEG, and WebP are supported up to 4.5 MB.
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-[#edd7ff]">
                          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                            Portfolio-grade output
                          </span>
                          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                            Instant specialist review
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {fileError && <p className="mt-3 text-sm text-rose-300">{fileError}</p>}

                  <label className="mt-5 block">
                    <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-[#bb8df0]">
                      Optional URL
                    </span>
                    <input
                      type="url"
                      placeholder="https://example.com"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      disabled={isRunning}
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white outline-none placeholder:text-[#9f85c6] focus:border-[#cb99ff]/60 disabled:opacity-50"
                    />
                    <p className="mt-2 text-xs leading-5 text-[#a98dce]">
                      Add the live page if you want copy and structure context scraped alongside the
                      screenshot.
                    </p>
                  </label>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f4e8ff_0%,#d59eff_42%,#8f41dd_100%)] px-5 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-[#16051f] shadow-[0_18px_50px_rgba(162,91,232,0.35)] hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                  >
                    {isRunning ? "Agents are reviewing" : "Run full audit"}
                  </button>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <MiniMetric
                      label="Progress"
                      value={`${completedCount}/${HEURISTICS_ORDER.length}`}
                      detail={isRunning ? "specialists active" : "specialists waiting"}
                    />
                    <MiniMetric
                      label="Context mode"
                      value={scrapeStatus === "done" ? "Enriched" : "Visual"}
                      detail={
                        scrapeStatus === "done"
                          ? "screenshot plus page scrape"
                          : "analysis from screenshot"
                      }
                    />
                  </div>
                </form>
              </aside>

              <section className="space-y-6">
                <div className="glass-panel rounded-[28px] p-6 sm:p-7">
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-2xl">
                      <p className="text-xs uppercase tracking-[0.22em] text-[#bb8df0]">
                        Audit Console
                      </p>
                      <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
                        Multi-agent results, scored and organized.
                      </h2>
                      <p className="mt-3 text-sm leading-6 text-[#ceb5f3]">
                        Each specialist returns a summary, a numeric score, and concrete fixes. Use
                        the scoreboard to jump between findings and scan the overall health of the
                        interface.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <StatusChip
                        label="Scrape"
                        value={
                          scrapeStatus === "loading"
                            ? "Fetching"
                            : scrapeStatus === "done"
                            ? "Attached"
                            : scrapeStatus === "error"
                            ? "Failed"
                            : "Skipped"
                        }
                      />
                      <StatusChip
                        label="Overall"
                        value={overallScore !== null ? `${overallScore}/100` : "Pending"}
                      />
                      <StatusChip
                        label="State"
                        value={isRunning ? "In Flight" : hasResults ? "Ready" : "Waiting"}
                      />
                    </div>
                  </div>
                </div>

                {hasResults ? (
                  <>
                    <Scorecard agents={agents} overall={overallScore} />

                    {scrapeStatus !== "idle" && (
                      <div className="glass-panel rounded-[22px] px-5 py-4 text-sm text-[#d7c0f7]">
                        {scrapeStatus === "loading" && "Fetching page context to strengthen the audit."}
                        {scrapeStatus === "done" &&
                          `Page context attached with ${scrape?.markdown.length.toLocaleString()} characters of scraped content.`}
                        {scrapeStatus === "error" &&
                          `Scrape failed (${scrapeError}). The specialists are still reviewing the screenshot alone.`}
                      </div>
                    )}

                    <div className="grid gap-5">
                      {HEURISTICS_ORDER.map((h) => (
                        <div key={h} id={`agent-${h}`}>
                          <AgentCard state={agents[h]} label={HEURISTIC_LABELS[h]} />
                        </div>
                      ))}
                    </div>

                    {scrape && (
                      <details className="glass-panel overflow-hidden rounded-[24px]">
                        <summary className="cursor-pointer px-5 py-4 text-sm uppercase tracking-[0.22em] text-[#d6b2ff] hover:text-white">
                          Inspect scraped context
                        </summary>
                        <div className="space-y-5 border-t border-white/10 px-5 py-5">
                          {scrape.title && (
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-[#b892ea]">
                                Title
                              </p>
                              <p className="mt-2 text-white">{scrape.title}</p>
                            </div>
                          )}
                          {scrape.description && (
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-[#b892ea]">
                                Description
                              </p>
                              <p className="mt-2 text-sm leading-6 text-[#d8c4f5]">
                                {scrape.description}
                              </p>
                            </div>
                          )}
                          <pre className="overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs leading-6 text-[#d5c8eb] whitespace-pre-wrap">
                            {scrape.markdown.slice(0, 1500)}
                            {scrape.markdown.length > 1500 && "\n\n... (truncated)"}
                          </pre>
                        </div>
                      </details>
                    )}
                  </>
                ) : (
                  <EmptyState />
                )}
              </section>
            </div>
          </div>
        </section>

        <footer className="px-2 pb-3 pt-5 text-center text-xs uppercase tracking-[0.24em] text-[#8f74b2]">
          Designed for Alex Born’s portfolio case study · AI orchestration by Claude
        </footer>
      </div>
    </main>
  );
}

function StatPill({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-[#af8ad9]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-white">{value}</p>
      <p className="mt-1 text-xs text-[#c7afe8]">{detail}</p>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-[#af8ad9]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-[#bfa5e2]">{detail}</p>
    </div>
  );
}

function StatusChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.22em] text-[#af8ad9]">{label}</p>
      <p className="mt-1 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="glass-panel rounded-[28px] p-6 sm:p-7">
        <p className="text-xs uppercase tracking-[0.22em] text-[#bb8df0]">What You’ll Get</p>
        <h3 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
          A dashboard that feels like an operating room for interface critique.
        </h3>
        <div className="mt-6 grid gap-4">
          {HEURISTICS_ORDER.map((heuristic, index) => (
            <div
              key={heuristic}
              className="rounded-[22px] border border-white/10 bg-black/20 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-[#af8ad9]">
                    Specialist {String(index + 1).padStart(2, "0")}
                  </p>
                  <h4 className="mt-2 text-lg font-medium text-white">
                    {HEURISTIC_LABELS[heuristic]}
                  </h4>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-[#cfb9ef]">
                    {HEURISTIC_BLURBS[heuristic]}
                  </p>
                </div>
                <div className="score-ring flex h-14 w-14 items-center justify-center rounded-full border border-white/10 text-sm font-semibold text-white">
                  --
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel rounded-[28px] p-6 sm:p-7">
        <p className="text-xs uppercase tracking-[0.22em] text-[#bb8df0]">Run Sequence</p>
        <div className="mt-5 space-y-4">
          <SequenceStep
            step="01"
            title="Upload a frame"
            body="Drop in a screenshot from a live product, prototype, or internal tool."
          />
          <SequenceStep
            step="02"
            title="Attach optional context"
            body="Provide a URL to enrich the review with scraped title, description, and copy."
          />
          <SequenceStep
            step="03"
            title="Launch the reviewers"
            body="Five specialist prompts fire in parallel and each returns its own critique."
          />
          <SequenceStep
            step="04"
            title="Prioritize fixes"
            body="Scan the scorecard, open findings, and turn the output into design actions."
          />
        </div>
      </div>
    </div>
  );
}

function SequenceStep({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-start gap-4">
        <div className="score-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 text-sm font-semibold text-white">
          {step}
        </div>
        <div>
          <h4 className="text-base font-medium text-white">{title}</h4>
          <p className="mt-2 text-sm leading-6 text-[#cfb9ef]">{body}</p>
        </div>
      </div>
    </div>
  );
}

function Scorecard({
  agents,
  overall,
}: {
  agents: Record<Heuristic, AgentState>;
  overall: number | null;
}) {
  return (
    <div className="glass-panel rounded-[28px] p-6 sm:p-7">
      <div className="flex flex-col gap-6 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[#bb8df0]">Overall score</p>
          <div className="mt-3 flex items-end gap-3">
            <span className="text-6xl font-semibold tracking-[-0.06em] text-white">
              {overall !== null ? overall : "--"}
            </span>
            <span className="pb-2 text-sm uppercase tracking-[0.18em] text-[#af8ad9]">
              out of 100
            </span>
          </div>
        </div>
        <p className="max-w-lg text-sm leading-6 text-[#cfb9ef]">
          Jump into any specialist review below. Scores are averaged from completed agents only,
          so the overall number sharpens as more responses arrive.
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {HEURISTICS_ORDER.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() =>
              document
                .getElementById(`agent-${h}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="rounded-[22px] border border-white/10 bg-black/20 p-4 text-left hover:border-[#cf9eff]/40 hover:bg-white/[0.05]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[#af8ad9]">
                  Specialist
                </p>
                <p className="mt-2 text-base font-medium text-white">{HEURISTIC_LABELS[h]}</p>
              </div>
              <ScoreDot state={agents[h]} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[#cfb9ef]">{HEURISTIC_BLURBS[h]}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ScoreDot({ state }: { state: AgentState }) {
  if (state.status === "loading") {
    return (
      <div className="score-ring flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-[#b586eb] text-xs uppercase tracking-[0.16em] text-[#e4cbff] animate-pulse">
        ...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="score-ring flex h-14 w-14 items-center justify-center rounded-full border border-rose-400/30 text-sm font-semibold text-rose-200">
        !
      </div>
    );
  }

  if (state.status === "done" && state.analysis) {
    const score = state.analysis.score;
    const tone =
      score >= 85
        ? "border-emerald-300/30 text-emerald-200"
        : score >= 70
        ? "border-lime-300/30 text-lime-200"
        : score >= 55
        ? "border-amber-300/30 text-amber-200"
        : score >= 40
        ? "border-orange-300/30 text-orange-200"
        : "border-rose-300/30 text-rose-200";

    return (
      <div
        className={`score-ring flex h-14 w-14 items-center justify-center rounded-full border text-base font-semibold ${tone}`}
      >
        {score}
      </div>
    );
  }

  return (
    <div className="score-ring flex h-14 w-14 items-center justify-center rounded-full border border-white/10 text-xs uppercase tracking-[0.16em] text-[#b599d7]">
      --
    </div>
  );
}

function AgentCard({ state, label }: { state: AgentState; label: string }) {
  if (state.status === "loading") {
    return (
      <div className="glass-panel rounded-[28px] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-[#bb8df0]">Specialist</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
              {label}
            </h2>
          </div>
          <div className="rounded-full border border-[#c99aff]/20 bg-[#a866e8]/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-[#f2dcff]">
            Reviewing
          </div>
        </div>
        <div className="mt-6 space-y-3">
          <div className="h-4 rounded-full bg-white/8 animate-pulse" />
          <div className="h-4 w-11/12 rounded-full bg-white/8 animate-pulse" />
          <div className="h-4 w-8/12 rounded-full bg-white/8 animate-pulse" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-[28px] border border-rose-400/20 bg-rose-950/20 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-rose-200/70">Specialist</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-rose-100">
              {label}
            </h2>
          </div>
          <div className="rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-rose-100">
            Failed
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-rose-100/90">{state.error}</p>
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
    <div className="glass-panel overflow-hidden rounded-[28px]">
      <div className="flex flex-col gap-5 border-b border-white/10 px-6 py-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.22em] text-[#bb8df0]">Specialist</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
            {analysis.heuristic_label}
          </h2>
          <p className="mt-3 text-sm leading-7 text-[#d2bbed]">{analysis.summary}</p>
        </div>
        <ScoreBadge score={analysis.score} />
      </div>
      <div className="grid gap-4 px-6 py-6">
        {analysis.findings.map((f, i) => (
          <FindingCard key={i} finding={f} />
        ))}
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "border-emerald-300/30 text-emerald-200"
      : score >= 70
      ? "border-lime-300/30 text-lime-200"
      : score >= 55
      ? "border-amber-300/30 text-amber-200"
      : score >= 40
      ? "border-orange-300/30 text-orange-200"
      : "border-rose-300/30 text-rose-200";

  return (
    <div
      className={`score-ring flex h-24 w-24 shrink-0 items-center justify-center rounded-full border text-3xl font-semibold ${tone}`}
    >
      {score}
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const severityStyle: Record<Severity, string> = {
    critical: "border-rose-300/18 bg-rose-500/10 text-rose-100",
    major: "border-amber-300/18 bg-amber-500/10 text-amber-50",
    minor: "border-white/10 bg-black/20 text-white",
  };

  return (
    <div className={`rounded-[24px] border p-5 ${severityStyle[finding.severity]}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="rounded-full border border-current/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]">
          {finding.severity}
        </span>
        <h3 className="flex-1 text-lg font-medium leading-7">{finding.issue}</h3>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[18px] border border-white/10 bg-black/20 p-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#ba97e2]">Evidence</p>
          <p className="mt-3 text-sm leading-6 text-[#dbc9ef]">{finding.evidence}</p>
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/20 p-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#ba97e2]">Recommended fix</p>
          <p className="mt-3 text-sm leading-6 text-[#f3ebff]">{finding.recommendation}</p>
        </div>
      </div>
    </div>
  );
}
