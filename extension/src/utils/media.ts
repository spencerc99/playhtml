// ABOUTME: Media helpers shared by idle detection in the top frame and embedded frames.
// ABOUTME: Watching or listening without touching anything still counts as being active.

export function isMediaPlaying(): boolean {
  return Array.from(document.querySelectorAll('video, audio')).some(
    (el) => {
      const media = el as HTMLMediaElement;
      return !media.paused && !media.ended && media.readyState > 2;
    },
  );
}
