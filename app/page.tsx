"use client";

import { useState } from "react";

export default function Home() {
  const [url, setUrl] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitted(url.trim());
    // Real audit pipeline will be wired up in Session 2+.
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-3">
            UX Audit · v0.1
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
            className="flex-1 px-4 py-3 rounded-lg bg-neutral-900 border border-neutral-800 focus:border-neutral-600 focus:outline-none text-base"
          />
          <button
            type="submit"
            className="px-6 py-3 rounded-lg bg-white text-neutral-950 font-medium hover:bg-neutral-200 transition"
          >
            Run audit
          </button>
        </form>

        {submitted && (
          <div className="mt-8 p-4 rounded-lg bg-neutral-900 border border-neutral-800">
            <p className="text-sm text-neutral-400 mb-1">
              Pipeline not connected yet — placeholder only.
            </p>
            <p className="text-neutral-200 break-all">
              Would audit:{" "}
              <span className="font-mono text-sm">{submitted}</span>
            </p>
          </div>
        )}

        <footer className="mt-16 text-xs text-neutral-600">
          Built by Alex Born · Powered by Claude, Firecrawl, ScreenshotOne
        </footer>
      </div>
    </main>
  );
}
