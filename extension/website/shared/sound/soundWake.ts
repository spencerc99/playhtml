// ABOUTME: Retries suspended movement audio when a visible page wakes or returns from cache.
// ABOUTME: Treats autoplay rejection as expected browser policy rather than an application error.

type ResumeSound = () => Promise<void> | undefined;

export function attachSoundWakeListeners(resumeSound: ResumeSound): () => void {
  const attemptResume = () => {
    void resumeSound()?.catch(() => undefined);
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") attemptResume();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pageshow", attemptResume);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pageshow", attemptResume);
  };
}
