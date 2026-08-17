// ABOUTME: Renders the phase-one walking record for the extension new-tab page.
// ABOUTME: Presents period-specific exploration, settled places, and time spent from local data.

import React from "react";
import browser from "webextension-polyfill";
import { colorShade, readableTextLightness } from "@movement/utils/colorStyle";
import { buildFreehandPathSegment } from "@movement/utils/trailAnimation";
import { roundPathCorners } from "@movement/utils/styleUtils";
import {
  type DayPlate,
  type WalkingRecord,
  type WalkingRecordPeriod,
  type WalkingRecordPeriodSummary,
  type TimeSpentEntry,
} from "../history/walkingRecord";
import type { WalkingRecordTracePoint } from "../storage/LocalEventStore";
import { portraitDayPath } from "../utils/portraitDay";
import { ExtensionPageNav } from "./ExtensionPageNav";
import { MovementLandscape } from "./MovementLandscape";
import { PortraitCard } from "./PortraitCard";
import "./WalkingRecord.scss";

interface WalkingRecordPageProps {
  record: WalkingRecord | null;
  period: WalkingRecordPeriod;
  periodOffset: number;
  periodSummaries: WalkingRecordPeriodSummary[];
  onPeriodChange: (period: WalkingRecordPeriod) => void;
  onPeriodOffsetChange: (offset: number) => void;
  loading: boolean;
  movementLoading: boolean;
  loadingProgress: {
    completed: number;
    total: number;
    message: string;
  };
  error: string | null;
}

const INITIAL_DEPARTURE_COUNT = 3;

function readablePaletteColor(color: string): string {
  return colorShade(color, readableTextLightness(color));
}

function fitTracePaths(
  paths: WalkingRecordTracePoint[][],
): WalkingRecordTracePoint[][] {
  const points = paths.flat();
  if (points.length < 2) return paths;

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const span = Math.max(maxX - minX, maxY - minY);
  if (span <= 0 || span >= 0.72) return paths;

  const scale = Math.min(5, 0.72 / span);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return paths.map((path) =>
    path.map((point) => ({
      x: 0.5 + (point.x - centerX) * scale,
      y: 0.5 + (point.y - centerY) * scale,
    })),
  );
}

function freehandTracePath(
  points: WalkingRecordTracePoint[],
  width: number,
  height: number,
  padding: number,
  minimumSize: number,
  maximumSize: number,
): string {
  if (points.length < 2) return "";

  const scaledPoints = points.map((point) => ({
    x: padding + point.x * (width - padding * 2),
    y: padding + point.y * (height - padding * 2),
  }));
  const roundedPoints = roundPathCorners(scaledPoints);

  let normalizedDistance = 0;
  for (let index = 1; index < points.length; index++) {
    normalizedDistance += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }

  const detailWeight = Math.min(1, Math.max(0, points.length - 2) / 18);
  const distanceWeight = Math.min(1, normalizedDistance / 1.2);
  const activityWeight = detailWeight * 0.55 + distanceWeight * 0.45;
  const size = minimumSize + (maximumSize - minimumSize) * activityWeight;

  return buildFreehandPathSegment(
    roundedPoints,
    0,
    roundedPoints.length - 1,
    size,
    true,
    undefined,
    {
      thinning: 0.55,
      simulatePressure: true,
      taper: size * 2.5,
    },
  );
}

function TraceGraphic({
  paths,
  hue,
  width,
  height,
  padding,
  minimumSize,
  maximumSize,
  label,
}: {
  paths: WalkingRecordTracePoint[][];
  hue: string;
  width: number;
  height: number;
  padding: number;
  minimumSize: number;
  maximumSize: number;
  label?: string;
}) {
  const fittedPaths = fitTracePaths(paths);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {fittedPaths.map((points, index) => (
        <path
          key={index}
          className="walking-record__trace"
          d={freehandTracePath(
            points,
            width,
            height,
            padding,
            minimumSize,
            maximumSize,
          )}
          fill={hue}
          opacity={0.5 + index * 0.16}
        />
      ))}
    </svg>
  );
}

function DayPlateGraphic({ plate }: { plate: DayPlate }) {
  if (plate.future) {
    return (
      <svg
        viewBox="0 0 80 58"
        role="img"
        aria-label={`${plate.day} portrait still to come`}
      >
        <path
          className="walking-record__future-trace"
          d="M 8 45 C 20 30, 31 33, 43 29 S 60 31, 72 14"
        />
      </svg>
    );
  }

  return (
    <TraceGraphic
      paths={plate.tracePaths}
      hue={plate.hue}
      width={80}
      height={58}
      padding={5}
      minimumSize={1.8}
      maximumSize={4.2}
      label={plate.vignette}
    />
  );
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return <div className="walking-record__empty">{children}</div>;
}

