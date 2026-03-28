// ABOUTME: Stats page — shows time spent on your top domains
// ABOUTME: Expand any domain row to see its top pages by time spent
// ABOUTME: Opens as a full tab from the Collections settings panel

import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import "../../styles/options.scss";
import "./stats.scss";

interface DomainEntry {
  domain: string;
  eventCount: number;
  lastVisit: number;
}

interface PageSession {
  url: string;
  focusTs: number;
  blurTs: number;
  durationMs: number;
}

interface DomainStats {
  domain: string;
  totalTimeMs: number | null;
  sessions: PageSession[];
  uniquePageCount: number;
  dateRange: { oldest: string; newest: string } | null;
  eventCounts: { cursor: number; keyboard: number; viewport: number };
}

interface PageStat {
  url: string;
  path: string;
  totalTimeMs: number;
  visitCount: number;
}

interface EnrichedDomain extends DomainEntry {
  stats: DomainStats | null;
  loading: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatLastVisit(ts: number): string {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

/** Extract a display path from a full URL (strips protocol + domain, keeps path+query). */
function getPagePath(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + (parsed.search || "");
    return path === "/" ? "/" : path.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Aggregate sessions by normalized URL into per-page time totals, sorted by time desc. */
function computeTopPages(sessions: PageSession[], limit = 10): PageStat[] {
  const byUrl = new Map<string, { totalTimeMs: number; visitCount: number }>();
  for (const s of sessions) {
    const existing = byUrl.get(s.url) ?? { totalTimeMs: 0, visitCount: 0 };
    byUrl.set(s.url, {
      totalTimeMs: existing.totalTimeMs + s.durationMs,
      visitCount: existing.visitCount + 1,
    });
  }
  return Array.from(byUrl.entries())
    .map(([url, data]) => ({ url, path: getPagePath(url), ...data }))
    .sort((a, b) => b.totalTimeMs - a.totalTimeMs)
    .slice(0, limit);
}

const TOP_DOMAINS = 30;
const TOP_PAGES = 10;

const StatsPage = () => {
  const [domains, setDomains] = useState<EnrichedDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalTimeMs, setTotalTimeMs] = useState(0);
  const [sortBy, setSortBy] = useState<"time" | "visits">("time");
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await browser.runtime.sendMessage({ type: "GET_ALL_DOMAINS" });
      if (!res?.success || !res.domains) {
        setError("Could not reach background script. Try reloading the extension.");
        return;
      }

      const allDomains: DomainEntry[] = res.domains;
      const topDomains = allDomains
        .sort((a, b) => b.eventCount - a.eventCount)
        .slice(0, TOP_DOMAINS);

      // Show domain names immediately while stats load
      setDomains(topDomains.map((d) => ({ ...d, stats: null, loading: true })));
      setLoading(false);

      // Fetch per-domain stats in parallel
      const statsResults = await Promise.allSettled(
        topDomains.map((d) =>
          browser.runtime.sendMessage({ type: "GET_DOMAIN_STATS", domain: d.domain }),
        ),
      );

      const enrichedWithStats: EnrichedDomain[] = topDomains.map((d, i) => {
        const result = statsResults[i];
        const stats =
          result.status === "fulfilled" && result.value?.success
            ? (result.value.stats as DomainStats | null)
            : null;
        return { ...d, stats, loading: false };
      });

      const sorted = [...enrichedWithStats].sort((a, b) => {
        const ta = a.stats?.totalTimeMs ?? -1;
        const tb = b.stats?.totalTimeMs ?? -1;
        return tb - ta;
      });

      setDomains(sorted);
      setTotalTimeMs(sorted.reduce((sum, d) => sum + (d.stats?.totalTimeMs ?? 0), 0));
    } catch (e) {
      console.error("[Stats] Failed to load domain data:", e);
      setError("Failed to load data. Check the browser console for details.");
    } finally {
      setLoading(false);
    }
  };

  const sortedDomains = [...domains].sort((a, b) => {
    if (sortBy === "time") {
      return (b.stats?.totalTimeMs ?? -1) - (a.stats?.totalTimeMs ?? -1);
    }
    return b.eventCount - a.eventCount;
  });

  const maxTime = Math.max(1, ...sortedDomains.map((d) => d.stats?.totalTimeMs ?? 0));

  const toggleDomain = (domain: string) => {
    setExpandedDomain((prev) => (prev === domain ? null : domain));
  };

