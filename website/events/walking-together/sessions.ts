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
  /**
   * Optional explicit playhtml room string, used verbatim instead of the
   * derived `walking-together-<id>` room. Set this for sessions whose data
   * lives in a room that predates this id scheme — e.g. the original Rhizome
   * event, whose shared URLs live in the pre-v2 pathname-based room. The value
   * is the un-prefixed room string; playhtml prepends the host (so
   * `/events/walking-together/` resolves to the live `playhtml.fun-...` room).
   */
  room?: string;
}

export const SESSIONS: WorkshopSession[] = [
  {
    id: "2025-04-30-rhizome",
    label: "walking together (Rhizome)",
    date: "2025-04-30",
    archived: true,
    // The original Rhizome event ran before the session system, on the
    // default pathname-based room. Point at it so the archived view shows the
    // real shared URLs from that day.
    room: "/events/walking-together/",
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

/** Derived playhtml room string for a session id. */
export function sessionRoom(id: string): string {
  return `walking-together-${id}`;
}

/**
 * The playhtml room string for a session — its explicit `room` override when
 * set (e.g. the legacy Rhizome room), otherwise the derived id-based room.
 */
export function roomForSession(session: WorkshopSession): string {
  return session.room ?? sessionRoom(session.id);
}

export function roomForCurrentPage(
  session: WorkshopSession,
  location: URL,
): string {
  const testRoom = location.searchParams.get("testRoom");
  const allowTestRoom =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "::1";

  if (testRoom && allowTestRoom) return testRoom;
  return roomForSession(session);
}

/** The latest non-archived session. */
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
 * Raw `?session=` value from a location search string, or null when absent.
 * Does not validate against SESSIONS — callers decide how to handle unknowns.
 */
export function parseSessionId(search: string): string | null {
  return new URLSearchParams(search).get("session");
}

/**
 * Resolve a session from a location search string. Returns the matching
 * session, or null when the param is absent or names an unknown session —
 * the session page treats null as "redirect to the home list".
 */
export function resolveSession(search: string): WorkshopSession | null {
  const id = parseSessionId(search);
  if (!id) return null;
  return findSession(id) ?? null;
}
