// ABOUTME: Widget mode: the map framed in a corner of the browser, walking to wherever the person goes.
// ABOUTME: Speaks postMessage with the extension shell that frames it; nobody steers, journeys arrive.

/**
 * The extension keeps a journey — the sites this person has been visiting —
 * and posts it in whenever it changes. The last stop is where they are now;
 * the walker sets off for it from wherever it was, and on a cold start it is
 * put down at the stop before, so every page load still shows the road
 * between the two. Speed scales with the distance so a trip across the map
 * takes about as long as one across town.
 */
import { Wayfarer, WayfarerStatus } from "./wayfarer";
import { Locator, Located } from "./locate";

export const WIDGET_SOURCE = "wwo-internet-map";
export const SHELL_SOURCE = "wwo-wayfarer";

export interface JourneyStop { url: string; title?: string; ts?: number }

export interface JourneyMessage {
  source: typeof SHELL_SOURCE;
  type: "journey";
  stops: JourneyStop[];
  /** the person's cursor colour, so the walker is drawn as their cursor */
  color?: string | null;
}

export type WidgetState = "locating" | "walking" | "arrived" | "lost";

export interface StatusMessage {
  source: typeof WIDGET_SOURCE;
  type: "status";
  state: WidgetState;
  place: { name: string; host: string; domain: string } | null;
  text: string;
}

export function isJourneyMessage(v: unknown): v is JourneyMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Partial<JourneyMessage>;
  return m.source === SHELL_SOURCE && m.type === "journey" && Array.isArray(m.stops);
}

/** Trips are quicker in a corner of someone's browser than on the map itself. */
const TRIP_SECONDS = 4.5;

export class WidgetBridge {
  /** the URL the walker was last sent to */
  private target: string | null = null;
  private targetLoc: Located | null = null;

  constructor(
    private wf: Wayfarer,
    private locator: Locator,
    private post: (m: StatusMessage | { source: typeof WIDGET_SOURCE; type: "ready" }) => void,
  ) {
    wf.widget = true;
    wf.tripSeconds = TRIP_SECONDS;
    wf.onStatus((s) => this.relay(s));
  }

  /** Announce readiness; the shell answers with the journey. */
  start() {
    this.post({ source: WIDGET_SOURCE, type: "ready" });
  }

  /** The person's journey, oldest first. Only the newest stop is new to us. */
  journey(stops: JourneyStop[], color?: string | null) {
    if (color !== undefined) this.wf.setColor(color);
    const last = stops[stops.length - 1];
    if (!last || typeof last.url !== "string") return;
    if (last.url === this.target) return;
    const loc = this.locator.locate(last.url);
    this.target = last.url;
    if (!loc) {
      this.targetLoc = null;
      const host = hostOf(last.url);
      this.post(status("lost", null, host ? `${host} is off the map` : "off the map"));
      return;
    }
    this.targetLoc = loc;
    if (!this.wf.active) {
      // a cold start: put the walker down at the stop before, and set off
      const prev = stops.length > 1 ? this.locator.locate(stops[stops.length - 2].url) : null;
      if (prev && prev.page !== loc.page) {
        this.wf.enter({ page: prev.page, instant: true });
        this.go(loc);
      } else {
        this.wf.enter({ page: loc.page, instant: true });
        this.post(status("arrived", loc, `at ${loc.host}`));
      }
      return;
    }
    this.go(loc);
  }

  private go(loc: Located) {
    if (!this.wf.travel(loc.page)) {
      // no road leads there: appear rather than never arrive
      this.wf.enter({ page: loc.page, instant: true });
      this.post(status("arrived", loc, `at ${loc.host}`));
      return;
    }
    this.post(status("walking", loc, `walking to ${loc.host}`));
  }

  private relay(s: WayfarerStatus) {
    const loc = this.targetLoc;
    if (s.state === "arrived" && loc) this.post(status("arrived", loc, `at ${loc.host}`));
    else if (s.state === "walking" && loc) {
      const left = this.wf.walker.plan?.steps.length ?? 0;
      this.post(status("walking", loc,
        `walking to ${loc.host}${left ? ` · ${left} ${left === 1 ? "road" : "roads"} to go` : ""}`));
    }
  }
}

function status(state: WidgetState, loc: Located | null, text: string): StatusMessage {
  return {
    source: WIDGET_SOURCE, type: "status", state,
    place: loc ? { name: loc.name, host: loc.host, domain: loc.domain } : null,
    text,
  };
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
