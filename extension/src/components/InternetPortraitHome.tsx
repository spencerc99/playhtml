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
import { LocalEventStore } from "../storage/LocalEventStore";
import { extractDomain } from "../utils/urlNormalization";
import "./InternetPortraitHome.scss";

const store = new LocalEventStore();

interface Props {
  playerIdentity: PlayerIdentity | null;
  onViewCollections: () => void;
  onViewHistory: () => void;
}

interface PortraitStats {
  domain: string;
  eventCounts: { cursor: number; keyboard: number; viewport: number };
  dateRange: { oldest: string; newest: string } | null;
  uniquePageCount: number;
}

export function InternetPortraitHome({
  playerIdentity,
  onViewCollections,
  onViewHistory,
}: Props) {
  const [collectors, setCollectors] = useState<CollectorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  const tRef = useRef<number>(0);
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
          const recent = await browser.tabs.sendMessage(tab.id, {
            type: "GET_RECENT_EVENTS",
          });
          if (recent?.success && Array.isArray(recent.events)) {
            setRecentCursorEvents(recent.events as CollectionEvent[]);
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

      const events = recentCursorEvents || [];
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

  // Load portrait stats for current tab's domain
  useEffect(() => {
    (async () => {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        const domain = extractDomain(tab?.url ?? null);
        if (!domain) return;

        const domainStats = await store.getDomainStats(domain);
        if (domainStats.totalEvents === 0) return;

        // Collect unique pages
        const events = await store.queryByDomain(domain);
        const uniqueUrls = new Set(
          events.map((e) => e.meta.url).filter(Boolean),
        );

        const counts = { cursor: 0, keyboard: 0, viewport: 0 };
        events.forEach((e) => {
          if (e.type === "cursor") counts.cursor++;
          else if (e.type === "keyboard") counts.keyboard++;
          else if (e.type === "viewport") counts.viewport++;
        });

        const dateRange =
          domainStats.firstVisit && domainStats.lastVisit
            ? {
                oldest: new Date(domainStats.firstVisit).toLocaleDateString(),
                newest: new Date(domainStats.lastVisit).toLocaleDateString(),
              }
            : null;

        setPortraitStats({
          domain,
          eventCounts: counts,
          dateRange,
          uniquePageCount: uniqueUrls.size,
        });
      } catch {
        // Best-effort — portrait card is optional
      }
    })();
  }, []);

  return (
    <div className="portrait-home">
      <header className="portrait-home__header">
        <div className="portrait-home__header-row">
          <h1 className="portrait-home__wordmark">we were online</h1>
          {playerIdentity && (
            <PlayerIdentityCard playerIdentity={playerIdentity} compact />
          )}
        </div>
        <p className="portrait-home__subtitle">
          An evolving portrait from your time on the internet
        </p>
      </header>

      <main className="portrait-home__main">
        {/* TODO: replace mock data with real portraitStats once IndexedDB loading is reliable */}
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
                      {c.type === "cursor" && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 32 32"
                          fill="#3d3833"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z" />
                          <path d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z" />
                        </svg>
                      )}
                      {c.type === "keyboard" && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <rect
                            x="3"
                            y="7"
                            width="18"
                            height="10"
                            rx="2"
                            stroke="#3d3833"
                          />
                          <rect
                            x="5"
                            y="9"
                            width="2"
                            height="2"
                            fill="#3d3833"
                          />
                          <rect
                            x="8"
                            y="9"
                            width="2"
                            height="2"
                            fill="#3d3833"
                          />
                          <rect
                            x="11"
                            y="9"
                            width="2"
                            height="2"
                            fill="#3d3833"
                          />
                          <rect
                            x="14"
                            y="9"
                            width="2"
                            height="2"
                            fill="#3d3833"
                          />
                          <rect
                            x="17"
                            y="9"
                            width="2"
                            height="2"
                            fill="#3d3833"
                          />
                          <rect
                            x="5"
                            y="12"
                            width="10"
                            height="2"
                            fill="#3d3833"
                          />
                          <rect
                            x="16"
                            y="12"
                            width="3"
                            height="2"
                            fill="#3d3833"
                          />
                        </svg>
                      )}
                      {c.type === "navigation" && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <rect
                            x="3"
                            y="5"
                            width="18"
                            height="14"
                            rx="2"
                            stroke="#3d3833"
                          />
                          <circle cx="7" cy="8" r="1" fill="#3d3833" />
                          <circle cx="10" cy="8" r="1" fill="#3d3833" />
                          <rect
                            x="5"
                            y="10"
                            width="14"
                            height="7"
                            fill="#efe9df"
                            stroke="#efe9df"
                          />
                        </svg>
                      )}
                      {c.type === "viewport" && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <rect
                            x="4"
                            y="4"
                            width="16"
                            height="16"
                            rx="2"
                            stroke="#3d3833"
                          />
                          <rect
                            x="17"
                            y="6"
                            width="2"
                            height="12"
                            rx="1"
                            fill="#b5aea5"
                          />
                          <rect
                            x="17"
                            y="9"
                            width="2"
                            height="4"
                            rx="1"
                            fill="#3d3833"
                          />
                        </svg>
                      )}
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
              <PortraitCard
                domain={portraitStats?.domain ?? "github.com"}
                totalTimeMs={12319252}
                eventCounts={
                  portraitStats?.eventCounts ?? {
                    cursor: 1420,
                    keyboard: 83,
                    viewport: 204,
                  }
                }
                dateRange={
                  portraitStats?.dateRange ?? {
                    oldest: "1/1/2026",
                    newest: "2/20/2026",
                  }
                }
                uniquePageCount={portraitStats?.uniquePageCount ?? 47}
                compact
              />
              <div className="preview-card__label">Open Your Portrait</div>
            </div>
          </div>
          <p className="preview-hint">
            A preview of cursor movement animates above. Click to view your full
            portrait.
          </p>
        </section>
      </main>

      <footer className="portrait-home__footer">Beta</footer>
    </div>
  );
}
