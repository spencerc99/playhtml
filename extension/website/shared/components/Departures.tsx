// ABOUTME: Train-station departures board rendering navigation events as departures.
// ABOUTME: Rows show traveler color, favicon + destination, origin, time spent, and status.

import React, { useEffect, useMemo, useState } from "react";
import { CollectionEvent } from "../types";
import { extractDomain, getColorForEvent } from "../utils/eventUtils";
import "./Departures.scss";

export interface DepartureRow {
  id: string;
  domain: string;
  ts: number;
  color: string;
  faviconUrl: string | null;
  /** Domain the traveler was on before this one. */
  from: string | null;
  /** Time spent on the previous domain before departing. */
  spentMs: number | null;
}

export interface DeparturesProps {
  events: CollectionEvent[];
  maxRows?: number;
  /** Scrolling notice text along the bottom bar. */
  notice?: string;
}

/** Departures fresher than this flicker as "departing". */
const DEPARTING_WINDOW_MS = 10 * 60 * 1000;
/** Gaps longer than this mean the traveler was away, not dwelling. */
const MAX_DWELL_MS = 4 * 60 * 60 * 1000;

/**
 * Collapse navigation events into departures: one row each time a traveler
 * moves to a different domain than the one they were last seen on.
 */
export function deriveDepartures(
  events: CollectionEvent[],
  maxRows: number,
): DepartureRow[] {
  const navEvents = events
    .filter((e) => e.type === "navigation" && e.meta?.url)
    .sort((a, b) => a.ts - b.ts);

  const lastStopByParticipant = new Map<string, { domain: string; ts: number }>();
  const domainFavicons = new Map<string, string>();
  const rows: DepartureRow[] = [];

  for (const event of navEvents) {
    const domain = extractDomain(event.meta.url);
    if (!domain) continue;

    const faviconUrl = ((event.data as any)?.favicon_url as string) || null;
    if (faviconUrl) domainFavicons.set(domain, faviconUrl);

    const pid = event.meta.pid;
    const prev = lastStopByParticipant.get(pid);
    lastStopByParticipant.set(pid, { domain, ts: event.ts });
    if (prev?.domain === domain) continue;

    const gapMs = prev ? event.ts - prev.ts : null;
    rows.push({
      id: event.id,
      domain,
      ts: event.ts,
      color: getColorForEvent(event),
      faviconUrl: faviconUrl || domainFavicons.get(domain) || null,
      from: prev?.domain ?? null,
      spentMs: gapMs !== null && gapMs <= MAX_DWELL_MS ? gapMs : null,
    });
  }

  // Newest departures at the top of the board
  return rows.slice(-maxRows).reverse();
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

function faviconFor(row: DepartureRow): string {
  return (
    row.faviconUrl ||
    `https://www.google.com/s2/favicons?domain=${row.domain}&sz=32`
  );
}

function BoardClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const day = now
    .toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase();
  const date = String(now.getDate()).padStart(2, "0");
  const month = now
    .toLocaleDateString("en-US", { month: "short" })
    .toUpperCase();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;

  return (
    <div className="departures-clock">
      <div className="departures-clock-date">
        <span>{day}</span>
        <span>{date}</span>
        <span>{month}</span>
      </div>
      <div className="departures-clock-time">{time}</div>
    </div>
  );
}

export function Departures({
  events,
  maxRows = 12,
  notice = "we were online · somewhere, someone is departing for another website",
}: DeparturesProps) {
  const rows = useMemo(() => deriveDepartures(events, maxRows), [
    events,
    maxRows,
  ]);
  const now = Date.now();

  return (
    <div className="departures-board">
      <header className="departures-header">
        <h1>Departures</h1>
      </header>

      <div className="departures-columns">
        <span aria-hidden="true" />
        <span>destination</span>
        <span>from</span>
        <span>spent</span>
        <span>time</span>
        <span>status</span>
      </div>

      <div className="departures-rows">
        {rows.length === 0 ? (
          <div className="departures-row departures-row-empty">
            <span className="departures-destination">NO DEPARTURES</span>
          </div>
        ) : (
          rows.map((row, index) => {
            const departing = now - row.ts < DEPARTING_WINDOW_MS;
            return (
              <div
                className="departures-row"
                key={row.id}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <span className="departures-traveler">
                  <span
                    className="departures-traveler-dot"
                    style={{ backgroundColor: row.color }}
                  />
                </span>
                <span className="departures-destination" title={row.domain}>
                  <img
                    className="departures-favicon"
                    src={faviconFor(row)}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                  {row.domain.toUpperCase()}
                </span>
                <span className="departures-from" title={row.from ?? undefined}>
                  {row.from ? row.from.toUpperCase() : "—"}
                </span>
                <span className="departures-spent">
                  {row.spentMs !== null ? formatDuration(row.spentMs) : "—"}
                </span>
                <span className="departures-time">{formatTime(row.ts)}</span>
                <span
                  className={
                    departing
                      ? "departures-status departures-status-departing"
                      : "departures-status"
                  }
                >
                  {departing ? "departing" : "departed"}
                </span>
              </div>
            );
          })
        )}
      </div>

      <footer className="departures-footer">
        <BoardClock />
        <div className="departures-notice">
          <div className="departures-notice-track">
            <span>{notice.toUpperCase()}</span>
            <span aria-hidden="true">{notice.toUpperCase()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
