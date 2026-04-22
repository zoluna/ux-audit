// POST /api/scrape
// Body: { url: string }
// Returns: { markdown, title, description }
//
// Calls Firecrawl v1 scrape endpoint. We request `markdown` only and set
// onlyMainContent=true to strip nav/footer noise — gives Claude cleaner input.

export const runtime = "nodejs";
export const maxDuration = 26;

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return Response.json({ error: "Missing or invalid url" }, { status: 400 });
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Server misconfigured: FIRECRAWL_API_KEY missing" },
        { status: 500 }
      );
    }

    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 20000,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return Response.json(
        {
          error: `Scrape service returned ${response.status}`,
          detail: detail.slice(0, 300),
        },
        { status: response.status }
      );
    }

    const json = await response.json();
    const data = json?.data ?? {};

    return Response.json({
      markdown: data.markdown ?? "",
      title: data.metadata?.title ?? "",
      description: data.metadata?.description ?? "",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
