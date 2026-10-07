// ABOUTME: Asks the shipped commute policy what it does with a URL, so the code's
// ABOUTME: own scenery and never-show rules override any judgment from Jev.

import { join } from "node:path";

export type CodeVerdict = "hidden" | "scenery" | "open";

type CommuteResponse = {
  destinations: Array<{ url?: string; domain: string }>;
  scenery: Array<{ domain: string }>;
};

type BuildCommuteResponse = (
  navigationEvents: unknown[],
  cursorEvents: unknown[],
  now?: number,
) => CommuteResponse;

let build: BuildCommuteResponse | null = null;

/** Imports the real policy module rather than restating any of its lists here. */
export async function loadPolicy(repoRoot: string): Promise<void> {
  const module = (await import(
    join(repoRoot, "extension/worker/src/routes/commutePolicy.ts")
  )) as { buildCommuteResponse: BuildCommuteResponse };
  build = module.buildCommuteResponse;
}

/**
 * Runs one navigation event for the URL through the policy and reads back what
 * it did with it. `open` means the policy allows it as a stop and leaves the
 * placement to us; the other two are the code's decision and final.
 */
export function codeVerdictFor(url: string): CodeVerdict {
  if (!build) throw new Error("policy not loaded; call loadPolicy first");

  const response = build(
    [
      {
        id: "probe",
        type: "navigation",
        ts: 500,
        data: { title: "Probe page" },
        meta: {
          pid: "rider-one",
          sid: "session-rider-one",
          url,
          vw: 1200,
          vh: 800,
          tz: "UTC",
          cursor_color: "#5b8db8",
        },
      },
    ],
    [],
    1_000,
  );

  if (response.destinations.length > 0) return "open";
  if (response.scenery.length > 0) return "scenery";
  return "hidden";
}
