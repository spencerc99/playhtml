// ABOUTME: Main popup home view showing internet portrait status and data collection summary
// ABOUTME: Entry point for the "we were online" experience
import React, { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { PlayerIdentityCard } from "./PlayerIdentityCard";
import type { PlayerIdentity } from "../types";
import type { CollectorStatus } from "../collectors/types";
import { TinyMovementPreview } from "./TinyMovementPreview";
import { PortraitCard } from "./PortraitCard";
import { CollectorIcon } from "./icons";
import "./InternetPortraitHome.scss";
import { FLAGS } from "../flags";
import { PostcardStack } from "../announcements/PostcardStack";
import { FeedbackForm } from "./FeedbackForm";

interface Props {
  playerIdentity: PlayerIdentity | null;
  discoveredSites: string[];
  onViewCollections: () => void;
  onViewHistory: () => void;
  onViewProfile?: () => void;
  onViewBagSettings?: () => void;
  onViewScraps?: () => void;
  onViewChangelog: () => void;
}

interface PortraitStats {
  domain: string;
  totalTimeMs: number | null;
  hourBuckets: number[];
  cursorDistancePx: number;
  eventCounts: { cursor: number; keyboard: number; viewport: number };
  dateRange: { oldest: string; newest: string } | null;
  uniquePageCount: number;
}

export function InternetPortraitHome({
  playerIdentity,
  discoveredSites,
  onViewCollections,
  onViewHistory,
  onViewProfile,
  onViewBagSettings,
  onViewScraps,
  onViewChangelog,
}: Props) {
  const [collectors, setCollectors] = useState<CollectorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  const [portraitStats, setPortraitStats] = useState<PortraitStats | null>(
    null,
  );
  const [portraitStatsLoaded, setPortraitStatsLoaded] = useState(false);

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
      } catch (e) {
        setError("Collectors unavailable on this page");
      }
    };
    loadStatuses().catch(() => {});
  }, []);

  // Load portrait stats for current tab's domain via background store.
  // Uses the same two-flag pattern as HistoricalOverlay: portraitStats holds
  // the data (null = not yet received), portraitStatsLoaded distinguishes
  // "still fetching" from "fetched but empty" to avoid perpetual loading.
  useEffect(() => {
    (async () => {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.url) {
          setPortraitStatsLoaded(true);
          return;
        }
        const url = new URL(tab.url);
        const domain = url.hostname.replace(/^www\./, '');
        const response = await browser.runtime.sendMessage({
          type: "GET_DOMAIN_STATS",
          domain,
        });
        if (response?.success && response.stats) {
          setPortraitStats(response.stats);
        }
        setPortraitStatsLoaded(true);
      } catch {
        setPortraitStatsLoaded(true);
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
      <PostcardStack />
      <header className="portrait-home__header">
        <div className="portrait-home__header-row">
          <h1 className="portrait-home__wordmark">we were online</h1>
          {playerIdentity && (
            <PlayerIdentityCard
              playerIdentity={playerIdentity}
              discoveredSites={discoveredSites}
              compact
              onClick={onViewProfile}
            />
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
                  hourBuckets={portraitStats.hourBuckets ?? new Array(24).fill(0)}
                  cursorDistancePx={portraitStats.cursorDistancePx ?? 0}
                  dateRange={portraitStats.dateRange}
                  uniquePageCount={portraitStats.uniquePageCount}
                />
              ) : (
                <p className="preview-card__empty">
                  {portraitStatsLoaded
                    ? "No data for this site yet"
                    : "Your portrait is loading..."}
                </p>
              )}
              <div className="preview-card__label">Open Portrait Overlay</div>
            </div>
          </div>
          <div className="portrait-home__nav-links">
            <button
              className="portrait-home__nav-link"
              onClick={async (e) => {
                e.stopPropagation();
                const url = browser.runtime.getURL("portrait.html");
                await browser.tabs.create({ url });
                window.close();
              }}
            >
              portrait
            </button>
            <button
              className="portrait-home__nav-link"
              onClick={async (e) => {
                e.stopPropagation();
                const url = browser.runtime.getURL("stats.html");
                await browser.tabs.create({ url });
                window.close();
              }}
            >
              time
            </button>
            {onViewScraps && (
              <button
                className="portrait-home__nav-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewScraps();
                }}
              >
                scraps
              </button>
            )}
            <button
              className="portrait-home__nav-link"
              onClick={(e) => {
                e.stopPropagation();
                onViewChangelog();
              }}
            >
              changelog
            </button>
          </div>
          {onViewBagSettings && (
            <button
              className="portrait-home__nav-link portrait-home__bag-settings-link"
              onClick={onViewBagSettings}
            >
              bag settings
            </button>
          )}
        </section>
      </main>

      <footer className="portrait-home__footer">
        <span>Beta</span>
        <FeedbackForm />
      </footer>
    </div>
  );
}
