// ABOUTME: Main popup home view showing internet portrait status and data collection summary
// ABOUTME: Entry point for the "we were online" experience
import React, { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { PlayerIdentityCard } from "./PlayerIdentityCard";
import type { PlayerIdentity } from "../types";
import type { CollectorStatus } from "../collectors/types";
import type { CollectionEvent } from "../collectors/types";
import { TinyMovementPreview } from "./TinyMovementPreview";
import { PortraitCard } from "./PortraitCard";
import { CollectorIcon } from "./icons";
import "./InternetPortraitHome.scss";
import { FLAGS } from "../flags";

interface Props {
  playerIdentity: PlayerIdentity | null;
  onViewCollections: () => void;
  onViewHistory: () => void;
  onViewProfile?: () => void;
}

interface PortraitStats {
  domain: string;
  totalTimeMs: number | null;
  sessions: { url: string; focusTs: number; blurTs: number; durationMs: number }[];
  cursorDistancePx: number;
  eventCounts: { cursor: number; keyboard: number; viewport: number };
  dateRange: { oldest: string; newest: string } | null;
  uniquePageCount: number;
}

export function InternetPortraitHome({
  playerIdentity,
  onViewCollections,
  onViewHistory,
  onViewProfile,
}: Props) {
  const [collectors, setCollectors] = useState<CollectorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  const tRef = useRef<number>(0);
  const cursorEventsRef = useRef<CollectionEvent[] | null>(null);
  const [recentCursorEvents, setRecentCursorEvents] = useState<
    CollectionEvent[] | null
  >(null);
  const [portraitStats, setPortraitStats] = useState<PortraitStats | null>(
    null,
  );

  useEffect(() => {
    const loadStatuses = async () => {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) return;
        const response = await browser.tabs.sendMessage(tab.id, {
          type: "GET_COLLECTOR_STATUSES",
        });
        if (response && Array.isArray(response.statuses)) {
          setCollectors(response.statuses);
          setError(null);
        } else {
          setCollectors(null);
        }
        // Try to pull recent cursor events for preview (best-effort)
        try {
          if (tab.url) {
            const url = new URL(tab.url);
            const domain = url.hostname.replace(/^www\./, '');
            const recent = await browser.runtime.sendMessage({
              type: "GET_RECENT_EVENTS",
              domain,
            });
            if (recent?.success && Array.isArray(recent.events)) {
              cursorEventsRef.current = recent.events as CollectionEvent[];
              setRecentCursorEvents(recent.events as CollectionEvent[]);
            }
          }
        } catch {}
      } catch (e) {
        setError("Collectors unavailable on this page");
      }
    };
    loadStatuses().catch(() => {});
    // Start canvas animation using recent cursor events if available
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = (canvas.width = canvas.clientWidth);
      const h = (canvas.height = canvas.clientHeight);
      ctx.fillStyle = "rgba(90,78,65,0.08)";
      ctx.fillRect(0, 0, w, h);

      const events = cursorEventsRef.current || [];
      tRef.current += 0.02;
      const maxPoints = Math.min(50, events.length);
      const start = Math.max(0, events.length - maxPoints);
      const points = events.slice(start).map((e) => {
        const d: any = e.data || {};
        return { x: (d.x || 0) * w, y: (d.y || 0) * h };
      });

      ctx.strokeStyle = "rgba(74,154,138,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i],
          q = points[i + 1];
        if (i === 0) ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();

      const head = points[points.length - 1];
      if (head) {
        ctx.beginPath();
        ctx.arc(head.x, head.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#4a9a8a";
        ctx.fill();
      }
      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // Load portrait stats for current tab's domain via background store
  useEffect(() => {
    (async () => {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.url) return;
        const url = new URL(tab.url);
        const domain = url.hostname.replace(/^www\./, '');
        const response = await browser.runtime.sendMessage({
          type: "GET_DOMAIN_STATS",
          domain,
        });
        if (response?.success && response.stats) {
          setPortraitStats(response.stats);
        }
      } catch {
        // Best-effort — portrait card is optional
      }
    })();
  }, []);

  useEffect(() => {
    if (!FLAGS.COPRESENCE) return;
    (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      try {
        const { count } = await browser.tabs.sendMessage(tab.id, { type: "GET_PRESENCE_COUNT" });
        setPresenceCount(count);
      } catch {} // content script may not be ready
    })();
  }, []);

  return (
    <div className="portrait-home">
      <header className="portrait-home__header">
        <div className="portrait-home__header-row">
          <h1 className="portrait-home__wordmark">we were online</h1>
          {playerIdentity && (
            <PlayerIdentityCard playerIdentity={playerIdentity} compact onClick={onViewProfile} />
          )}
        </div>
        <div className="portrait-home__subtitle-row">
          <p className="portrait-home__subtitle">
            An evolving portrait from your time on the internet
          </p>
          {FLAGS.COPRESENCE && presenceCount !== null && presenceCount > 0 && (
            <span className="portrait-home__presence">
              {presenceCount} {presenceCount === 1 ? "person" : "people"} here
            </span>
          )}
        </div>
      </header>

      <main className="portrait-home__main">
        <section className="collection-status">
          <div className="collection-status__header-row">
            <h3>Your Collection Status</h3>
            <button
              onClick={onViewCollections}
              title="Data settings"
              className="collection-status__settings-link"
            >
              Settings →
            </button>
          </div>
          {error && <p className="collection-status__error">{error}</p>}
          {collectors && (
            <div className="collection-status__grid">
              {collectors.map((c) => (
                <div key={c.type} className="collector-pill">
                  <div className="collector-pill__name-row">
                    <span aria-hidden className="collector-pill__icon">
                      <CollectorIcon type={c.type} />
                    </span>
                    <span className="collector-pill__name">{c.type}</span>
                  </div>
                  <span
                    className={`collector-pill__state collector-pill__state--${
                      c.enabled ? "on" : "off"
                    }`}
                  >
                    {c.enabled ? "On" : "Off"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={onViewHistory}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onViewHistory();
            }}
            className="preview-card"
          >
            <div className="preview-card__chrome">
              <span className="preview-card__dot preview-card__dot--close" />
              <span className="preview-card__dot preview-card__dot--min" />
              <span className="preview-card__dot preview-card__dot--expand" />
            </div>
            <div className="preview-card__body">
              <TinyMovementPreview />
              {portraitStats ? (
                <PortraitCard
                  domain={portraitStats.domain}
                  totalTimeMs={portraitStats.totalTimeMs}
                  sessions={portraitStats.sessions ?? []}
                  cursorDistancePx={portraitStats.cursorDistancePx ?? 0}
                  dateRange={portraitStats.dateRange}
                  uniquePageCount={portraitStats.uniquePageCount}
                />
              ) : (
                <p className="preview-card__empty">
                  Your portrait is being built. Browse a little and come back.
                </p>
              )}
              <div className="preview-card__label">Open Your Portrait</div>
            </div>
          </div>
        </section>
      </main>

      <footer className="portrait-home__footer">Beta</footer>
    </div>
  );
}
