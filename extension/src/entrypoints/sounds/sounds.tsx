// ABOUTME: Renders the local internet sounds portrait and compressed day timeline.
// ABOUTME: Loads stored sound events and clips, schedules playback, and exposes demo seeding.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import type { CollectionEvent, SoundEventData } from "../../collectors/types";
import { SampleEngine } from "../../sound/SampleEngine";
import "../../styles/options.scss";
import "./sounds.scss";
import { seedSoundDemoData } from "./seedData";
import {
  DEFAULT_DAY_PLAYBACK_DURATION_MS,
  dayTimeToPlaybackMs,
  deriveSoundDays,
  findSoundEventsInPlaybackRange,
  getDayBounds,
  getSoundPlayTime,
  playbackMsToDayTime,
} from "./timeline";

interface SoundClipMetadata {
  id: string;
  domain: string;
  mimeType: string;
  sizeBytes: number;
}

interface SoundCollection {
  domain: string;
  events: CollectionEvent[];
  clipIds: string[];
}

const READOUT_UPDATE_INTERVAL_MS = 80;

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

async function loadClipArrayBuffer(clipId: string): Promise<ArrayBuffer> {
  const response = await browser.runtime.sendMessage({
    type: "GET_SOUND_CLIP",
    id: clipId,
  });
  if (!response?.success || typeof response.clip?.dataBase64 !== "string") {
    throw new Error(`Sound clip ${clipId} is unavailable.`);
  }
  return decodeBase64(response.clip.dataBase64);
}

