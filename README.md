# UX Audit

AI-powered UX audit tool. Paste a URL, get a graded report across visual
hierarchy, microcopy, accessibility, mobile responsiveness, and conversion
patterns.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Netlify (hosting + serverless functions)
- Anthropic Claude (vision + reasoning)
- ScreenshotOne (page screenshots)
- Firecrawl (page content extraction)

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in API keys
npm run dev
```

Visit http://localhost:3000

## Sanity check

Once deployed with env vars set, visit `/api/health` — should return
`{ anthropic: true, screenshotone: true, firecrawl: true }`.
