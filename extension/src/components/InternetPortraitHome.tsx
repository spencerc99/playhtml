// ABOUTME: Main popup home view showing internet portrait status and data collection summary
// ABOUTME: Entry point for the "we were online" experience
import React, { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { PlayerIdentityCard } from "./PlayerIdentityCard";
import type { PlayerIdentity } from "../types";
import type { CollectorStatus } from "../collectors/types";
import {
  collectionModeStorageKey,
  normalizeCollectionMode,
  type CollectionMode,
} from "../collectors/modes";
import { TinyMovementPreview } from "./TinyMovementPreview";
import { PortraitCard } from "./PortraitCard";
import { CollectorIcon, GearSvg } from "./icons";
import "./InternetPortraitHome.scss";
import { PostcardStack } from "../announcements/PostcardStack";
import { FeedbackForm } from "./FeedbackForm";
import { SiteVisibilityNotice } from "./SiteVisibilityNotice";
import { FeatureGate } from "./FeatureGate";
import { useFeatureState } from "../features/useFeatureAccess";
import { PopupNav, WALKING_RECORD_PAGE } from "./PopupNav";
import { SlowModeSettings } from "./SlowModeSettings";
import { DebugModesSettings } from "./DebugModesSettings";
import { usePhoneLayout } from "../entrypoints/scraps/phoneLayout";

interface Props {
  playerIdentity: PlayerIdentity | null;
  discoveredSites: string[];
  onOpenSettings: () => void;
  onViewHistory: () => void;
  onViewCommute?: () => void;
  commuteIsOpen?: boolean;
  onViewBrowsingHistory: () => void;
  onViewScraps?: () => void;
  onViewChangelog: () => void;
  hiddenSiteName?: string;
  onShowSatchel?: () => void;
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
  onOpenSettings,
  onViewHistory,
  onViewCommute,
  commuteIsOpen = false,
  onViewBrowsingHistory,
  onViewScraps,
  onViewChangelog,
  hiddenSiteName,
  onShowSatchel,
}: Props) {
  const [collectors, setCollectors] = useState<CollectorStatus[] | null>(null);
  const [collectorModes, setCollectorModes] = useState<
    Record<string, CollectionMode>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  const [portraitStats, setPortraitStats] = useState<PortraitStats | null>(
    null,
  );
  const [portraitStatsLoaded, setPortraitStatsLoaded] = useState(false);
  const copresenceEnabled = useFeatureState("COPRESENCE").enabled;
  const phone = usePhoneLayout();

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
          const keys = response.statuses.map((status: CollectorStatus) =>
            collectionModeStorageKey(status.type),
          );
          const stored = await browser.storage.local.get(keys);
          setCollectorModes(
            Object.fromEntries(
              response.statuses.map((status: CollectorStatus) => [
                status.type,
                normalizeCollectionMode(
                  status.type,
                  stored[collectionModeStorageKey(status.type)],
                ),
              ]),
            ),
          );
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
        const domain = url.hostname.replace(/^www\./, "");
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
    if (!copresenceEnabled) return;
    (async () => {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;
      try {
        const { count } = await browser.tabs.sendMessage(tab.id, {
          type: "GET_PRESENCE_COUNT",
        });
        setPresenceCount(count);
      } catch {} // content script may not be ready
    })();
  }, [copresenceEnabled]);

  const openPage = (path: string) => {
    if (path === WALKING_RECORD_PAGE) {
      onViewBrowsingHistory();
      return;
    }
    if (path === "scraps.html" && onViewScraps) {
      onViewScraps();
      return;
    }
    void (async () => {
      await browser.tabs.create({
        url: browser.runtime.getURL(path),
      });
      window.close();
    })();
  };

  const portraitPreview = (
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
    </section>
  );

  return (
    <div className={`portrait-home${phone ? " portrait-home--phone" : ""}`}>
      <PostcardStack />
      <header className="portrait-home__header">
        <div className="portrait-home__header-row">
          <h1 className="portrait-home__wordmark">we were online</h1>
          {playerIdentity && (
            <PlayerIdentityCard
              playerIdentity={playerIdentity}
              discoveredSites={discoveredSites}
              compact
              onClick={onOpenSettings}
            />
          )}
        </div>
        <div className="portrait-home__nav-row">
          {!phone && <PopupNav onNavigate={openPage} />}
          {copresenceEnabled && presenceCount !== null && presenceCount > 0 && (
            <span className="portrait-home__presence">
              {presenceCount} {presenceCount === 1 ? "person" : "people"} here
            </span>
          )}
        </div>
      </header>

      <main className="portrait-home__main">
        {hiddenSiteName && onShowSatchel && (
          <SiteVisibilityNotice
            siteName={hiddenSiteName}
            onShowSatchel={onShowSatchel}
          />
        )}
        {phone && portraitPreview}
        {phone && (
          <PhoneHomeTiles
            onOpenPage={openPage}
            onViewCommute={onViewCommute}
            commuteIsOpen={commuteIsOpen}
          />
        )}
        <FeatureGate feature="COMMUTE">
          {onViewCommute && (
            <>
              {!phone && (
                <button
                  className="commute-entry"
                  onClick={onViewCommute}
                  aria-label={
                    commuteIsOpen
                      ? "Return to the Internet Commute"
                      : "Board the Internet Commute"
                  }
                >
                  <span className="commute-entry__route" aria-hidden="true">
                    <span className="commute-entry__stop commute-entry__stop--blue" />
                    <span className="commute-entry__stop commute-entry__stop--gold" />
                    <span className="commute-entry__stop commute-entry__stop--rust" />
                  </span>
                  <span className="commute-entry__copy">
                    <span className="commute-entry__eyebrow">BOARDING NOW</span>
                    <strong>
                      {commuteIsOpen
                        ? "Return to the internet commute"
                        : "Board the internet commute"}
                    </strong>
                    <span>A slow train through pages people found lately.</span>
                  </span>
                  <span className="commute-entry__door" aria-hidden="true">
                    <span />
                    <span />
                  </span>
                </button>
              )}
              <SlowModeSettings />
            </>
          )}
        </FeatureGate>
        {!phone && portraitPreview}

        <section className="collection-status">
          <div className="collection-status__header-row">
            <h3>
              {phone ? "Collecting on this page" : "Your Collection Status"}
            </h3>
            <button
              onClick={onOpenSettings}
              title="Data settings"
              className="collection-status__settings-link"
            >
              Settings →
            </button>
          </div>
          {error && <p className="collection-status__error">{error}</p>}
          {collectors && phone && (
            <p className="collection-status__summary">
              {collectors
                .filter((c) => (collectorModes[c.type] ?? "off") !== "off")
                .map((c) => c.type)
                .join(" · ") || "nothing right now"}
            </p>
          )}
          {collectors && !phone && (
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
                    className={`collector-pill__state collector-pill__state--${collectorModes[c.type] ?? "off"}`}
                  >
                    {collectorModes[c.type] ?? "off"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <DebugModesSettings />
      </main>

      <footer className="portrait-home__footer">
        <button
          type="button"
          aria-label="settings"
          title="Settings"
          className="portrait-home__changelog-link portrait-home__settings-link"
          onClick={onOpenSettings}
        >
          <GearSvg size={14} />
        </button>
        <button
          type="button"
          className="portrait-home__changelog-link"
          onClick={onViewChangelog}
        >
          changelog
        </button>
        <FeedbackForm />
      </footer>
    </div>
  );
}

const TILE_ICONS = {
  portrait: (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="#9fb83a"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3 20c5-9 9 4 13-5s6-6 9-8" />
      <circle cx="14" cy="14" r="4" />
    </svg>
  ),
  history: (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="#4a9d8a"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="4" y="6" width="20" height="17" rx="3" />
      <path d="M4 11h20M10 3v5M18 3v5" />
    </svg>
  ),
  scraps: (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="#c86a46"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect
        x="4"
        y="5"
        width="13"
        height="10"
        rx="1"
        transform="rotate(-6 10 10)"
      />
      <rect
        x="11"
        y="13"
        width="13"
        height="10"
        rx="1"
        transform="rotate(5 17 18)"
      />
    </svg>
  ),
  commute: (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="#4d7fae"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="22" r="3" />
      <path d="M6 9v10M12 14h12M20 10l4 4-4 4" />
    </svg>
  ),
};

function PhoneTile({
  icon,
  title,
  subtitle,
  onClick,
  variant,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  variant?: "commute";
}) {
  return (
    <button
      type="button"
      className={`phone-tile${variant ? ` phone-tile--${variant}` : ""}`}
      onClick={onClick}
    >
      {icon}
      <span className="phone-tile__copy">
        <span className="phone-tile__title">{title}</span>
        <span className="phone-tile__subtitle">{subtitle}</span>
      </span>
    </button>
  );
}

/** On a phone the header links become a grid of big tiles under the portrait card. */
function PhoneHomeTiles({
  onOpenPage,
  onViewCommute,
  commuteIsOpen,
}: {
  onOpenPage: (path: string) => void;
  onViewCommute?: () => void;
  commuteIsOpen: boolean;
}) {
  return (
    <nav className="phone-tiles" aria-label="Extension pages">
      <PhoneTile
        icon={TILE_ICONS.portrait}
        title="Portrait"
        subtitle="your trace, live"
        onClick={() => onOpenPage("portrait.html")}
      />
      <PhoneTile
        icon={TILE_ICONS.history}
        title="History"
        subtitle="your week online"
        onClick={() => onOpenPage(WALKING_RECORD_PAGE)}
      />
      <FeatureGate feature="SCRAPS">
        <PhoneTile
          icon={TILE_ICONS.scraps}
          title="Scraps"
          subtitle="your collection"
          onClick={() => onOpenPage("scraps.html")}
        />
      </FeatureGate>
      {onViewCommute && (
        <FeatureGate feature="COMMUTE">
          <PhoneTile
            icon={TILE_ICONS.commute}
            title="Commute"
            subtitle={commuteIsOpen ? "back on board" : "board the train"}
            onClick={onViewCommute}
            variant="commute"
          />
        </FeatureGate>
      )}
    </nav>
  );
}
