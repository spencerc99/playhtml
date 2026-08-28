// ABOUTME: Train-station departures board rendering navigation events as departures.
// ABOUTME: Each row is a domain someone headed to, with a color dot for the traveler.

import React, { useEffect, useMemo, useState } from "react";
import { CollectionEvent } from "../types";
import { extractDomain, getColorForEvent } from "../utils/eventUtils";
import "./Departures.scss";

export interface DepartureRow {
  id: string;
  domain: string;
  ts: number;
  color: string;
}

export interface DeparturesProps {
  events: CollectionEvent[];
  maxRows?: number;
  /** Scrolling notice text along the bottom bar. */
  notice?: string;
}

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

  const lastDomainByParticipant = new Map<string, string>();
  const rows: DepartureRow[] = [];

  for (const event of navEvents) {
    const domain = extractDomain(event.meta.url);
    if (!domain) continue;
    const pid = event.meta.pid;
    if (lastDomainByParticipant.get(pid) === domain) continue;
    lastDomainByParticipant.set(pid, domain);
    rows.push({
      id: event.id,
      domain,
      ts: event.ts,
      color: getColorForEvent(event),
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
  maxRows = 10,
  notice = "we were online · somewhere, someone is departing for another website",
}: DeparturesProps) {
  const rows = useMemo(() => deriveDepartures(events, maxRows), [
    events,
    maxRows,
  ]);

  return (
    <div className="departures-board">
      <header className="departures-header">
        <h1>
          <span className="departures-title-primary">Partenze</span>{" "}
          <span className="departures-title-secondary">Departures</span>
        </h1>
      </header>

      <div className="departures-columns">
        <div className="departures-col-destination">
          <span>destinazione</span>
          <span>destination</span>
        </div>
        <div className="departures-col-time">
          <span>orario</span>
          <span>time</span>
        </div>
        <div className="departures-col-traveler">
          <span>viaggiatore</span>
          <span>traveler</span>
        </div>
      </div>

      <div className="departures-rows">
        {rows.length === 0 ? (
          <div className="departures-row departures-row-empty">
            <span className="departures-destination">
              NESSUNA PARTENZA · NO DEPARTURES
            </span>
          </div>
        ) : (
          rows.map((row) => (
            <div className="departures-row" key={row.id}>
              <span className="departures-destination" title={row.domain}>
                {row.domain.toUpperCase()}
              </span>
              <span className="departures-time">{formatTime(row.ts)}</span>
              <span className="departures-traveler">
                <span
                  className="departures-traveler-dot"
                  style={{ backgroundColor: row.color, color: row.color }}
                />
              </span>
            </div>
          ))
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
