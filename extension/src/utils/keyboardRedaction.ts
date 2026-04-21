// ABOUTME: Shared keyboard-text redaction helpers used by KeyboardCollector and Collections UI
// ABOUTME: Exposes PII redaction and a legibility-percent control (0 = cadence only, 100 = full text)

export const REDACTION_CHAR = "\u2588"; // U+2588 FULL BLOCK
export const LEGIBILITY_KEY = "collection_keyboard_privacy_level";
export const DEFAULT_LEGIBILITY = 0;

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE =
  /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

const PII_PATTERNS = [EMAIL_RE, PHONE_RE, SSN_RE];

export function redactPII(text: string): string {
  let out = text;
  for (const re of PII_PATTERNS) {
    out = out.replace(re, (m) => REDACTION_CHAR.repeat(m.length));
  }
  return out;
}

export function redactNonWhitespace(text: string): string {
  return text.replace(/\S/g, REDACTION_CHAR);
}

// Deterministic 32-bit hash so the same (seed, position) always redacts the
// same character within a typing session — avoids preview flicker on re-render.
function hash(seed: number, i: number): number {
  let x = (seed ^ (i * 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Redact text according to a legibility percent (0–100).
 *
 *   0   → every non-whitespace char replaced (old "abstract" mode)
 *   100 → PII-only redaction (old "full" mode)
 *   50  → roughly half of non-PII characters replaced, stable per seed
 *
 * PII is always redacted regardless of legibility. The seed keeps the random
 * pattern stable for a given (text, session) so the preview and the stored
 * event don't flicker on re-render.
 */
export function redactWithLegibility(
  text: string,
  legibilityPct: number,
  seed: number = 0,
): string {
  const pct = Math.max(0, Math.min(100, legibilityPct));

  if (pct >= 100) return redactPII(text);
  if (pct <= 0) return redactNonWhitespace(text);

  const piiRedacted = redactPII(text);
  const hideThreshold = (100 - pct) / 100;

  let out = "";
  for (let i = 0; i < piiRedacted.length; i++) {
    const ch = piiRedacted[i];
    if (/\s/.test(ch) || ch === REDACTION_CHAR) {
      out += ch;
      continue;
    }
    const r = hash(seed, i) / 0xffffffff;
    out += r < hideThreshold ? REDACTION_CHAR : ch;
  }
  return out;
}

/**
 * Normalize stored values. The key previously held `"abstract" | "full"`;
 * migrate those to the new numeric range so old installs Just Work.
 */
export function parseLegibility(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(100, Math.round(raw)));
  }
  if (raw === "abstract") return 0;
  if (raw === "full") return 100;
  return DEFAULT_LEGIBILITY;
}
