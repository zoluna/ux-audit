// POST /api/analyze
// Body: { url, screenshot (data URL), markdown, title, description }
// Returns: { heuristic, score, summary, findings, usage }
//
// Single-heuristic analysis (visual hierarchy) using Claude vision.
// Becomes the template for the multi-agent expansion in Session 4.

import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 26;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type Severity = "critical" | "major" | "minor";

type Finding = {
  severity: Severity;
  issue: string;
  evidence: string;
  recommendation: string;
};

type Analysis = {
  score: number;
  summary: string;
  findings: Finding[];
};

const SYSTEM_PROMPT = `You are a senior UX designer with 12+ years of experience auditing web interfaces. You give critique that is sharp, specific, and actionable — never generic. You ground every finding in something concretely visible in the screenshot or content provided.`;

function buildUserPrompt(args: {
  url: string;
  title: string;
  description: string;
  markdown: string;
}): string {
  const truncated = args.markdown.slice(0, 6000);

  return `Analyze the provided website for **VISUAL HIERARCHY** specifically. Evaluate:

- Whether the most important element on the page (typically the primary value proposition or hero CTA) is visually dominant
- Whether secondary and tertiary content recedes appropriately
- Whether spacing creates clear, scannable groupings
- Whether typography weight, size, and color establish an unambiguous reading order
- Whether the primary call-to-action is unmistakable

Context:
- URL: ${args.url || "(uploaded screenshot, no URL provided)"}
- Page title: ${args.title || "(none provided)"}
- Page description: ${args.description || "(none provided)"}

Page content excerpt (markdown):
${truncated || "(no extracted content)"}

Return your analysis as a JSON object with this exact shape:

{
  "score": <integer 0-100, where 100 is exemplary>,
  "summary": "<one-sentence overall assessment>",
  "findings": [
    {
      "severity": "critical" | "major" | "minor",
      "issue": "<short title, max 10 words>",
      "evidence": "<specific reference to what you observe in the screenshot>",
      "recommendation": "<concrete actionable fix in 1-2 sentences>"
    }
  ]
}

Rules:
- Return ONLY the JSON. No preamble, no markdown code fences, no explanation.
- Aim for 3-6 findings, ordered by severity (critical first).
- Every finding must reference something specific you can see, not generic UX advice.
- "critical" = breaks the page's primary purpose. "major" = noticeably degrades the experience. "minor" = polish.`;
}

function parseAnalysis(raw: string): Analysis {
  // Try direct parse first.
  try {
    return JSON.parse(raw) as Analysis;
  } catch {
    // Fall back: extract from a JSON code block.
    const fenced = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenced) return JSON.parse(fenced[1]) as Analysis;

    // Last resort: grab the first {...} blob.
    const loose = raw.match(/\{[\s\S]*\}/);
    if (loose) return JSON.parse(loose[0]) as Analysis;

    throw new Error("Could not parse analysis JSON from model response");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url = "", screenshot, markdown = "", title = "", description = "" } = body;

    if (!screenshot) {
      return Response.json(
        { error: "Missing required field: screenshot" },
        { status: 400 }
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: "Server misconfigured: ANTHROPIC_API_KEY missing" },
        { status: 500 }
      );
    }

    // Strip the "data:image/png;base64," prefix.
    const match = (screenshot as string).match(
      /^data:image\/(png|jpeg|webp);base64,(.+)$/
    );
    if (!match) {
      return Response.json(
        { error: "Invalid screenshot format — expected base64 data URL" },
        { status: 400 }
      );
    }
    const mediaType = `image/${match[1]}` as "image/png" | "image/jpeg" | "image/webp";
    const base64Data = match[2];

    const userPrompt = buildUserPrompt({ url, title, description, markdown });

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((c) => c.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";

    let analysis: Analysis;
    try {
      analysis = parseAnalysis(rawText);
    } catch (e) {
      return Response.json(
        {
          error: e instanceof Error ? e.message : "Parse failed",
          raw: rawText.slice(0, 500),
        },
        { status: 502 }
      );
    }

    return Response.json({
      heuristic: "visual_hierarchy",
      heuristic_label: "Visual Hierarchy",
      ...analysis,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
