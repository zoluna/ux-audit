// POST /api/screenshot
// Body: { url: string }
// Returns: { image: "data:image/png;base64,..." }
//
// Calls ScreenshotOne server-side so the access key never reaches the browser.
// Returns the PNG as a base64 data URL — easy to render in <img> and easy to
// hand off to Claude vision later.

export const runtime = "nodejs";
export const maxDuration = 26;

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return Response.json({ error: "Missing or invalid url" }, { status: 400 });
    }

    const accessKey = process.env.SCREENSHOTONE_ACCESS_KEY;
    if (!accessKey) {
      return Response.json(
        { error: "Server misconfigured: SCREENSHOTONE_ACCESS_KEY missing" },
        { status: 500 }
      );
    }

    const params = new URLSearchParams({
      access_key: accessKey,
      url,
      viewport_width: "1280",
      viewport_height: "800",
      device_scale_factor: "1",
      format: "png",
      full_page: "true",
      full_page_max_height: "6000",
      full_page_scroll: "true",
      block_ads: "true",
      block_cookie_banners: "true",
      block_chats: "true",
      cache: "true",
      cache_ttl: "86400",
      timeout: "20",
    });

    const apiUrl = `https://api.screenshotone.com/take?${params.toString()}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      const detail = await response.text();
      return Response.json(
        {
          error: `Screenshot service returned ${response.status}`,
          detail: detail.slice(0, 300),
        },
        { status: response.status }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return Response.json({
      image: `data:image/png;base64,${base64}`,
      bytes: arrayBuffer.byteLength,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
