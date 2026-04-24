// ABOUTME: Runtime config for wewere.online experiments.
// ABOUTME: Worker base URL is read from VITE_WORKER_URL at build time.

const DEFAULT_WORKER_URL = "https://playhtml-game-api.spencerc99.workers.dev";

export const WORKER_URL: string =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ?? DEFAULT_WORKER_URL;

export const RECENT_EVENTS_URL = `${WORKER_URL}/events/recent`;
export const DAILY_COUNTS_URL = `${WORKER_URL}/events/daily-counts`;
