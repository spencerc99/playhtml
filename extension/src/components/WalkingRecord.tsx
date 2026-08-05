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

function SiteFavicon({ entry }: { entry: TimeSpentEntry }) {
  const [failed, setFailed] = React.useState(false);

  if (!entry.faviconUrl || failed) {
    return (
      <span className="walking-record__site-favicon-fallback" aria-hidden="true">
        {entry.href ? entry.site.charAt(0).toLowerCase() : "···"}
      </span>
    );
  }

  return (
    <img
      className="walking-record__site-favicon"
      src={entry.faviconUrl}
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

function HoursSection({ record }: { record: WalkingRecord }) {
  return (
    <section className="walking-record__section">
      <div className="walking-record__section-heading">
        <h1>where the hours went</h1>
        <span>{record.totalTimeLabel} browsing</span>
      </div>
      <p className="walking-record__section-intro">{record.timeSpentIntro}</p>

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

      {record.timeSpent.length > 0 ? (
        <div className="walking-record__hours">
          {record.timeSpent.map((entry) => {
            const content = (
              <>
                <span className="walking-record__rank">{entry.rank}</span>
                <SiteFavicon entry={entry} />
                <div>
                  <div className="walking-record__hour-title">
                    <strong>{entry.site}</strong>
                    <span>{entry.time}</span>
                  </div>
                  <div className="walking-record__time-track">
                    <span
                      style={{
                        background: entry.hue,
                        width: `${entry.percentage}%`,
                      }}
                    />
                  </div>
                  <small>{entry.note}</small>
                </div>
              </>
            );

            return entry.href ? (
              <a href={entry.href} key={entry.site}>
                {content}
              </a>
            ) : (
              <div key={entry.site}>{content}</div>
            );
          })}
        </div>
      ) : (
        <EmptySection>
          time appears after a page has been in focus and then left.
        </EmptySection>
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

          <HoursSection record={record} />

          <section className="walking-record__section">
            <div className="walking-record__section-heading">
              <h2>how you traveled</h2>
              <span>
                top {record.departures.length} of {record.movementCount}{" "}
                movement
                {record.movementCount === 1 ? "" : "s"}
              </span>
            </div>
            <p className="walking-record__section-intro">
              some of the off-beaten paths and places you haven’t visited in a
              while
            </p>

            {record.departures.length > 0 ? (
              <div className="walking-record__departures">
                {record.departures.map((departure) => (
                  <a
                    className="walking-record__departure"
                    href={departure.toUrl}
                    key={`${departure.day}:${departure.to}`}
                  >
                    <TraceGraphic
                      paths={departure.tracePaths}
                      hue={departure.hue}
                      width={44}
                      height={44}
                      padding={4}
                      minimumSize={1.5}
                      maximumSize={3.2}
                    />
                    <div className="walking-record__departure-copy">
                      <div>
                        <span className="walking-record__day">
                          {departure.day}
                        </span>
                        <span
                          style={{
                            color: readablePaletteColor(departure.accentHue),
                          }}
                        >
                          {departure.verb}
                        </span>
                        <span>{departure.from}</span>
                        <span aria-hidden="true">→</span>
                        <strong>{departure.to}</strong>
                      </div>
                      {departure.note && <p>{departure.note}</p>}
                    </div>
                    <span className="walking-record__familiarity">
                      {departure.familiarity}
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <EmptySection>
                no departures were recorded. the quiet roads will appear here
                when you leave one of your usual places for somewhere
                unfamiliar.
              </EmptySection>
            )}

            <h2 className="walking-record__subheading">revisiting history</h2>
            <p className="walking-record__revisit-intro">
              places you knew well, ordered by familiarity and time away
            </p>
            {record.revisits.length > 0 ? (
              <div className="walking-record__revisit-ledger">
                {record.revisits.map((revisit) => (
                  <a href={revisit.href} key={revisit.site}>
                    <span
                      style={{ color: readablePaletteColor(revisit.hue) }}
                    >
                      {revisit.span}
                    </span>
                    <strong>{revisit.site}</strong>
                    <small>{revisit.memory}</small>
                  </a>
                ))}
              </div>
            ) : (
              <EmptySection>
                no familiar place has been quiet long enough to call you back
                yet.
              </EmptySection>
            )}
          </section>
        </>
      )}
    </main>
  );
}
