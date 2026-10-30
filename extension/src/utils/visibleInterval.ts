// ABOUTME: Repeats a refresh on an interval only while the page is visible.
// ABOUTME: Hidden tabs stop polling; a tab that becomes visible refreshes once right away.

/**
 * Calls `refresh` every `intervalMs` while `doc` is visible. While hidden the
 * interval is stopped; on becoming visible `refresh` runs immediately and the
 * interval restarts. The caller performs any initial load. Returns a stop
 * function.
 */
export function startVisibleInterval(
  refresh: () => void,
  intervalMs: number,
  doc: Document = document,
): () => void {
  let timer: number | null = null;

  const startTimer = () => {
    if (timer === null) timer = window.setInterval(refresh, intervalMs);
  };
  const stopTimer = () => {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  };
  const handleVisibilityChange = () => {
    if (doc.hidden) {
      stopTimer();
      return;
    }
    if (timer !== null) return;
    refresh();
    startTimer();
  };

  if (!doc.hidden) startTimer();
  doc.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    doc.removeEventListener("visibilitychange", handleVisibilityChange);
    stopTimer();
  };
}
