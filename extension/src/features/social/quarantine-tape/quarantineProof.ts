// ABOUTME: Builds the exact payload strings signed for quarantine-tape strip/rip writes.
// ABOUTME: Must stay byte-for-byte identical to the worker's copy in extension/worker/src/lib/quarantineProof.ts.

import type { EdgePoint } from "./types";

export function quarantineStripPayload(
  actor: string,
  url: string,
  type: string,
  a: EdgePoint,
  b: EdgePoint,
  seed: number,
): string {
  return `quarantine-strip-v1\n${actor}\n${url}\n${type}\n${a.wall}:${a.t}\n${b.wall}:${b.t}\n${seed}`;
}

export function quarantineRipPayload(
  actor: string,
  url: string,
  stripId: string,
  pos: number,
): string {
  return `quarantine-rip-v1\n${actor}\n${url}\n${stripId}\n${pos}`;
}
