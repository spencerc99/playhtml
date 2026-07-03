// ABOUTME: Plans browser launches and cursor cadence for artificial-user runs.
// ABOUTME: Keeps multi-actor scenes lightweight while preserving extension support.

export type BrowserLaunchMode = "shared" | "persistent";

export function chooseBrowserLaunchMode(scene: {
  extension?: boolean;
}): BrowserLaunchMode {
  return scene.extension ? "persistent" : "shared";
}

export function chooseRecordedActor(
  actorCount: number,
  recordActor: number | undefined,
) {
  const index = recordActor ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= actorCount) {
    throw new Error(`recordActor must be between 0 and ${actorCount - 1}`);
  }
  return index;
}

export function smoothMoveSteps(durationMs: number, targetFps = 60) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("durationMs must be positive");
  }
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    throw new Error("targetFps must be positive");
  }
  return Math.max(8, Math.round(durationMs / (1000 / targetFps)));
}