const LOADING_CURSOR_BODY =
  "M12 4 L12 16.5 L14.7 14 L16.7 18.5 L18.3 17.8 L16.3 13.4 L20 13.4 Z";

function LoadingCursor({
  className,
  color,
}: {
  className: string;
  color: string;
}) {
  return (
    <svg
      className={`walking-record__loading-cursor ${className}`}
      viewBox="0 0 24 24"
    >
      <path
        d={LOADING_CURSOR_BODY}
        fill={color}
        stroke="#f7f3ed"
        strokeLinejoin="round"
        strokeWidth="0.8"
      />
    </svg>
  );
}

function LoadingCursorWalk() {
  return (
    <div className="walking-record__loading-cursors" aria-hidden="true">
      <svg viewBox="0 0 320 64" preserveAspectRatio="none">
        <path
          className="walking-record__loading-route"
          d="M8 42 C54 10, 93 53, 137 27 S218 14, 260 36 S296 43, 312 17"
        />
      </svg>
      <LoadingCursor
        className="walking-record__loading-cursor--one"
        color="#4a9a8a"
      />
      <LoadingCursor
        className="walking-record__loading-cursor--two"
        color="#c87959"
      />
      <LoadingCursor
        className="walking-record__loading-cursor--three"
        color="#6f91b2"
      />
    </div>
  );
}

