// ABOUTME: The storage seam for quarantine tape — the ONLY module that talks to the backend.
// ABOUTME: Swap these three functions to move the store (playhtml rooms, a portable index) without touching the rest.

import { getConfig } from "../../../storage/sync";
import type { EdgePoint, Strip, TapeType } from "./types";

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
