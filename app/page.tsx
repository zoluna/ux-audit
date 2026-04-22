"use client";

import { useState } from "react";

type ScrapeResult = {
  markdown: string;
  title: string;
  description: string;
};

type Status = "idle" | "loading" | "done" | "error";

export default function Home() {
  const [url, setUrl] = useState("");
  const [screenshotStatus, setScreenshotStatus] = useState<Status>("idle");
  const [scrapeStatus, setScrapeStatus] = useState<Status>("idle");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [scrape, setScrape] = useState<ScrapeResult | null>(null);
  const [errors, setErrors] = useState<{ screenshot?: string; scrape?: string }>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setScreenshot(null);
    setScrape(null);
    setErrors({});
    setScreenshotStatus("loading");
    setScrapeStatus("loading");

    const screenshotPromise = fetch("/api/screenshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Screenshot failed");
        setScreenshot(data.image);
        setScreenshotStatus("done");
      })
      .catch((e) => {
        setErrors((prev) => ({ ...prev, screenshot: e.message }));
        setScreenshotStatus("error");
      });

    const scrapePromise = fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Scrape failed");
        setScrape(data);
        setScrapeStatus("done");
      })
      .catch((e) => {
        setErrors((prev) => ({ ...prev, scrape: e.message }));
        setScrapeStatus("error");
      });

    await Promise.all([screenshotPromise, scrapePromise]);
  }

  const isRunning = screenshotStatus === "loading" || scrapeStatus === "loading";
  const hasResults = screenshotStatus !== "idle" || scrapeStatus !== "idle";

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-16">
      <div className="w-full max-w-3xl mx-auto">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-3">
            UX Audit · v0.2
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-4">
            Audit any website&apos;s UX in under a minute.
          </h1>
          <p className="text-neutral-400 text-lg leading-relaxed">
            Paste a URL. A panel of AI specialists reviews it for visual
            hierarchy, microcopy, accessibility, mobile responsiveness, and
            conversion patterns — then hands you a prioritized report.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row gap-3"
        >
          <input
            type="url"
            required
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isRunning}
            className="flex-1 px-4 py-3 rounded-lg bg-neutral-900 border border-neutral-800 focus:border-neutral-600 focus:outline-none text-base disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isRunning}
            className="px-6 py-3 rounded-lg bg-white text-neutral-950 font-medium hover:bg-neutral-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? "Working…" : "Run audit"}
          </button>
        </form>

        {hasResults && (
          <section className="mt-10 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatusCard
                label="Capturing screenshot"
                status={screenshotStatus}
                error={errors.screenshot}
              />
              <StatusCard
                label="Extracting page content"
                status={scrapeStatus}
                error={errors.scrape}
              />
            </div>

            {screenshot && (
              <div className="rounded-lg overflow-hidden border border-neutral-800">
                <div className="px-4 py-2 bg-neutral-900 border-b border-neutral-800 text-xs text-neutral-400 uppercase tracking-wider">
                  Screenshot · 1280×800
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshot}
                  alt="Page screenshot"
                  className="w-full block"
                />
              </div>
            )}

            {scrape && (
              <div className="rounded-lg border border-neutral-800 overflow-hidden">
                <div className="px-4 py-2 bg-neutral-900 border-b border-neutral-800 text-xs text-neutral-400 uppercase tracking-wider">
                  Scraped content
                </div>
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
                  <div>
                    <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">
                      Markdown preview · {scrape.markdown.length.toLocaleString()} chars
                    </p>
                    <pre className="text-xs text-neutral-400 bg-neutral-950 border border-neutral-800 rounded p-3 max-h-80 overflow-auto whitespace-pre-wrap font-mono">
                      {scrape.markdown.slice(0, 1500)}
                      {scrape.markdown.length > 1500 && "\n\n… (truncated for preview)"}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        <footer className="mt-16 text-xs text-neutral-600">
          Built by Alex Born · Powered by Claude, Firecrawl, ScreenshotOne
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
    idle: { color: "text-neutral-500", icon: "·", pulse: false },
    loading: { color: "text-amber-400", icon: "•", pulse: true },
    done: { color: "text-emerald-400", icon: "✓", pulse: false },
    error: { color: "text-red-400", icon: "✗", pulse: false },
  };
  const { color, icon, pulse } = config[status];

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center gap-2">
        <span
          className={`text-lg leading-none ${color} ${pulse ? "animate-pulse" : ""}`}
        >
          {icon}
        </span>
        <span className="text-sm text-neutral-200">{label}</span>
      </div>
      {error && <p className="mt-2 text-xs text-red-400 break-words">{error}</p>}
    </div>
  );
}
