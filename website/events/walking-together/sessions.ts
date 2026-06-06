// ABOUTME: Static config of walking-together workshop sessions and helpers.
// ABOUTME: Each session is an isolated playhtml room keyed by a ?session=<id> param.

/** A run of subtitle text, optionally linked. Sessions compose these into the
 * credits line under the title. Plain string segments render as text. */
export type SubtitleSegment = string | { text: string; href: string };

export interface WorkshopSession {
  /** Becomes ?session=<id> on the room. */
  id: string;
  /** Human title shown on the home page. */
  label: string;
  /** YYYY-MM-DD. */
  date: string;
  /** When true, the session page is read-only. */
  archived: boolean;
  /** Credits line shown under the title on the session page. */
  subtitle: SubtitleSegment[];
}

export const SESSIONS: WorkshopSession[] = [
  {
    id: "2025-04-30-rhizome",
    label: "walking together (Rhizome)",
    date: "2025-04-30",
    archived: true,
    subtitle: [
      "with ",
      { text: "kristoffer tjalve", href: "https://naiveweekly.com" },
      " & ",
      { text: "spencer chang", href: "https://spencer.place" },
      ", with ",
      { text: "rhizome", href: "https://rhizome.org/" },
    ],
  },
  {
    id: "2026-06-06-byod",
    label: "walking together (BYOD)",
    date: "2026-06-06",
    archived: false,
    subtitle: [
      "with ",
      { text: "spencer chang", href: "https://spencer.place" },
      ", at ITP",
    ],
  },
];

/** Playhtml room id for a session. */
export function sessionRoom(id: string): string {
  return `walking-together-${id}`;
}

/** The latest non-archived session — the fallback when no ?session is given. */
export function defaultSession(): WorkshopSession {
  const active = SESSIONS.filter((s) => !s.archived);
  if (active.length === 0) {
    throw new Error("No active walking-together session configured.");
  }
  return active[active.length - 1];
}

export function findSession(id: string): WorkshopSession | undefined {
  return SESSIONS.find((s) => s.id === id);
}

/**
 * Resolve the session id from a location search string (e.g. "?session=foo").
 * Falls back to the default session when the param is absent or unknown.
 */
export function resolveSessionId(search: string): string {
  const params = new URLSearchParams(search);
  const id = params.get("session");
  if (id && findSession(id)) return id;
  return defaultSession().id;
}
