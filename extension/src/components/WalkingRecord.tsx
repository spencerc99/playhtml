// ABOUTME: Renders the phase-one walking record for the extension new-tab page.
// ABOUTME: Presents weekly departures, dormant familiar sites, and time spent from local data.

import React, { useMemo, useRef, useState } from "react";
import { captureDomPortrait } from "../utils/portraitExport";
import {
  formatDistance,
  type DayPlate,
  type Departure,
  type WalkingRecord,
} from "../history/walkingRecord";
import "./WalkingRecord.scss";

interface WalkingRecordPageProps {
  record: WalkingRecord | null;
  loading: boolean;
  error: string | null;
  portraitHref: string;
  onOpenCollections: () => void;
}

interface Stroke {
  path: string;
  opacity: number;
}

function seededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function plateStrokes(plate: DayPlate): Stroke[] {
  const random = seededRandom(plate.seed);
  const count = plate.strokeCount;

  return Array.from({ length: count }, (_, index) => {
    const progress = count <= 1 ? 1 : index / (count - 1);
    const opacity = 0.18 + progress * 0.45;

    if (plate.kind === "read") {
      const y = 10 + index * (38 / Math.max(count, 1)) + random() * 4;
      return {
        path: `M6 ${y.toFixed(1)} C 28 ${(y - 2 + random() * 5).toFixed(1)}, 52 ${(y + random() * 5).toFixed(1)}, 74 ${(y + random() * 3).toFixed(1)}`,
        opacity,
      };
    }

    if (plate.kind === "skim") {
      const x = 8 + index * (64 / Math.max(count, 1)) + random() * 4;
      return {
        path: `M${x.toFixed(1)} 6 C ${(x + 2).toFixed(1)} 22, ${(x - 2).toFixed(1)} 38, ${(x + 1).toFixed(1)} 52`,
        opacity,
      };
    }

    if (plate.kind === "dwell") {
      const centerX = 40 + random() * 8 - 4;
      const centerY = 28 + random() * 8 - 4;
      const radius = 4 + index * 2.4;
      return {
        path: `M${(centerX - radius).toFixed(1)} ${centerY.toFixed(1)} C ${(centerX - radius).toFixed(1)} ${(centerY - radius).toFixed(1)}, ${(centerX + radius).toFixed(1)} ${(centerY - radius).toFixed(1)}, ${(centerX + radius).toFixed(1)} ${centerY.toFixed(1)} S ${(centerX - radius).toFixed(1)} ${(centerY + radius).toFixed(1)}, ${(centerX - radius).toFixed(1)} ${centerY.toFixed(1)}`,
        opacity,
      };
    }

    if (plate.kind === "night") {
      return {
        path: `M${(8 + random() * 14).toFixed(1)} ${(40 + random() * 12).toFixed(1)} C 30 ${(20 + random() * 20).toFixed(1)}, 50 ${(20 + random() * 20).toFixed(1)}, ${(60 + random() * 14).toFixed(1)} ${(38 + random() * 14).toFixed(1)}`,
        opacity: 0.4 + progress * 0.35,
      };
    }

    return {
      path: `M${(4 + random() * 10).toFixed(1)} ${(6 + random() * 46).toFixed(1)} C ${(20 + random() * 20).toFixed(1)} ${(6 + random() * 46).toFixed(1)}, ${(40 + random() * 20).toFixed(1)} ${(6 + random() * 46).toFixed(1)}, ${(66 + random() * 10).toFixed(1)} ${(6 + random() * 46).toFixed(1)}`,
      opacity,
    };
  });
}

