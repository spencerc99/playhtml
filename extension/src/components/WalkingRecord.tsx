// ABOUTME: Renders the phase-one walking record for the extension new-tab page.
// ABOUTME: Presents period-specific departures, familiar sites, and time spent from local data.

import React from "react";
import {
  colorShade,
  readableTextLightness,
} from "@movement/utils/colorStyle";
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
import { ExtensionPageNav } from "./ExtensionPageNav";
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
  loadingProgress: {
    completed: number;
    total: number;
    message: string;
  };
  error: string | null;
}

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
    return (
      <span className="walking-record__site-favicon-fallback" aria-hidden="true">
        {muted ? "···" : site.charAt(0).toLowerCase()}
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

function periodTitle(
  period: WalkingRecordPeriod,
  timestamp: number,
): string {
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
        {atLatest ? <em>browsing to come ↦</em> : "later ↦"}
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
      <span>{entry.site}</span>
      <strong>{entry.time}</strong>
    </>
  );

  return entry.href ? (
    <a href={entry.href}>{content}</a>
  ) : (
    <div>{content}</div>
  );
}

function HowBrowsedSection({ record }: { record: WalkingRecord }) {
  return (
    <section className="walking-record__section">
      <div className="walking-record__section-heading">
        <h1>how you browsed</h1>
        <span>{record.totalTimeLabel} online this {record.period}</span>
      </div>
      <p className="walking-record__section-intro">{record.timeSpentIntro}</p>

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

      <div className="walking-record__subsection-heading">
        <h2>notable new exploration</h2>
        <span>
          {record.departures.length} shown from {record.movementCount}
        </span>
      </div>

      {record.departures.length > 0 ? (
        <div className="walking-record__departures">
          {record.departures.map((departure) => (
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
      ) : (
        <EmptySection>
          new explorations appear after you leave one of your usual places for
          a quieter corner of the web.
        </EmptySection>
      )}
    </section>
  );
}

function RevisitSection({ record }: { record: WalkingRecord }) {
  return (
    <section className="walking-record__section">
      <div className="walking-record__section-heading">
        <h2>where you used to visit</h2>
      </div>
      <p className="walking-record__section-intro">
        places you returned to across many days that you haven’t walked lately.
        the doors are still open.
      </p>
      {record.revisits.length > 0 ? (
        <div className="walking-record__revisit-ledger">
          {record.revisits.map((revisit) => (
            <a href={revisit.href} key={revisit.site}>
              <span style={{ color: readablePaletteColor(revisit.hue) }}>
                {revisit.span}
              </span>
              <strong>{revisit.site}</strong>
              <small>{revisit.memory}</small>
            </a>
          ))}
        </div>
      ) : (
        <EmptySection>
          no regularly visited place has been quiet long enough to call you
          back yet.
        </EmptySection>
      )}
    </section>
  );
}

function BrowsingPortraitsSection({ record }: { record: WalkingRecord }) {
  return (
    <section className="walking-record__section">
      <div className="walking-record__section-heading">
        <h2>browsing portraits</h2>
      </div>
      <p className="walking-record__section-intro">
        one small portrait from each {record.period === "week" ? "day" : "part"}.
      </p>
      <div
        className="walking-record__day-plates"
        data-period={record.period}
      >
        {record.dayPlates.map((plate) => (
          <div
            className={`walking-record__day-plate${
              plate.future ? " walking-record__day-plate--future" : ""
            }`}
            key={plate.date}
          >
            <DayPlateGraphic plate={plate} />
            <strong>{plate.day}</strong>
            <span>{plate.vignette}</span>
          </div>
        ))}
      </div>
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

          <HowBrowsedSection record={record} />
          <RevisitSection record={record} />
          <BrowsingPortraitsSection record={record} />
        </>
      )}
    </main>
  );
}
