// ABOUTME: Prompt and response parsing for animate suggestions, shared by the extension and the eval harness.
// ABOUTME: Kept tiny and constrained so small local models can follow it.

import { OFFERS, OFFER_BY_ID, type OfferId } from "./offers";

export interface ElementDescription {
  tag: string;
  role?: string;
  /** alt text, aria-label or title, whichever exists. */
  label?: string;
  /** Visible text, trimmed to a couple hundred characters. */
  text?: string;
  /** Image file name, if it is or contains an image. */
  imageName?: string;
  width: number;
  height: number;
  isLink: boolean;
  isButton: boolean;
  pageTitle: string;
  host: string;
}

export interface Suggestion {
  offer: OfferId;
  line: string;
}

export interface SuggestionResult {
  thing: string;
  suggestions: Suggestion[];
}

export const SYSTEM_PROMPT = [
  "You help make a web page feel shared by everyone visiting it.",
  "You see one element from a page: a picture of it and a short description.",
  "Suggest 2 or 3 ways everyone visiting could play with it together, based on what it is or what it looks like.",
  "Only pick from this list:",
  ...OFFERS.map((o) => `- ${o.id}: ${o.does}. Fits ${o.fits}.`),
  "",
  'Answer with JSON only: {"thing": "<what it is, 2-4 words>", "suggestions": [{"offer": "<id from the list>", "line": "<what everyone can do with this specific thing, under 12 words>"}]}',
  "Order suggestions from best fit to worst. Never repeat an id.",
].join("\n");

export function describeForPrompt(d: ElementDescription): string {
  const parts = [
    `Page: "${d.pageTitle}" on ${d.host}`,
    `Element: <${d.tag.toLowerCase()}>${d.role ? ` role=${d.role}` : ""}, ${Math.round(d.width)}x${Math.round(d.height)}px`,
  ];
  if (d.isButton) parts.push("It is a button.");
  if (d.isLink) parts.push("It is a link.");
  if (d.label) parts.push(`Label: "${d.label}"`);
  if (d.imageName) parts.push(`Image file: ${d.imageName}`);
  if (d.text) parts.push(`Text: "${d.text}"`);
  return parts.join("\n");
}

/** JSON schema for servers that support constrained output (llama.cpp, LM Studio). */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    thing: { type: "string" },
    suggestions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          offer: { type: "string", enum: OFFERS.map((o) => o.id) },
          line: { type: "string" },
        },
        required: ["offer", "line"],
      },
    },
  },
  required: ["thing", "suggestions"],
} as const;

/** OpenAI-compatible chat messages (works with llama-server, LM Studio, Ollama's /v1). */
export function buildMessages(d: ElementDescription, imageDataUrl?: string) {
  const text = describeForPrompt(d);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: imageDataUrl
        ? [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text },
          ]
        : text,
    },
  ];
}

export interface ParseOutcome {
  result: SuggestionResult | null;
  /** Why parsing failed or what was dropped, for the eval. */
  problems: string[];
}

export function parseSuggestions(raw: string): ParseOutcome {
  const problems: string[] = [];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start)
    return { result: null, problems: ["no JSON object"] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { result: null, problems: ["invalid JSON"] };
  }
  const obj = parsed as { thing?: unknown; suggestions?: unknown };
  const list = Array.isArray(obj.suggestions) ? obj.suggestions : [];
  if (!Array.isArray(obj.suggestions)) problems.push("no suggestions array");
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];
  for (const item of list) {
    const offer = String((item as { offer?: unknown })?.offer ?? "")
      .trim()
      .toLowerCase();
    if (!OFFER_BY_ID.has(offer as OfferId)) {
      problems.push(`unknown offer "${offer}"`);
      continue;
    }
    if (seen.has(offer)) {
      problems.push(`repeated offer "${offer}"`);
      continue;
    }
    seen.add(offer);
    let line = String((item as { line?: unknown })?.line ?? "").trim();
    if (!line) line = OFFER_BY_ID.get(offer as OfferId)!.line;
    if (line.length > 90) line = line.slice(0, 87).trimEnd() + "…";
    suggestions.push({ offer: offer as OfferId, line });
    if (suggestions.length === 3) break;
  }
  if (suggestions.length === 0)
    return { result: null, problems: [...problems, "no usable suggestions"] };
  const thing =
    typeof obj.thing === "string" && obj.thing.trim()
      ? obj.thing.trim().slice(0, 40)
      : "this";
  return { result: { thing, suggestions }, problems };
}