function DayPlateGraphic({ plate }: { plate: DayPlate }) {
  const strokes = useMemo(() => plateStrokes(plate), [plate]);

  return (
    <svg viewBox="0 0 80 58" role="img" aria-label={plate.vignette}>
      {strokes.map((stroke, index) => (
        <path
          key={index}
          d={stroke.path}
          fill="none"
          stroke={plate.hue}
          strokeWidth="1"
          opacity={stroke.opacity}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function departureTrail(departure: Departure): string {
  const random = seededRandom(
    [...departure.to].reduce((sum, character) => sum + character.charCodeAt(0), 0),
  );
  const startY = 10 + random() * 24;
  const endY = 10 + random() * 24;
  return `M6 ${startY.toFixed(1)} C 15 ${(6 + random() * 32).toFixed(1)}, 28 ${(6 + random() * 32).toFixed(1)}, 38 ${endY.toFixed(1)}`;
}

function WeeklyTexture({ record }: { record: WalkingRecord }) {
  const lines = useMemo(() => {
    const random = seededRandom(record.range.startTs);
    const totalMs = record.hourBuckets.reduce((sum, value) => sum + value, 0);
    const count = Math.min(180, Math.max(24, Math.round(totalMs / 900_000)));
    const weightedHours = record.hourBuckets.flatMap((value, hour) => {
      const weight = totalMs > 0 ? Math.max(1, Math.round((value / totalMs) * 100)) : 1;
      return Array.from({ length: weight }, () => hour);
    });
    const hues = ["#4a9a8a", "#c4724e", "#5b8db8", "#d4b85c", "#8b6b7f"];

    return Array.from({ length: count }, (_, index) => {
      const hour =
        weightedHours[Math.floor(random() * weightedHours.length)] ?? index % 24;
      return {
        x: ((hour + random()) / 24) * 720,
        width: 1 + random() * 5,
        height: 70 + random() * 140,
        hue: hues[(hour + index) % hues.length],
        opacity: 0.08 + random() * 0.12,
      };
    });
  }, [record]);

  return (
    <svg
      className="walking-record__portrait-texture"
      viewBox="0 0 720 220"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lines.map((line, index) => (
        <rect
          key={index}
          x={line.x}
          y={0}
          width={line.width}
          height={line.height}
          fill={line.hue}
          opacity={line.opacity}
        />
      ))}
    </svg>
  );
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return <div className="walking-record__empty">{children}</div>;
}

export function WalkingRecordPage({
  record,
  loading,
  error,
  portraitHref,
  onOpenCollections,
}: WalkingRecordPageProps) {
  const portraitRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const savePortrait = async () => {
    if (!portraitRef.current || !record || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await captureDomPortrait(
        portraitRef.current,
        `we-were-online-walking-record-${record.rangeLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`,
      );
    } catch (captureError) {
      console.error("[WalkingRecord] Could not save portrait:", captureError);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="walking-record">
      <header className="walking-record__header">
        <span className="walking-record__wordmark">we were online</span>
        <nav className="walking-record__nav" aria-label="Extension pages">
          <a href={portraitHref}>portrait</a>
          <button type="button" onClick={onOpenCollections}>
            collections
          </button>
          <span aria-current="page">walking record</span>
        </nav>
      </header>

      {loading && (
        <div className="walking-record__loading" role="status">
          gathering last week’s record…
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
          <div className="walking-record__portrait" ref={portraitRef}>
            <div className="walking-record__portrait-main">
              <WeeklyTexture record={record} />
              <div className="walking-record__portrait-content">
                <div className="walking-record__hero">
                  {record.totalTimeLabel}
                  <span>browsing</span>
                </div>
                <div className="walking-record__portrait-details">
                  <div className="walking-record__metrics">
                    <div>
                      <strong>
                        {record.cursorDistancePx > 0
                          ? formatDistance(record.cursorDistancePx)
                          : "0 m"}
                      </strong>
                      <span>moved</span>
                    </div>
                    <div>
                      <strong>{record.pageCount}</strong>
                      <span>pages</span>
                    </div>
                    <div>
                      <strong>{record.movementCount}</strong>
                      <span>departures</span>
                    </div>
                  </div>
                  <div className="walking-record__portrait-signature">
                    <span>we were online</span>
                    <time>{record.rangeLabel}</time>
                  </div>
                </div>
              </div>
            </div>
            <div className="walking-record__portrait-actions">
              <div>
                <span className="walking-record__active-period">◉ Week</span>
                <span className="walking-record__divider">|</span>
                <a href={portraitHref}>view portrait ↗</a>
              </div>
              <button type="button" onClick={savePortrait} disabled={saving}>
                {saving ? "saving…" : "↓ save image"}
              </button>
            </div>
          </div>
          {saveError && (
            <p className="walking-record__save-error" role="alert">
              The image could not be saved.
            </p>
          )}

          <section className="walking-record__section">
            <div className="walking-record__section-heading">
              <h1>how you traveled</h1>
              <span>
                top {record.departures.length} of {record.movementCount} movement
                {record.movementCount === 1 ? "" : "s"} last week
              </span>
            </div>
            <p className="walking-record__section-intro">
              some of the off-beaten paths and places you haven’t visited in a while
            </p>

            {record.departures.length > 0 ? (
              <div className="walking-record__departures">
                {record.departures.map((departure) => (
                  <a
                    className="walking-record__departure"
                    href={departure.toUrl}
                    key={`${departure.day}:${departure.to}`}
                  >
                    <svg viewBox="0 0 44 44" aria-hidden="true">
                      <path
                        d={departureTrail(departure)}
                        fill="none"
                        stroke={departure.hue}
                        strokeWidth="1.4"
                        opacity="0.6"
                      />
                      <circle cx="38" cy="18" r="2.4" fill={departure.hue} />
                    </svg>
                    <div className="walking-record__departure-copy">
                      <div>
                        <span className="walking-record__day">{departure.day}</span>
                        <span style={{ color: departure.hue }}>{departure.verb}</span>
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
                no departures were recorded. the quiet roads will appear here when you
                leave one of your usual places for somewhere unfamiliar.
              </EmptySection>
            )}

            <h2 className="walking-record__subheading">revisiting history</h2>
            {record.revisits.length > 0 ? (
              <>
                <div className="walking-record__revisit-heroes">
                  {record.revisits.slice(0, 2).map((revisit) => (
                    <a href={revisit.href} key={revisit.site}>
                      <div>
                        it’s been <span style={{ color: revisit.hue }}>{revisit.span}</span>
                      </div>
                      <p>
                        since you visited <strong>{revisit.site}</strong>
                      </p>
                      <small>{revisit.memory}</small>
                    </a>
                  ))}
                </div>
                {record.revisits.length > 2 && (
                  <div className="walking-record__revisit-ledger">
                    {record.revisits.slice(2).map((revisit) => (
                      <a href={revisit.href} key={revisit.site}>
                        <span style={{ color: revisit.hue }}>{revisit.span}</span>
                        <strong>{revisit.site}</strong>
                        <small>{revisit.memory}</small>
                      </a>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <EmptySection>
                no familiar place has been quiet long enough to call you back yet.
              </EmptySection>
            )}
          </section>

          <section className="walking-record__section">
            <div className="walking-record__section-heading">
              <h2>where the hours went</h2>
              <span>{record.totalTimeLabel} online last week</span>
            </div>
            <p className="walking-record__section-intro">{record.timeSpentIntro}</p>

            <div className="walking-record__day-plates">
              {record.dayPlates.map((plate) => (
                <div className="walking-record__day-plate" key={plate.date}>
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
                      <span
                        className="walking-record__site-color"
                        style={{ background: entry.hue }}
                      />
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
        </>
      )}
    </main>
  );
}
