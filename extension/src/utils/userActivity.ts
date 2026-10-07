// ABOUTME: Reports whether the browser considers the user active.
// ABOUTME: Keeps milestone delivery available when the idle API is unsupported.

interface IdleActivity {
  queryState(detectionIntervalInSeconds: number): Promise<string>;
}

export async function isUserActive(
  idleActivity: IdleActivity | undefined,
): Promise<boolean> {
  if (!idleActivity?.queryState) return true;

  try {
    return (await idleActivity.queryState(60)) === "active";
  } catch (error) {
    console.warn("[Background] Could not read browser idle state:", error);
    return true;
  }
}
