// ABOUTME: The URL flag that puts a live page into sound-development mode
// ABOUTME: Its own module so the URL builder can preserve it without pulling in the panel

/** The query flag that puts a live page into sound-development mode. */
export const SOUND_DEV_PARAM = "sounddev";

/**
 * Whether this page load asked for the sound dev surfaces.
 *
 * Absent, a live page behaves exactly as it shipped: the panel is not mounted,
 * the saved arrangement is not read, and no sound visual is drawn. The flag is
 * read from the URL only — nothing persists it, so a dev session ends when the
 * parameter is dropped.
 */
export const isSoundDevEnabled = (
  search: string = typeof window === "undefined" ? "" : window.location.search,
): boolean => new URLSearchParams(search).get(SOUND_DEV_PARAM) === "1";
