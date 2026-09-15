// ABOUTME: Regenerates the sound playground's bundled event fixture from live worker data.
// ABOUTME: Run with `bun extension/website/sounds/regenerateSample.ts [windowMs]`.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEFAULT_WINDOW_MS,
  fetchSampleEvents,
  summarizeSample,
} from "./SamplePlayback";

/**
 * The fixture is produced by the page's own fetch path rather than by a
 * parallel implementation, so whatever anonymization that path applies —
 * renumbered participants, dropped urls, keyboard cadence in place of typed
 * text — applies here by construction. A second copy of those rules would be
 * a second place for them to drift.
 *
 * The worker's read endpoints are origin-gated and allow localhost, so the
 * request carries the dev origin the playground itself uses.
 */
const ORIGIN = "http://localhost:5186";

const originalFetch = globalThis.fetch;
globalThis.fetch = ((input, init) =>
  originalFetch(input, {
    ...init,
    headers: { ...(init?.headers ?? {}), Origin: ORIGIN },
  })) as typeof fetch;

const windowMs = Number(process.argv[2] ?? DEFAULT_WINDOW_MS);
if (!Number.isFinite(windowMs) || windowMs <= 0) {
  throw new Error(`Invalid window: ${process.argv[2]}`);
}

const events = await fetchSampleEvents("", windowMs);
if (events.length === 0) {
  throw new Error("The worker returned no events; the fixture was left alone");
}

const summary = summarizeSample(events);

// Any typed text surviving into the fixture would be committed to the repo, so
// this refuses to write rather than trusting the mapping above to be correct.
// Checked as object keys, not as a substring of the whole document: a cursor
// keyword is legitimately the string "text".
// The keyboard payload's own field names. `t` is deliberately absent: that is
// also `SampleEvent`'s replay clock, which every event legitimately carries.
const CONTENT_KEYS = ["text", "sequence", "deletedCount", "style", "ce"];
for (const event of events) {
  const carried = CONTENT_KEYS.filter((key) => key in event);
  if (carried.length > 0) {
    throw new Error(
      `Keyboard content reached the fixture (${carried.join(", ")}); refusing to write it`,
    );
  }
  for (const beat of event.keys ?? []) {
    const extra = Object.keys(beat).filter(
      (key) => key !== "dt" && key !== "count",
    );
    if (extra.length > 0) {
      throw new Error(
        `A keystroke beat carries more than timing (${extra.join(", ")})`,
      );
    }
  }
}

const serialized = JSON.stringify(events);

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  "sampleEvents.json",
);
writeFileSync(target, `${serialized}\n`);

console.log(`Wrote ${target}`);
console.log(summary);
