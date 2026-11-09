// ABOUTME: Renders the shared experiments index, as a full archive or the homepage shelf.
// ABOUTME: Both variants share the same click smudges and random-experiment picker.

import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PlayContext, withSharedState } from "@playhtml/react";
import "./ExperimentsArchive.scss";
import {
  TraceRetentionMs,
  buildRandomExperimentSequence,
  getExperimentTraceIndexesToRemove,
  pruneExperimentTraces,
  type ExperimentTrace,
} from "../utils/experimentsArchiveLogic";
import { experiments } from "../utils/experimentsCatalog";

interface ExperimentArchiveEntry {
  number: string;
  name: string;
  description: string;
  href?: string;
  image?: string;
  actionLabel?: string;
  institution?: string;
  date?: string;
  eventType?: string;
  recommended?: boolean;
}

interface ExperimentsArchiveData {
  traces: ExperimentTrace[];
}

interface RandomExperimentEvent {
  eventId: string;
  userId: string | null;
  color: string;
  sequence: string[];
  selectedNumber: string;
  selectedHref: string;
}

interface RandomizerDisplay {
  activeNumber: string | null;
  selectedNumber: string | null;
  color: string;
  clickerColors: string[];
  isFlashing: boolean;
}

const RandomExperimentEventType = "homepage-experiments-randomize";
const RandomExperimentFlashMs = 760;
const RandomExperimentLandingPauseMs = 130;
const TraceNavigationDelayMs = 700;

function getRandomExperimentStepDelay(index: number) {
  return 55 * index + index * index * 4;
}

function isRandomExperimentEvent(
  payload: unknown,
): payload is RandomExperimentEvent {
  if (!payload || typeof payload !== "object") return false;

  const event = payload as Partial<RandomExperimentEvent>;
  return (
    typeof event.eventId === "string" &&
    (typeof event.userId === "string" || event.userId === null) &&
    typeof event.color === "string" &&
    Array.isArray(event.sequence) &&
    event.sequence.every((number) => typeof number === "string") &&
    typeof event.selectedNumber === "string" &&
    typeof event.selectedHref === "string"
  );
}

const pastEvents: ExperimentArchiveEntry[] = [
  {
    number: "EV-01",
    name: "walking together",
    description: "Collaborative internet walk",
    href: "https://spencer.place/creation/walking-on-the-internet-together/",
    image: "/experiments/index-previews/event-walking.png",
    institution: "Rhizome",
    date: "Apr 30",
    actionLabel: "Read",
  },
  {
    number: "EV-02",
    name: "playhtml get-together",
    description: "Small gathering space for trying playhtml",
    institution: "TIAT",
    eventType: "Gathering",
  },
  {
    number: "EV-03",
    name: "neighborhood internets",
    description: "creating tiny social networks",
    institution: "If, Then",
    eventType: "Workshop",
  },
  {
    number: "EV-04",
    name: "neighborhood internets",
    description: "creating tiny social networks",
    href: "https://spencer.place/creation/neighborhood-internets-workshop/",
    image: "/experiments/index-previews/event-gray-area.png",
    institution: "Gray Area",
    date: "Aug 18",
    actionLabel: "Read",
  },
];

// The homepage shows only the recommended experiments.
const homeExperiments = experiments.filter(
  (experiment) => experiment.recommended,
);

function getTraceCoordinates(event: MouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const rawX = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
  return Math.min(0.92, Math.max(0.08, rawX));
}

function getTracePlacement(traceId: string) {
  let hash = 0;

  for (let index = 0; index < traceId.length; index += 1) {
    hash = (hash * 31 + traceId.charCodeAt(index)) % 997;
  }

  return {
    y: 24 + (hash % 52),
    rotate: (hash % 34) - 17,
  };
}

