// ABOUTME: The storage seam for quarantine tape — the ONLY module that talks to the backend.
// ABOUTME: Swap these three functions to move the store (playhtml rooms, a portable index) without touching the rest.

import { getConfig } from "../../../storage/sync";
import type { EdgePoint, ElementMark, Strip, TapeType } from "./types";

/**
 * Fetch the verdict (set of strips) for a URL. The caller passes the raw page
 * URL; the worker normalizes. Returns [] on any failure — a broken fetch should
 * never block the page.
 */
export async function getVerdict(url: string): Promise<Strip[]> {
  try {
    const { workerUrl } = await getConfig();
    const res = await fetch(`${workerUrl}/quarantine/verdict?url=${encodeURIComponent(url)}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { strips?: Strip[] };
    return body.strips ?? [];
  } catch {
    return [];
  }
}

export async function postStrip(input: {
  url: string;
  type: TapeType;
  a: EdgePoint;
  b: EdgePoint;
  seed: number;
  createdBy: string;
}): Promise<Strip | null> {
  try {
    const { workerUrl } = await getConfig();
    const res = await fetch(`${workerUrl}/quarantine/strip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { strip?: Strip };
    return body.strip ?? null;
  } catch {
    return null;
  }
}

export async function postRip(input: {
  url: string;
  stripId: string;
  by: string;
  pos: number;
}): Promise<Strip | null> {
  try {
    const { workerUrl } = await getConfig();
    const res = await fetch(`${workerUrl}/quarantine/rip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { strip?: Strip };
    return body.strip ?? null;
  } catch {
    return null;
  }
}

// ----- per-image (element) verdicts -----

/**
 * Fetch marks for a batch of image srcs at once (the on-page renderer asks about
 * every tapeable image together). Returns a src → marks map; missing srcs simply
 * have no entry. Returns {} on any failure.
 */
export async function getElementVerdicts(
  srcs: string[],
): Promise<Record<string, ElementMark[]>> {
  if (srcs.length === 0) return {};
  try {
    const { workerUrl } = await getConfig();
    const qs = srcs.map((s) => `src=${encodeURIComponent(s)}`).join("&");
    const res = await fetch(`${workerUrl}/quarantine/element-verdict?${qs}`);
    if (!res.ok) return {};
    const body = (await res.json()) as { marks?: Record<string, ElementMark[]> };
    return body.marks ?? {};
  } catch {
    return {};
  }
}

export async function postElementMark(input: {
  src: string;
  type: TapeType;
  seed: number;
  createdBy: string;
}): Promise<ElementMark | null> {
  try {
    const { workerUrl } = await getConfig();
    const res = await fetch(`${workerUrl}/quarantine/element-mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { mark?: ElementMark };
    return body.mark ?? null;
  } catch {
    return null;
  }
}

export async function postElementRip(input: {
  src: string;
  markId: string;
  by: string;
  pos: number;
}): Promise<ElementMark | null> {
  try {
    const { workerUrl } = await getConfig();
    const res = await fetch(`${workerUrl}/quarantine/element-rip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { mark?: ElementMark };
    return body.mark ?? null;
  } catch {
    return null;
  }
}