function SiteFavicon({
  faviconUrl,
  site,
  muted = false,
}: {
  faviconUrl?: string;
  site: string;
  muted?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);

  if (!faviconUrl || failed) {
    if (muted) {
      return (
        <svg
          className="walking-record__site-favicon-fallback walking-record__site-favicon-globe"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M1.75 8h12.5M8 1.75c2 1.7 3 3.8 3 6.25s-1 4.55-3 6.25C6 12.55 5 10.45 5 8s1-4.55 3-6.25Z" />
        </svg>
      );
    }

    return (
      <span
        className="walking-record__site-favicon-fallback"
        aria-hidden="true"
      >
        {site.charAt(0).toLowerCase()}
      </span>
    );
  }

  return (
    <img
      className="walking-record__site-favicon"
      src={faviconUrl}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function periodTitle(period: WalkingRecordPeriod, timestamp: number): string {
  const date = new Date(timestamp);
  if (period === "week") {
    return `week of ${date.toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  if (period === "month") {
    return `month of ${date.toLocaleDateString("en", {
      month: "long",
      year: "numeric",
    })}`;
  }
  return `year ${date.getFullYear()}`;
}

function periodIntensityHours(
  period: WalkingRecordPeriod,
  totalTimeMs: number,
): number {
  const periodWeeks = period === "week" ? 1 : period === "month" ? 4.35 : 52.18;
  return totalTimeMs / 3_600_000 / periodWeeks;
}

function PeriodNavigationRail({
  period,
  periodOffset,
  summaries,
  onSelect,
}: {
  period: WalkingRecordPeriod;
  periodOffset: number;
  summaries: WalkingRecordPeriodSummary[];
  onSelect: (offset: number) => void;
}) {
  const earliestOffset = summaries[0]?.offset ?? periodOffset;
  const atEarliest = periodOffset <= earliestOffset;
  const atLatest = periodOffset >= 0;

  return (
    <nav
      className="walking-record__period-rail"
      aria-label={`${period} history`}
    >
      <button
        className="walking-record__period-step walking-record__period-step--earlier"
        type="button"
        aria-label={`Earlier ${period}`}
        disabled={atEarliest}
        onClick={() => onSelect(periodOffset - 1)}
      >
        ↤ earlier
      </button>
      <div className="walking-record__period-dabs">
        {summaries.map((summary) => {
          const title = periodTitle(period, summary.range.startTs);
          const hours = periodIntensityHours(period, summary.totalTimeMs);
          const diameter = 4.5 + hours * 0.18;
          const opacity = Math.min(1, 0.3 + hours * 0.015);
          const selected = summary.offset === periodOffset;

          return (
            <button
              className="walking-record__period-dab"
              type="button"
              key={summary.range.startTs}
              title={title}
              aria-label={title}
              aria-pressed={selected}
              data-period-offset={summary.offset}
              onClick={() => onSelect(summary.offset)}
            >
              <span
                style={{
                  width: `${diameter}px`,
                  height: `${diameter}px`,
                  opacity: selected ? 1 : opacity,
                }}
              />
            </button>
          );
        })}
      </div>
      <button
        className="walking-record__period-step walking-record__period-step--later"
        type="button"
        aria-label={`Later ${period}`}
        disabled={atLatest}
        onClick={() => onSelect(periodOffset + 1)}
      >
        later ↦
      </button>
    </nav>
  );
}

function TimeSpentLegendEntry({ entry }: { entry: TimeSpentEntry }) {
  const content = (
    <>
      <SiteFavicon
        faviconUrl={entry.faviconUrl}
        site={entry.site}
        muted={!entry.href}
      />
      <span
        className="walking-record__time-legend-site"
        style={{ borderBottomColor: entry.hue }}
      >
        {entry.site}
      </span>
      <strong>{entry.time}</strong>
    </>
  );

  return entry.href ? <a href={entry.href}>{content}</a> : <div>{content}</div>;
}

function HowBrowsedSection({ record }: { record: WalkingRecord }) {
  const [showAllDepartures, setShowAllDepartures] = React.useState(false);
  const visibleDepartures = showAllDepartures
    ? record.departures
    : record.departures.slice(0, INITIAL_DEPARTURE_COUNT);

  return (
    <section className="walking-record__section">
      <div className="walking-record__section-heading">
        <h1>how you browsed</h1>
        <span>
          {record.totalTimeLabel} online this {record.period}
        </span>
      </div>

      {record.timeSpent.length > 0 ? (
        <div className="walking-record__time-spent">
          <div
            className="walking-record__time-stack"
            aria-label="Browsing time by site"
          >
            {record.timeSpent.map((entry) => (
              <span
                key={entry.site}
                title={`${entry.site}: ${entry.time}`}
                style={{
                  background: entry.hue,
                  width: `${entry.percentage}%`,
                }}
              />
            ))}
          </div>
          <div className="walking-record__time-legend">
            {record.timeSpent.map((entry) => (
              <TimeSpentLegendEntry entry={entry} key={entry.site} />
            ))}
          </div>
        </div>
      ) : (
        <EmptySection>
          time appears after a page has been in focus and then left.
        </EmptySection>
      )}

      {record.departures.length > 0 && (
        <>
          <div className="walking-record__subsection-heading">
            <h2>notable new exploration</h2>
            <span>
              {visibleDepartures.length} shown from {record.movementCount}
            </span>
          </div>
          <div className="walking-record__departures">
            {visibleDepartures.map((departure) => (
              <a
                className="walking-record__departure"
                href={departure.toUrl}
                key={`${departure.day}:${departure.to}`}
              >
                <span className="walking-record__day">{departure.day}</span>
                <div className="walking-record__departure-copy">
                  <div>
                    <SiteFavicon
                      faviconUrl={departure.fromFaviconUrl}
                      site={departure.from}
                    />
                    <span>{departure.from}</span>
                    <span aria-hidden="true">→</span>
                    <SiteFavicon
                      faviconUrl={departure.toFaviconUrl}
                      site={departure.to}
                    />
                    <strong>{departure.to}</strong>
                  </div>
                  {departure.note && <p>{departure.note}</p>}
                </div>
                <span className="walking-record__departure-time">
                  {departure.time}
                </span>
              </a>
            ))}
          </div>
          {record.departures.length > INITIAL_DEPARTURE_COUNT && (
            <button
              className="walking-record__departures-more"
              type="button"
              aria-expanded={showAllDepartures}
              onClick={() => setShowAllDepartures((visible) => !visible)}
            >
              {showAllDepartures ? "show less" : "show more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function SettledPlacesSection({ record }: { record: WalkingRecord }) {
  if (record.settledPlaces.length === 0) return null;

  return (
    <section className="walking-record__section">
      <div className="walking-record__section-heading">
        <h2>places you settled into</h2>
      </div>
      <p className="walking-record__section-intro">
        smaller places beyond your busiest roads where you spent time and came
        back.
      </p>
      <div className="walking-record__settled-ledger">
        {record.settledPlaces.map((place) => (
          <a href={place.href} key={place.site}>
            <span style={{ color: readablePaletteColor(place.hue) }}>
              {place.activeTime}
            </span>
            <div>
              <SiteFavicon faviconUrl={place.faviconUrl} site={place.site} />
              <strong title={place.site}>{place.site}</strong>
            </div>
            <small>{place.evidence}</small>
          </a>
        ))}
      </div>
    </section>
  );
}

function BrowsingPortraitsSection({
  record,
  movementLoading,
}: {
  record: WalkingRecord;
  movementLoading: boolean;
}) {
  return (
    <section className="walking-record__section">
      <div className="walking-record__section-heading">
        <h2>browsing portraits</h2>
        {movementLoading && <span role="status">restoring portrait trails…</span>}
      </div>
      <p className="walking-record__section-intro">
        one small portrait from each {record.period === "week" ? "day" : "part"}
        .
      </p>
      <div className="walking-record__day-plates" data-period={record.period}>
        {record.dayPlates.map((plate) => {
          const className = `walking-record__day-plate${
            plate.future ? " walking-record__day-plate--future" : ""
          }`;
          const content = (
            <>
              <DayPlateGraphic plate={plate} />
              <strong>{plate.day}</strong>
              <span>{plate.vignette}</span>
            </>
          );

          return plate.portraitDay ? (
            <a
              className={className}
              href={browser.runtime.getURL(portraitDayPath(plate.portraitDay))}
              title={`Open ${plate.day} portrait`}
              key={plate.date}
            >
              {content}
            </a>
          ) : (
            <div className={className} key={plate.date}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MovementLandscapeSection({
  record,
  movementLoading,
}: {
  record: WalkingRecord;
  movementLoading: boolean;
}) {
  if (record.landscapePaths.length === 0 && !movementLoading) return null;

  return (
    <section className="walking-record__section walking-record__movement-section">
      <div className="walking-record__section-heading">
        <h2>movement from this {record.period}</h2>
        {movementLoading && <span role="status">restoring movement…</span>}
      </div>
      {record.landscapePaths.length > 0 && (
        <MovementLandscape
          paths={record.landscapePaths}
          label={`Real cursor movements from this ${record.period}`}
        />
      )}
    </section>
  );
}

export function WalkingRecordPage({
  record,
  period,
  periodOffset,
  periodSummaries,
  onPeriodChange,
  onPeriodOffsetChange,
  loading,
  movementLoading,
  loadingProgress,
  error,
}: WalkingRecordPageProps) {
  const loadingPercentage = Math.round(
    (loadingProgress.completed / loadingProgress.total) * 100,
  );

  return (
    <main className="walking-record">
      <header className="walking-record__header">
        <ExtensionPageNav currentPage="walking-record" />
      </header>

      {loading && (
        <div className="walking-record__loading" role="status">
          <LoadingCursorWalk />
          <div className="walking-record__loading-copy">
            <span>{loadingProgress.message}</span>
            <span>{loadingPercentage}%</span>
          </div>
          <div
            className="walking-record__loading-track"
            role="progressbar"
            aria-label={`Loading ${period} record`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={loadingPercentage}
          >
            <span style={{ width: `${loadingPercentage}%` }} />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="walking-record__error" role="alert">
          <strong>the record could not be opened.</strong>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && record && (
        <>
          <div className="walking-record__portrait-shell">
            <div className="walking-record__portrait">
              <div className="walking-record__portrait-card">
                <PortraitCard
                  domain=""
                  scopeLabel={`your ${period}`}
                  totalTimeMs={record.totalTimeMs}
                  hourBuckets={record.hourBuckets}
                  cursorDistancePx={record.cursorDistancePx}
                  dateRange={null}
                  uniquePageCount={record.pageCount}
                />
              </div>
              <div
                className="walking-record__portrait-periods"
                aria-label="Browsing portrait period"
              >
                <div className="walking-record__period-options">
                  {(["week", "month", "year"] as const).map((period) => (
                    <button
                      type="button"
                      key={period}
                      aria-pressed={record.period === period}
                      onClick={() => onPeriodChange(period)}
                    >
                      {record.period === period && (
                        <span aria-hidden="true">◉</span>
                      )}
                      {period}
                    </button>
                  ))}
                </div>
                <div className="walking-record__period-navigation">
                  <span>{record.rangeLabel}</span>
                </div>
              </div>
            </div>
            <PeriodNavigationRail
              period={period}
              periodOffset={periodOffset}
              summaries={periodSummaries}
              onSelect={onPeriodOffsetChange}
            />
          </div>

          <HowBrowsedSection
            key={`${record.period}:${record.range.startTs}`}
            record={record}
          />
          <SettledPlacesSection record={record} />
          <BrowsingPortraitsSection
            record={record}
            movementLoading={movementLoading}
          />
          <MovementLandscapeSection
            record={record}
            movementLoading={movementLoading}
          />
        </>
      )}
    </main>
  );
}