function ExperimentsArchiveRow({
  entry,
  isEvent = false,
  isRandomActive = false,
  isRandomSelected = false,
  randomizerColor,
  traces = [],
  onExperimentClick,
}: {
  entry: ExperimentArchiveEntry;
  isEvent?: boolean;
  isRandomActive?: boolean;
  isRandomSelected?: boolean;
  randomizerColor: string;
  traces?: ExperimentTrace[];
  onExperimentClick: (
    entry: ExperimentArchiveEntry,
    event: MouseEvent<HTMLElement>,
  ) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const now = Date.now();
  const rowClassName = `experiments-archive__row${
    isEvent ? " experiments-archive__row--event" : ""
  }${entry.recommended ? " experiments-archive__row--recommended" : ""}${
    entry.href ? "" : " experiments-archive__row--static"
  }${isRandomActive ? " experiments-archive__row--random-active" : ""}${
    isRandomSelected ? " experiments-archive__row--random-selected" : ""
  }`;
  const rowStyle = {
    "--randomizer-color": randomizerColor,
  } as CSSProperties;
  const metaItems = [entry.institution, entry.date ?? entry.eventType].filter(
    Boolean,
  );
  const content = (
    <>
      {!isEvent && traces.length > 0 ? (
        <span className="experiments-archive__fingerprints" aria-hidden="true">
          {traces.map((trace) => {
            const placement = getTracePlacement(trace.id);
            const age = Math.max(0, now - trace.createdAt);
            const opacity = Math.max(0.08, (1 - age / TraceRetentionMs) * 0.72);

            return (
              <i
                key={trace.id}
                style={
                  {
                    "--trace-color": trace.color,
                    "--trace-opacity": opacity,
                    "--trace-rotate": `${placement.rotate}deg`,
                    "--trace-x": `${trace.x * 100}%`,
                    "--trace-y": `${placement.y}%`,
                  } as CSSProperties
                }
              />
            );
          })}
        </span>
      ) : null}
      {entry.recommended ? (
        <span
          className="experiments-archive__recommend-star"
          aria-label="Recommended experiment"
          title="Recommended experiment"
        >
          ★
        </span>
      ) : null}
      <span className="experiments-archive__number">{entry.number}</span>
      <strong>{entry.name}</strong>
      <span className="experiments-archive__description">
        {entry.description}
        {metaItems.length > 0 ? (
          <small className="experiments-archive__meta">
            {metaItems.join(" / ")}
          </small>
        ) : null}
      </span>
      {entry.href && entry.actionLabel ? (
        <em>
          {entry.actionLabel} {"->"}
        </em>
      ) : (
        <em aria-label="No public creation page">archived</em>
      )}
      {entry.image && isHovered ? (
        <span className="experiments-archive__preview" aria-hidden="true">
          <img src={entry.image} alt="" loading="lazy" />
        </span>
      ) : null}
    </>
  );

  if (!entry.href) {
    return (
      <div
        className={rowClassName}
        style={rowStyle}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {content}
      </div>
    );
  }

  return (
    <a
      className={rowClassName}
      href={entry.href}
      style={rowStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(event) => {
        if (!isEvent) {
          onExperimentClick(entry, event);
        }
      }}
    >
      {content}
    </a>
  );
}

function TraceSmudges({ traces }: { traces: ExperimentTrace[] }) {
  const now = Date.now();

  return (
    <>
      {traces.map((trace) => {
        const placement = getTracePlacement(trace.id);
        const age = Math.max(0, now - trace.createdAt);
        const opacity = Math.max(0.08, (1 - age / TraceRetentionMs) * 0.72);

        return (
          <i
            key={trace.id}
            style={
              {
                "--trace-color": trace.color,
                "--trace-opacity": opacity,
                "--trace-rotate": `${placement.rotate}deg`,
                "--trace-x": `${trace.x * 100}%`,
                "--trace-y": `${placement.y}%`,
              } as CSSProperties
            }
          />
        );
      })}
    </>
  );
}

// The homepage shelf: a wall of names like /experiments. Smudges sit on the
// name people clicked, and hovering a name swaps the preview card.
function HomeExperimentName({
  entry,
  isLast,
  dotColor,
  isSelected,
  isRandomActive,
  isRandomSelected,
  randomizerColor,
  traces,
  onPreview,
  onExperimentClick,
}: {
  entry: ExperimentArchiveEntry;
  isLast: boolean;
  dotColor: string;
  isSelected: boolean;
  isRandomActive: boolean;
  isRandomSelected: boolean;
  randomizerColor: string;
  traces: ExperimentTrace[];
  onPreview: (number: string) => void;
  onExperimentClick: (
    entry: ExperimentArchiveEntry,
    event: MouseEvent<HTMLElement>,
  ) => void;
}) {
  const className = `ph-studio__name${isSelected ? " is-selected" : ""}${
    isRandomActive ? " is-random-active" : ""
  }${isRandomSelected ? " is-random-selected" : ""}`;

  return (
    <>
      <a
        className={className}
        href={entry.href}
        style={{ "--randomizer-color": randomizerColor } as CSSProperties}
        onMouseEnter={() => onPreview(entry.number)}
        onFocus={() => onPreview(entry.number)}
        onClick={(event) => onExperimentClick(entry, event)}
      >
        {traces.length > 0 ? (
          <span className="ph-studio__fingerprints" aria-hidden="true">
            <TraceSmudges traces={traces} />
          </span>
        ) : null}
        <span className="ph-studio__label">{entry.name}</span>
        {entry.recommended ? (
          <sup className="ph-studio__star" aria-label="favorite">
            {"\u2605"}
          </sup>
        ) : null}
      </a>
      {isLast ? null : (
        <span
          className="ph-studio__dot"
          aria-hidden="true"
          style={{ color: dotColor }}
        >
          {" \u25cf "}
        </span>
      )}
    </>
  );
}

const StudioDotColors = [
  "#e8a63a",
  "#b0306a",
  "#3a8fb7",
  "#c0373c",
  "#5c7c54",
  "#274b9e",
];

interface ExperimentsArchiveProps {
  variant?: "full" | "home";
}

const ExperimentsArchiveContent = withSharedState<
  ExperimentsArchiveData,
  any,
  ExperimentsArchiveProps
>(
  {
    defaultData: {
      traces: [],
    },
  },
  ({ data, setData }, { variant = "full" }) => {
    const {
      cursors,
      dispatchPlayEvent,
      getMyPlayerIdentity,
      isLoading,
      registerPlayEventListener,
      removePlayEventListener,
    } = useContext(PlayContext);
    const timeoutsRef = useRef<number[]>([]);
    const activeEventIdRef = useRef<string | null>(null);
    const clickerColorsRef = useRef<string[]>([]);
    const pendingNavigationEventIdsRef = useRef<Set<string>>(new Set());
    const [randomizer, setRandomizer] = useState<RandomizerDisplay>({
      activeNumber: null,
      selectedNumber: null,
      color: "#10d210",
      clickerColors: [],
      isFlashing: false,
    });
    const [previewNumber, setPreviewNumber] = useState<string>(
      homeExperiments[0]?.number ?? "",
    );
    const visibleTraces = useMemo(
      () => pruneExperimentTraces(data?.traces ?? [], Date.now()),
      [data?.traces],
    );
    const tracesByRow = useMemo(() => {
      const groupedTraces = new Map<string, ExperimentTrace[]>();

      for (const trace of visibleTraces) {
        groupedTraces.set(trace.rowId, [
          ...(groupedTraces.get(trace.rowId) ?? []),
          trace,
        ]);
      }

      return groupedTraces;
    }, [visibleTraces]);
    const myColor = cursors.color || "#10d210";
    const clearRandomizerTimers = useCallback(() => {
      for (const timeout of timeoutsRef.current) {
        window.clearTimeout(timeout);
      }

      timeoutsRef.current = [];
    }, []);
    const recordExperimentTrace = useCallback(
      (entry: ExperimentArchiveEntry, x: number) => {
        if (!entry.href) return;

        const now = Date.now();
        const trace: ExperimentTrace = {
          id: `${entry.number}-${now}-${Math.random().toString(36).slice(2)}`,
          rowId: entry.number,
          color: myColor,
          createdAt: now,
          x,
        };

        setData((draft) => {
          if (!Array.isArray(draft.traces)) {
            draft.traces = [];
          }

          const traces = draft.traces;
          const indexesToRemove = getExperimentTraceIndexesToRemove(
            traces,
            trace,
            now,
          );

          indexesToRemove.forEach((index) => {
            draft.traces.splice(index, 1);
          });
          draft.traces.push(trace);
        });
      },
      [myColor, setData],
    );
    const startRandomizer = useCallback(
      (event: RandomExperimentEvent, shouldNavigate: boolean) => {
        if (activeEventIdRef.current === event.eventId) return;

        activeEventIdRef.current = event.eventId;
        clearRandomizerTimers();
        const colors = Array.from(
          new Set([event.color, ...clickerColorsRef.current].filter(Boolean)),
        ).slice(0, 5);
        clickerColorsRef.current = colors;

        setRandomizer({
          activeNumber: event.sequence[0] ?? null,
          selectedNumber: null,
          color: event.color,
          clickerColors: colors,
          isFlashing: false,
        });

        event.sequence.forEach((number, index) => {
          const timeout = window.setTimeout(() => {
            setRandomizer((current) => ({
              ...current,
              activeNumber: number,
              selectedNumber: null,
              color: event.color,
              clickerColors: colors,
              isFlashing: false,
            }));
          }, getRandomExperimentStepDelay(index));

          timeoutsRef.current.push(timeout);
        });

        const finalStepIndex = Math.max(0, event.sequence.length - 1);
        const landingDelay =
          getRandomExperimentStepDelay(finalStepIndex) +
          RandomExperimentLandingPauseMs;
        const flashTimeout = window.setTimeout(() => {
          setRandomizer((current) => ({
            ...current,
            activeNumber: event.selectedNumber,
            selectedNumber: event.selectedNumber,
            isFlashing: true,
          }));
        }, landingDelay);
        const navigateTimeout = window.setTimeout(() => {
          if (shouldNavigate) {
            const selectedExperiment = experiments.find(
              (experiment) => experiment.number === event.selectedNumber,
            );

            if (selectedExperiment) {
              recordExperimentTrace(selectedExperiment, 0.86);
            }

            pendingNavigationEventIdsRef.current.delete(event.eventId);
            window.setTimeout(() => {
              window.location.href = event.selectedHref;
            }, TraceNavigationDelayMs);
          } else {
            setRandomizer((current) => ({
              ...current,
              activeNumber: null,
              selectedNumber: null,
              isFlashing: false,
            }));
            activeEventIdRef.current = null;
          }
        }, landingDelay + RandomExperimentFlashMs);

        timeoutsRef.current.push(flashTimeout, navigateTimeout);
      },
      [clearRandomizerTimers, recordExperimentTrace],
    );

    useEffect(() => {
      if (isLoading || !registerPlayEventListener || !removePlayEventListener) {
        return;
      }

      const listenerId = registerPlayEventListener(RandomExperimentEventType, {
        onEvent: (payload: unknown) => {
          if (
            !isRandomExperimentEvent(payload) ||
            payload.sequence.length === 0
          ) {
            return;
          }

          const myUserId = getMyPlayerIdentity()?.publicKey ?? null;
          startRandomizer(
            payload,
            payload.userId === myUserId ||
              pendingNavigationEventIdsRef.current.has(payload.eventId),
          );
        },
      });

      return () => {
        removePlayEventListener(RandomExperimentEventType, listenerId);
      };
    }, [
      isLoading,
      getMyPlayerIdentity,
      registerPlayEventListener,
      removePlayEventListener,
      startRandomizer,
    ]);

    useEffect(() => {
      return () => {
        clearRandomizerTimers();
      };
    }, [clearRandomizerTimers]);

    const handleExperimentClick = useCallback(
      (entry: ExperimentArchiveEntry, event: MouseEvent<HTMLElement>) => {
        recordExperimentTrace(entry, getTraceCoordinates(event));

        if (
          !entry.href ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        event.preventDefault();
        window.setTimeout(() => {
          window.location.href = entry.href!;
        }, TraceNavigationDelayMs);
      },
      [recordExperimentTrace],
    );

    const handleRandomExperiment = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();

        if (isLoading) return;

        const availableExperiments = (
          variant === "home" ? homeExperiments : experiments
        ).filter((experiment) => experiment.href);
        const selectedIndex = Math.floor(
          Math.random() * availableExperiments.length,
        );
        const sequence = buildRandomExperimentSequence(
          availableExperiments,
          selectedIndex,
        );
        const selectedExperiment = sequence.at(-1);

        if (!selectedExperiment?.href) return;

        const payload: RandomExperimentEvent = {
          eventId: `random-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          userId: getMyPlayerIdentity()?.publicKey ?? null,
          color: myColor,
          sequence: sequence.map((experiment) => experiment.number),
          selectedNumber: selectedExperiment.number,
          selectedHref: selectedExperiment.href,
        };

        pendingNavigationEventIdsRef.current.add(payload.eventId);
        dispatchPlayEvent({
          type: RandomExperimentEventType,
          eventPayload: payload,
        });
      },
      [dispatchPlayEvent, getMyPlayerIdentity, isLoading, myColor, variant],
    );

    if (variant === "home") {
      const shownNumber =
        randomizer.activeNumber ?? randomizer.selectedNumber ?? previewNumber;
      const shown =
        homeExperiments.find((entry) => entry.number === shownNumber) ??
        homeExperiments[0];

      return (
        <section
          className="ph-studio"
          id="experiments-index"
          aria-labelledby="experiments-archive-title"
        >
          <div className="ph-studio__head">
            <div className="ph-studio__title">
              <h2 id="experiments-archive-title">Experiments</h2>
              <span className="ph-hand">- spencer</span>
            </div>
            <p>
              My favorite playhtml experiments, testing what sharing space
              online can feel like. Hover a name to peek, click to go play.
            </p>
            <a href="/experiments/">all {experiments.length} experiments</a>
          </div>
          <div className="ph-studio__wall">
            <p className="ph-studio__names">
              {homeExperiments.map((experiment, index) => (
                <HomeExperimentName
                  entry={experiment}
                  key={experiment.number}
                  isLast={index === homeExperiments.length - 1}
                  dotColor={StudioDotColors[index % StudioDotColors.length]}
                  isSelected={shown?.number === experiment.number}
                  randomizerColor={randomizer.color}
                  traces={tracesByRow.get(experiment.number) ?? []}
                  isRandomActive={randomizer.activeNumber === experiment.number}
                  isRandomSelected={
                    randomizer.isFlashing &&
                    randomizer.selectedNumber === experiment.number
                  }
                  onPreview={setPreviewNumber}
                  onExperimentClick={handleExperimentClick}
                />
              ))}
            </p>
            {shown ? (
              <a
                className="ph-studio__card"
                href={shown.href}
                onClick={(event) => handleExperimentClick(shown, event)}
              >
                <span className="ph-studio__shot">
                  {shown.image ? (
                    <img
                      src={shown.image}
                      alt={`Screenshot of ${shown.name}`}
                      loading="lazy"
                    />
                  ) : null}
                </span>
                <span className="ph-studio__card-text">
                  <span className="ph-studio__number">{shown.number}</span>
                  <b>{shown.name}</b>
                  <span>{shown.description}</span>
                </span>
              </a>
            ) : null}
            <div className="ph-studio__foot">
              <div className="ph-studio__random">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={handleRandomExperiment}
                >
                  {!isLoading ? "random experiment" : "syncing..."}
                </button>
                <span className="ph-studio__clickers" aria-hidden="true">
                  {randomizer.clickerColors.map((color) => (
                    <i
                      key={color}
                      style={{ "--user-color": color } as CSSProperties}
                    />
                  ))}
                </span>
              </div>
              <span className="ph-hand">
                smudges = where people clicked, in their cursor color
              </span>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section
        className="experiments-archive"
        id="experiments-index"
        aria-labelledby="experiments-archive-title"
      >
        <div className="experiments-archive__header">
          <h2 id="experiments-archive-title">All Experiments</h2>
          <span>
            {experiments.length} experiments / {pastEvents.length} events
          </span>
        </div>
        <div className="experiments-archive__body">
          <div className="experiments-archive__table">
            <p className="experiments-archive__section-label">experiments</p>
            {experiments.map((experiment) => (
              <ExperimentsArchiveRow
                entry={experiment}
                key={experiment.number}
                randomizerColor={randomizer.color}
                traces={tracesByRow.get(experiment.number) ?? []}
                isRandomActive={randomizer.activeNumber === experiment.number}
                isRandomSelected={
                  randomizer.isFlashing &&
                  randomizer.selectedNumber === experiment.number
                }
                onExperimentClick={handleExperimentClick}
              />
            ))}
            <p className="experiments-archive__section-label">past events</p>
            {pastEvents.map((event) => (
              <ExperimentsArchiveRow
                entry={event}
                isEvent
                key={event.number}
                randomizerColor={randomizer.color}
                onExperimentClick={handleExperimentClick}
              />
            ))}
          </div>
        </div>
        <div className="experiments-archive__footer">
          <span>hover a row for a page preview</span>
          <span
            className="experiments-archive__random-users"
            aria-hidden="true"
          >
            {randomizer.clickerColors.map((color) => (
              <i
                key={color}
                style={{ "--user-color": color } as CSSProperties}
              />
            ))}
          </span>
          <button
            type="button"
            disabled={isLoading}
            onClick={handleRandomExperiment}
          >
            {!isLoading ? "random experiment" : "syncing..."}
          </button>
        </div>
      </section>
    );
  },
);

export default function ExperimentsArchive({
  variant = "full",
}: ExperimentsArchiveProps) {
  return <ExperimentsArchiveContent variant={variant} />;
}
