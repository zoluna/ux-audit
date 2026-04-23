// POST /api/analyze
// Body: { heuristic, url, screenshot, markdown, title, description }
// Returns: { heuristic, heuristic_label, score, summary, findings, usage }
//
// Dispatches the request to one of five specialist prompts based on `heuristic`.
// The client fires 5 of these in parallel — one per heuristic — so each gets
// its own Netlify Function timeout budget and results stream in independently.

import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 26;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ---------- Types ----------

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

type Heuristic =
  | "visual_hierarchy"
  | "microcopy"
  | "accessibility"
  | "mobile_responsiveness"
  | "conversion";

type Context = {
  url: string;
  title: string;
  description: string;
  markdown: string;
};

// ---------- Shared prompt components ----------

const JSON_SCHEMA_BLOCK = `Return your analysis as a JSON object with this exact shape:

{
  "score": <integer 0-100, where 100 is exemplary>,
  "summary": "<one-sentence overall assessment>",
  "findings": [
    {
      "severity": "critical" | "major" | "minor",
      "issue": "<short title, max 10 words>",
      "evidence": "<specific reference to what you observe>",
      "recommendation": "<concrete actionable fix in 1-2 sentences>"
    }
  ]
}

Rules:
- Return ONLY the JSON. No preamble, no markdown code fences, no explanation.
- Aim for 3-6 findings, ordered by severity (critical first).
- Every finding must reference something specific you can see or infer from the material, not generic UX advice.
- "critical" = breaks the interface's primary purpose. "major" = noticeably degrades the experience. "minor" = polish.`;

function buildContextBlock(ctx: Context): string {
  const truncated = ctx.markdown.slice(0, 6000);
  return `Context:
- URL: ${ctx.url || "(uploaded screenshot, no URL provided)"}
- Page title: ${ctx.title || "(none provided)"}
- Page description: ${ctx.description || "(none provided)"}

Page content excerpt (markdown):
${truncated || "(no extracted content)"}`;
}

// ---------- Heuristic configurations ----------

const HEURISTICS: Record<
  Heuristic,
  {
    label: string;
    systemPrompt: string;
    buildAnalysisPrompt: (ctx: Context) => string;
  }
> = {
  visual_hierarchy: {
    label: "Visual Hierarchy",
    systemPrompt:
      "You are a senior visual designer with 12+ years of experience auditing interface hierarchy. Your critique is sharp, specific, and grounded in what you actually observe in the image.",
    buildAnalysisPrompt: (ctx) => `Analyze the provided interface for VISUAL HIERARCHY:
- Whether the most important element (primary value proposition or hero CTA) is visually dominant
- Whether secondary and tertiary content recedes appropriately
- Whether whitespace creates clear, scannable groupings
- Whether typography weight, size, and color establish an unambiguous reading order
- Whether the primary call-to-action is unmistakable

${buildContextBlock(ctx)}

${JSON_SCHEMA_BLOCK}`,
  },

  microcopy: {
    label: "Microcopy & Clarity",
    systemPrompt:
      "You are a senior UX copywriter with a decade of experience sharpening product language. You spot jargon, empty phrases, vague CTAs, and unclear value propositions. Your critique is grounded in specific words you can see on the page.",
    buildAnalysisPrompt: (ctx) => `Analyze the provided interface for MICROCOPY & CLARITY:
- Whether the primary value proposition is understandable in under 5 seconds
- Whether headlines are scannable and written in active voice
- Whether button and CTA labels are specific and action-oriented (flag generic "Learn more" or "Submit")
- Whether form labels, helper text, and any visible error states are clear
- Whether tone is consistent and free of jargon, empty buzzwords, and hedging

${buildContextBlock(ctx)}

${JSON_SCHEMA_BLOCK}`,
  },

  accessibility: {
    label: "Accessibility",
    systemPrompt:
      "You are a senior accessibility specialist with deep knowledge of WCAG 2.2 and inclusive design. You assess interfaces for barriers that exclude users with visual, motor, cognitive, or situational impairments. You ground every finding in something specific you can see.",
    buildAnalysisPrompt: (ctx) => `Analyze the provided interface for ACCESSIBILITY issues:
- Color contrast of body text, headings, and interactive elements against their backgrounds (reference WCAG AA: 4.5:1 for body text, 3:1 for large text and UI components)
- Text legibility (size, weight, line height)
- Apparent hit target sizes for buttons and interactive elements (reference 44×44px minimum)
- Reliance on color alone to convey meaning or state
- Icon-only buttons without visible labels
- Semantic structure implied by the visual layout (clear landmarks, heading hierarchy)

${buildContextBlock(ctx)}

${JSON_SCHEMA_BLOCK}`,
  },

  mobile_responsiveness: {
    label: "Mobile Responsiveness",
    systemPrompt:
      "You are a senior mobile UX designer with deep experience shipping responsive web products. You assess whether a desktop design will translate cleanly to a mobile viewport, anticipating layout breaks, touch friction, and performance issues.",
    buildAnalysisPrompt: (ctx) => `Analyze the provided interface for MOBILE RESPONSIVENESS risks. You're viewing a desktop layout; infer how this design is likely to behave on a 375px-wide mobile viewport:
- Will multi-column layouts collapse sensibly?
- Are tap targets likely to meet 44×44px at mobile scale?
- Will text remain legible when scaled for small screens?
- Will sticky headers, modals, or side panels create friction on a phone?
- Will the primary CTA remain accessible above the fold on mobile?
- Are image- or video-heavy elements likely to be performance-painful on mobile?

${buildContextBlock(ctx)}

${JSON_SCHEMA_BLOCK}`,
  },

  conversion: {
    label: "Conversion Patterns",
    systemPrompt:
      "You are a senior conversion rate optimization specialist. You audit landing pages and product interfaces for friction, weak CTAs, missing trust signals, and patterns that hurt or help conversion. You are specific and grounded, and you call out dark patterns rather than endorse them.",
    buildAnalysisPrompt: (ctx) => `Analyze the provided interface for CONVERSION PATTERN issues:
- Is the primary desired action unmistakable and specific (flag a generic "Get started" for an unclear offer)?
- Are trust signals present where they matter (testimonials, customer logos, security badges, third-party validation)?
- What sources of friction exist (required fields, forced signups, unclear next step, intrusive modals)?
- Is social proof leveraged authentically (specific quotes and names vs. generic praise)?
- Are urgency or scarcity cues, if present, honest and not manipulative dark patterns?

${buildContextBlock(ctx)}

${JSON_SCHEMA_BLOCK}`,
  },
};

// ---------- Parsing ----------

function parseAnalysis(raw: string): Analysis {
  try {
    return JSON.parse(raw) as Analysis;
  } catch {
    const fenced = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenced) return JSON.parse(fenced[1]) as Analysis;
    const loose = raw.match(/\{[\s\S]*\}/);
    if (loose) return JSON.parse(loose[0]) as Analysis;
    throw new Error("Could not parse analysis JSON from model response");
  }
}

// ---------- Handler ----------

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      heuristic = "visual_hierarchy",
      url = "",
      screenshot,
      markdown = "",
      title = "",
      description = "",
    } = body;

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

    const config = HEURISTICS[heuristic as Heuristic];
    if (!config) {
      return Response.json(
        { error: `Unknown heuristic: ${heuristic}` },
        { status: 400 }
      );
    }

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

    const userPrompt = config.buildAnalysisPrompt({ url, title, description, markdown });

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: config.systemPrompt,
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
      heuristic,
      heuristic_label: config.label,
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