function getEventDomain(event: CollectionEvent): string {
  if (event.domain) return event.domain;
  try {
    return new URL(event.meta.url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) return "unknown";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function formatDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${day}T12:00:00`));
}

function formatPlaybackTime(
  playbackMs: number,
  day: string,
  playbackDurationMs: number,
): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(
    playbackMsToDayTime(
      playbackMs,
      getDayBounds(day),
      playbackDurationMs,
    ),
  );
}

const SoundsPage = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<CollectionEvent[]>([]);
  const [clips, setClips] = useState<SoundClipMetadata[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [playbackDurationMs, setPlaybackDurationMs] = useState(
    DEFAULT_DAY_PLAYBACK_DURATION_MS,
  );
  const [playbackReadoutMs, setPlaybackReadoutMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [devFeaturesEnabled, setDevFeaturesEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef(0);
  const engineRef = useRef<SampleEngine | null>(null);

  if (!engineRef.current) {
    engineRef.current = new SampleEngine(loadClipArrayBuffer);
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventResponse, clipResponse] = await Promise.all([
        browser.runtime.sendMessage({ type: "QUERY_SOUND_EVENTS" }),
        browser.runtime.sendMessage({ type: "QUERY_SOUND_CLIPS" }),
      ]);
      if (!eventResponse?.success || !Array.isArray(eventResponse.events)) {
        throw new Error("Could not load local sound events.");
      }
      setEvents(eventResponse.events as CollectionEvent[]);
      setClips(
        clipResponse?.success && Array.isArray(clipResponse.clips)
          ? (clipResponse.clips as SoundClipMetadata[])
          : [],
      );
      const days = deriveSoundDays(eventResponse.events as CollectionEvent[]);
      setSelectedDay((current) =>
        current && days.includes(current) ? current : (days[0] ?? null),
      );
    } catch (loadError) {
      console.error("[Sounds] Failed to load sound data:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load local sound events.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    browser.storage.local
      .get("internalDevFeaturesEnabled")
      .then((result) =>
        setDevFeaturesEnabled(result.internalDevFeaturesEnabled === true),
      )
      .catch(() => setDevFeaturesEnabled(false));
  }, [loadData]);

  useEffect(() => {
    return () => engineRef.current?.dispose();
  }, []);

  const days = useMemo(() => deriveSoundDays(events), [events]);
  const selectedDayIndex = selectedDay ? days.indexOf(selectedDay) : -1;
  const dayEvents = useMemo(() => {
    return [...selectedEvents].sort(
      (a, b) => getSoundPlayTime(a) - getSoundPlayTime(b),
    );
  }, [selectedEvents]);
  const dayBounds = useMemo(
    () => (selectedDay ? getDayBounds(selectedDay) : null),
    [selectedDay],
  );
  const storedClipIds = useMemo(
    () => new Set(clips.map((clip) => clip.id)),
    [clips],
  );
  const collections = useMemo(() => {
    const byDomain = new Map<string, CollectionEvent[]>();
    for (const event of dayEvents) {
      const domain = getEventDomain(event);
      const domainEvents = byDomain.get(domain) ?? [];
      domainEvents.push(event);
      byDomain.set(domain, domainEvents);
    }
    return Array.from(byDomain, ([domain, domainSoundEvents]) => ({
      domain,
      events: domainSoundEvents,
      clipIds: Array.from(
        new Set(
          domainSoundEvents
            .map((event) => (event.data as SoundEventData).clipId)
            .filter(
              (clipId): clipId is string =>
                typeof clipId === "string" && storedClipIds.has(clipId),
            ),
        ),
      ),
    })).sort((a, b) => b.events.length - a.events.length) as SoundCollection[];
  }, [dayEvents, storedClipIds]);

  useEffect(() => {
    if (!selectedDay) {
      setSelectedEvents([]);
      return;
    }
    setSelectedEvents([]);
    const bounds = getDayBounds(selectedDay);
    browser.runtime
      .sendMessage({
        type: "QUERY_SOUND_EVENTS",
        startTs: bounds.startMs,
        endTs: bounds.endMs,
      })
      .then((response) => {
        if (!response?.success || !Array.isArray(response.events)) {
          throw new Error("Could not load sounds for the selected day.");
        }
        setSelectedEvents(response.events as CollectionEvent[]);
      })
      .catch((rangeError) => {
        console.error("[Sounds] Failed to load selected day:", rangeError);
        setSelectedEvents([]);
        setError(
          rangeError instanceof Error
            ? rangeError.message
            : "Could not load sounds for the selected day.",
        );
      });
  }, [selectedDay]);

  const updatePlayhead = useCallback(
    (playbackMs: number, updateReadout = true) => {
      const clamped = Math.max(
        0,
        Math.min(playbackDurationMs, playbackMs),
      );
      playbackRef.current = clamped;
      if (playheadRef.current) {
        playheadRef.current.style.left = `${
          (clamped / playbackDurationMs) * 100
        }%`;
      }
      if (updateReadout) setPlaybackReadoutMs(clamped);
    },
    [playbackDurationMs],
  );

  useEffect(() => {
    setPlaying(false);
    engineRef.current?.stopAll();
    playbackRef.current = 0;
    setPlaybackReadoutMs(0);
    if (playheadRef.current) playheadRef.current.style.left = "0%";
  }, [selectedDay]);

  useEffect(() => {
    if (!playing || !dayBounds) return;
    let animationFrame: number | undefined;
    let previousTimestamp: number | null = null;
    let lastReadoutUpdate = 0;

    const tick = (timestamp: number) => {
      if (previousTimestamp === null) {
        previousTimestamp = timestamp;
        animationFrame = requestAnimationFrame(tick);
        return;
      }
      const elapsedMs = Math.min(250, timestamp - previousTimestamp);
      previousTimestamp = timestamp;
      const previousPlaybackMs = playbackRef.current;
      const currentPlaybackMs = Math.min(
        playbackDurationMs,
        previousPlaybackMs + elapsedMs,
      );

      for (const event of findSoundEventsInPlaybackRange(
        dayEvents,
        dayBounds,
        playbackDurationMs,
        previousPlaybackMs,
        currentPlaybackMs,
      )) {
        const data = event.data as SoundEventData;
        if (!data.clipId || !storedClipIds.has(data.clipId)) continue;
        const dayProgress =
          (getSoundPlayTime(event) - dayBounds.startMs) / dayBounds.durationMs;
        void engineRef.current
          ?.playClip(data.clipId, {
            gain: 0.85,
            pan: Math.max(-0.9, Math.min(0.9, dayProgress * 1.8 - 0.9)),
          })
          .catch((playError) =>
            console.warn("[Sounds] Clip playback failed:", playError),
          );
      }

      updatePlayhead(
        currentPlaybackMs,
        timestamp - lastReadoutUpdate >= READOUT_UPDATE_INTERVAL_MS,
      );
      if (timestamp - lastReadoutUpdate >= READOUT_UPDATE_INTERVAL_MS) {
        lastReadoutUpdate = timestamp;
      }

      if (currentPlaybackMs >= playbackDurationMs) {
        setPlaybackReadoutMs(playbackDurationMs);
        setPlaying(false);
        return;
      }
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    };
  }, [
    dayBounds,
    dayEvents,
    playbackDurationMs,
    playing,
    storedClipIds,
    updatePlayhead,
  ]);

  const togglePlayback = async () => {
    if (playing) {
      setPlaying(false);
      engineRef.current?.stopAll();
      return;
    }
    if (playbackRef.current >= playbackDurationMs) updatePlayhead(0);
    try {
      await engineRef.current?.init();
      await engineRef.current?.resume();
      setPlaying(true);
    } catch (audioError) {
      setError(
        audioError instanceof Error
          ? audioError.message
          : "Audio playback could not start.",
      );
    }
  };

  const auditionClip = async (clipId: string) => {
    try {
      await engineRef.current?.init();
      await engineRef.current?.resume();
      await engineRef.current?.playClip(clipId, { gain: 0.9 });
    } catch (audioError) {
      setError(
        audioError instanceof Error
          ? audioError.message
          : "The sound clip could not play.",
      );
    }
  };

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const progress = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    engineRef.current?.stopAll();
    updatePlayhead(progress * playbackDurationMs);
  };

  const seedDemo = async () => {
    setSeeding(true);
    setError(null);
    try {
      await seedSoundDemoData();
      await loadData();
    } catch (seedError) {
      console.error("[Sounds] Failed to seed demo data:", seedError);
      setError(
        seedError instanceof Error
          ? seedError.message
          : "Demo sound data could not be created.",
      );
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="sounds-page">
      <header className="sounds-page__header">
        <div className="sounds-page__header-inner">
          <div className="sounds-page__wordmark">
            <span>we were online</span>
            <a href={browser.runtime.getURL("portrait.html")}>portrait</a>
          </div>
          <h1>Internet sounds</h1>
          <p>Scraps of sound collected across a day, played back as one score.</p>
        </div>
      </header>

      <main className="sounds-page__main">
        {error && <div className="sounds-page__error">{error}</div>}
        {loading ? (
          <div className="sounds-page__state">Loading local sounds...</div>
        ) : events.length === 0 ? (
          <div className="sounds-page__state sounds-page__state--empty">
            <h2>No sounds collected yet</h2>
            <p>
              Sound marks will appear here after pages play audio or video.
            </p>
            {devFeaturesEnabled && (
              <button
                className="sounds-page__seed-button"
                disabled={seeding}
                onClick={() => void seedDemo()}
              >
                {seeding ? "Building demo day..." : "Seed demo data"}
              </button>
            )}
          </div>
        ) : (
          <>
            <section className="day-controls" aria-label="Timeline controls">
              <div className="day-controls__date">
                <button
                  disabled={selectedDayIndex < 0 || selectedDayIndex >= days.length - 1}
                  onClick={() => setSelectedDay(days[selectedDayIndex + 1])}
                >
                  ← older
                </button>
                <strong>{selectedDay ? formatDay(selectedDay) : ""}</strong>
                <button
                  disabled={selectedDayIndex <= 0}
                  onClick={() => setSelectedDay(days[selectedDayIndex - 1])}
                >
                  newer →
                </button>
              </div>
              <div className="day-controls__playback">
                <button
                  className="day-controls__play"
                  onClick={() => void togglePlayback()}
                >
                  {playing ? "Pause" : "Play"}
                </button>
                <label>
                  <span>speed</span>
                  <select
                    value={playbackDurationMs}
                    onChange={(event) => {
                      const previousDuration = playbackDurationMs;
                      const nextDuration = Number(event.target.value);
                      const progress = playbackRef.current / previousDuration;
                      setPlaybackDurationMs(nextDuration);
                      playbackRef.current = progress * nextDuration;
                      setPlaybackReadoutMs(progress * nextDuration);
                      if (playheadRef.current) {
                        playheadRef.current.style.left = `${progress * 100}%`;
                      }
                    }}
                  >
                    <option value={180_000}>0.5×</option>
                    <option value={120_000}>0.75×</option>
                    <option value={90_000}>1×</option>
                    <option value={60_000}>1.5×</option>
                    <option value={45_000}>2×</option>
                  </select>
                  <output>{playbackDurationMs / 1000}s/day</output>
                </label>
                <span className="day-controls__readout">
                  {selectedDay
                    ? formatPlaybackTime(
                        playbackReadoutMs,
                        selectedDay,
                        playbackDurationMs,
                      )
                    : ""}
                </span>
              </div>
            </section>

            <section className="sound-score" aria-label="Sound timeline">
              <div
                className="sound-score__track"
                ref={timelineRef}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  seekFromPointer(event);
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    seekFromPointer(event);
                  }
                }}
              >
                <div className="sound-score__staff" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                {dayBounds &&
                  dayEvents.map((event, index) => {
                    const data = event.data as SoundEventData;
                    const eventTime = getSoundPlayTime(event);
                    const position =
                      ((eventTime - dayBounds.startMs) /
                        dayBounds.durationMs) *
                      100;
                    const hasClip =
                      typeof data.clipId === "string" &&
                      storedClipIds.has(data.clipId);
                    const height =
                      24 +
                      Math.min(
                        108,
                        Math.sqrt(data.clipDurationMs ?? 300) * 2.4,
                      );
                    return (
                      <span
                        className={`sound-mark ${
                          hasClip ? "" : "sound-mark--silent"
                        } ${data.detached ? "sound-mark--detached" : ""}`}
                        key={event.id}
                        style={{
                          left: `${position}%`,
                          height,
                          top: `${18 + (index % 5) * 25}px`,
                        }}
                        tabIndex={0}
                        onPointerDown={(pointerEvent) =>
                          pointerEvent.stopPropagation()
                        }
                      >
                        <span className="sound-mark__detail">
                          <strong>{getEventDomain(event)}</strong>
                          <span>{data.pageTitle ?? "Untitled page"}</span>
                          <span>
                            {new Date(eventTime).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                          <span>
                            {formatDuration(
                              data.clipDurationMs ?? data.mediaDurationMs,
                            )}
                          </span>
                          {data.detached && <b>detached</b>}
                          {!hasClip && <b>silent mark</b>}
                        </span>
                      </span>
                    );
                  })}
                <div className="sound-score__playhead" ref={playheadRef}>
                  <span />
                </div>
              </div>
              <div className="sound-score__axis" aria-hidden="true">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>24:00</span>
              </div>
              <div className="sound-score__summary">
                <span>{dayEvents.length} sound marks</span>
                <span>
                  {
                    dayEvents.filter((event) => {
                      const clipId = (event.data as SoundEventData).clipId;
                      return clipId && storedClipIds.has(clipId);
                    }).length
                  }{" "}
                  playable
                </span>
              </div>
            </section>

            <section className="sound-collection">
              <div className="sound-collection__heading">
                <h2>Collected sounds</h2>
                <span>{collections.length} domains</span>
              </div>
              <div className="sound-collection__grid">
                {collections.map((collection) => (
                  <article className="domain-sounds" key={collection.domain}>
                    <div>
                      <h3>{collection.domain}</h3>
                      <p>
                        {collection.events.length} plays ·{" "}
                        {collection.clipIds.length} clips
                      </p>
                    </div>
                    <div className="domain-sounds__clips">
                      {collection.clipIds.slice(0, 8).map((clipId, index) => (
                        <button
                          key={clipId}
                          title={`Audition clip ${index + 1} from ${collection.domain}`}
                          onClick={() => void auditionClip(clipId)}
                        >
                          <svg
                            viewBox="0 0 12 12"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M3 2.2 9.5 6 3 9.8Z" />
                          </svg>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                        </button>
                      ))}
                      {collection.clipIds.length === 0 && (
                        <span className="domain-sounds__none">
                          no stored clips
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Sounds page root element was not found.");
createRoot(rootElement).render(
  <React.StrictMode>
    <SoundsPage />
  </React.StrictMode>,
);
