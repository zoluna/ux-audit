// Sanity-check endpoint: confirms env vars are wired up without leaking them.
// Visit /api/health on your deployed site after adding env vars in Netlify.

export async function GET() {
  return Response.json({
    anthropic_len: process.env.ANTHROPIC_API_KEY?.length ?? 0,
    screenshotone_len: process.env.SCREENSHOTONE_ACCESS_KEY?.length ?? 0,
    firecrawl_len: process.env.FIRECRAWL_API_KEY?.length ?? 0,
    timestamp: new Date().toISOString(),
  });
}