  return (
    <div className="stats-page">
      <header className="stats-page__header">
        <div className="stats-page__header-inner">
          <div className="stats-page__wordmark">
            we were online
            <a
              href={browser.runtime.getURL("portrait.html")}
              target="_blank"
              rel="noopener noreferrer"
              className="stats-page__nav-link"
            >
              portrait
            </a>
          </div>
          <h1 className="stats-page__title">time spent</h1>
          {!loading && totalTimeMs > 0 && (
            <p className="stats-page__subtitle">
              {formatDuration(totalTimeMs)} tracked across{" "}
              {domains.filter((d) => d.stats?.totalTimeMs).length} domains
            </p>
          )}
        </div>
      </header>

      <main className="stats-page__main">
        {loading ? (
          <div className="stats-page__loading">
            <span>gathering your traces…</span>
          </div>
        ) : error ? (
          <div className="stats-page__empty">
            <p>{error}</p>
          </div>
        ) : domains.length === 0 ? (
          <div className="stats-page__empty">
            <p>no data collected yet.</p>
            <p className="stats-page__empty-hint">
              keep browsing — your internet portrait is building.
            </p>
          </div>
        ) : (
          <>
            <div className="stats-page__controls">
              <span className="stats-page__controls-label">sort by</span>
              <button
                className={`stats-page__sort-btn${sortBy === "time" ? " stats-page__sort-btn--active" : ""}`}
                onClick={() => setSortBy("time")}
              >
                time
              </button>
              <button
                className={`stats-page__sort-btn${sortBy === "visits" ? " stats-page__sort-btn--active" : ""}`}
                onClick={() => setSortBy("visits")}
              >
                activity
              </button>
            </div>

            <div className="stats-page__list">
              {sortedDomains.map((domain, i) => {
                const time = domain.stats?.totalTimeMs;
                const barWidth = time != null ? Math.max(2, (time / maxTime) * 100) : 0;
                const isExpanded = expandedDomain === domain.domain;
                const topPages =
                  isExpanded && domain.stats?.sessions
                    ? computeTopPages(domain.stats.sessions, TOP_PAGES)
                    : null;
                const hasPages =
                  !domain.loading && (domain.stats?.uniquePageCount ?? 0) > 0;

                return (
                  <div
                    key={domain.domain}
                    className={`domain-row${isExpanded ? " domain-row--expanded" : ""}`}
                  >
                    {/* Main domain row — clickable if it has page data */}
                    <div
                      className={`domain-row__main${hasPages ? " domain-row__main--clickable" : ""}`}
                      onClick={() => hasPages && toggleDomain(domain.domain)}
                      role={hasPages ? "button" : undefined}
                      aria-expanded={hasPages ? isExpanded : undefined}
                    >
                      <span className="domain-row__rank">{i + 1}</span>
                      <img
                        className="domain-row__favicon"
                        src={getFaviconUrl(domain.domain)}
                        alt=""
                        width={16}
                        height={16}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <div className="domain-row__body">
                        <div className="domain-row__top">
                          <span className="domain-row__name">{domain.domain}</span>
                          <div className="domain-row__right">
                            <span className="domain-row__time">
                              {domain.loading ? (
                                <span className="domain-row__time--loading">…</span>
                              ) : time != null ? (
                                formatDuration(time)
                              ) : (
                                <span className="domain-row__time--none">—</span>
                              )}
                            </span>
                            {hasPages && (
                              <span className="domain-row__chevron" aria-hidden>
                                {isExpanded ? "▾" : "▸"}
                              </span>
                            )}
                          </div>
                        </div>
                        {!domain.loading && barWidth > 0 && (
                          <div className="domain-row__bar-track">
                            <div
                              className="domain-row__bar"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        )}
                        <div className="domain-row__meta">
                          {domain.stats?.uniquePageCount != null && (
                            <span>{domain.stats.uniquePageCount} pages</span>
                          )}
                          <span>{formatLastVisit(domain.lastVisit)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Expanded pages list */}
                    {isExpanded && topPages && (
                      <div className="domain-row__pages">
                        {topPages.length === 0 ? (
                          <p className="domain-row__pages-empty">no page sessions recorded</p>
                        ) : (
                          <>
                            {topPages.map((page, pi) => {
                              const maxPageTime = topPages[0].totalTimeMs;
                              const pageBarWidth = Math.max(
                                2,
                                (page.totalTimeMs / maxPageTime) * 100,
                              );
                              return (
                                <div key={page.url} className="page-row">
                                  <span className="page-row__rank">{pi + 1}</span>
                                  <div className="page-row__body">
                                    <div className="page-row__top">
                                      <span
                                        className="page-row__path"
                                        title={page.url}
                                      >
                                        {page.path}
                                      </span>
                                      <span className="page-row__time">
                                        {formatDuration(page.totalTimeMs)}
                                      </span>
                                    </div>
                                    <div className="page-row__bar-track">
                                      <div
                                        className="page-row__bar"
                                        style={{ width: `${pageBarWidth}%` }}
                                      />
                                    </div>
                                    <span className="page-row__visits">
                                      {page.visitCount}{" "}
                                      {page.visitCount === 1 ? "visit" : "visits"}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="stats-page__note">
              time is measured from focus/blur events — only counts active browsing sessions
            </p>
          </>
        )}
      </main>
    </div>
  );
};

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<StatsPage />);
}
