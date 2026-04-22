// Sanity-check endpoint: confirms env vars are wired up without leaking them.
// Visit /api/health on your deployed site after adding env vars in Netlify.

export async function GET() {
  const status = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    screenshotone: Boolean(process.env.SCREENSHOTONE_ACCESS_KEY),
    firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
    timestamp: new Date().toISOString(),
  };

  return Response.json(status);
}
