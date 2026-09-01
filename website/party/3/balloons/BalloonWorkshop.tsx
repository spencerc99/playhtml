// ABOUTME: Renders the persistent shared balloon twisting table and released creations.
// ABOUTME: Converts explicit table gestures into bounded shared segment updates.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  usePlayContext,
  usePlayerIdentity,
  withSharedState,
} from "@playhtml/react";
import {
  PARTY_COLORS,
  createBalloonCreation,
  getBalloonKnots,
  getBalloonLobes,
  getDogSegments,
  getDriftPosition,
  getFlowerSegments,
  type BalloonSegment,
  type PartyIdentity,
  type WorkshopData,
} from "../partyState";
import { playPartySound } from "../partySound";
import "../party.scss";

const WORKSHOP_EVENT = "playhtml-party-3-workshop-event";

type SharedSetter<T> = (next: T | ((draft: T) => void)) => void;

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function SegmentShape({ segment }: { segment: BalloonSegment }) {
  return (
    <span
      className="workshop-segment__lobes"
      style={{
        transform: `translate(-50%, -50%) rotate(${segment.rotation}deg)`,
        filter: `hue-rotate(${segment.hue}deg) saturate(1.15)`,
      }}
    >
      {getBalloonLobes(segment).map((lobe, index) => (
        <i
          key={index}
          style={{
            width: lobe.width,
            height: lobe.height,
            marginLeft: lobe.marginLeft,
          }}
        />
      ))}
    </span>
  );
}

export function BalloonWorkshop() {
  const playerIdentity = usePlayerIdentity();
  const {
    isLoading,
    dispatchPlayEvent,
    registerPlayEventListener,
    removePlayEventListener,
  } = usePlayContext();
  const [eventLine, setEventLine] = useState(
    "the table is ready for its first balloon",
  );
  const [hint, setHint] = useState("");
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [now, setNow] = useState(Date.now());
  const tableRef = useRef<HTMLDivElement>(null);
  const setWorkshopData = useRef<SharedSetter<WorkshopData> | null>(null);
  const suppressSegmentClick = useRef<string | null>(null);

  const emitEvent = useCallback(
    (message: string) => {
      setEventLine(message);
      dispatchPlayEvent({ type: WORKSHOP_EVENT, eventPayload: { message } });
    },
    [dispatchPlayEvent],
  );

  useEffect(() => {
    const id = registerPlayEventListener(WORKSHOP_EVENT, {
      onEvent: (
        payload: { eventPayload: unknown } | { message?: string },
      ) => {
        if ("message" in payload && payload.message) {
          setEventLine(payload.message);
        }
      },
    });
    return () => removePlayEventListener(WORKSHOP_EVENT, id);
  }, [registerPlayEventListener, removePlayEventListener]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(timer);
  }, []);

  const identity: PartyIdentity | null = playerIdentity.pid
    ? {
        pid: playerIdentity.pid,
        name: playerIdentity.name?.trim() || "you",
        color: playerIdentity.color || PARTY_COLORS[0],
      }
    : null;
  const current = useRef({
    drag,
    emitEvent,
    eventLine,
    hint,
    now,
  });
  current.current = {
    drag,
    emitEvent,
    eventLine,
    hint,
    now,
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      setDrag((currentDrag) => {
        if (!currentDrag || !tableRef.current) return currentDrag;
        const rect = tableRef.current.getBoundingClientRect();
        return {
          ...currentDrag,
          x: Math.max(
            14,
            Math.min(
              rect.width - 14,
              event.clientX - rect.left - currentDrag.offsetX,
            ),
          ),
          y: Math.max(
            14,
            Math.min(
              rect.height - 14,
              event.clientY - rect.top - currentDrag.offsetY,
            ),
          ),
          moved:
            currentDrag.moved ||
            Math.hypot(
              event.clientX - currentDrag.startX,
              event.clientY - currentDrag.startY,
            ) > 4,
        };
      });
    };
    const onPointerUp = () => {
      setDrag((currentDrag) => {
        if (!currentDrag) return null;
        setWorkshopData.current?.((draft) => {
          const segment = draft.segmentsById[currentDrag.id];
          if (!segment) return;
          segment.x = currentDrag.x;
          segment.y = currentDrag.y;
        });
        suppressSegmentClick.current = currentDrag.moved
          ? currentDrag.id
          : null;
        if (currentDrag.moved) {
          window.setTimeout(() => {
            if (suppressSegmentClick.current === currentDrag.id) {
              suppressSegmentClick.current = null;
            }
          }, 0);
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !hoveredSegment) return;
      event.preventDefault();
      setWorkshopData.current?.((draft) => {
        const segment = draft.segmentsById[hoveredSegment];
        if (!segment) return;
        segment.twists = (segment.twists + 1) % 4;
        setHint(
          segment.twists
            ? "twisted · space again for more pinches"
            : "untwisted",
        );
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hoveredSegment]);

  const SharedWorkshop = useMemo(
    () =>
      withSharedState<WorkshopData, never, { identity: PartyIdentity }>(
        { defaultData: { segmentsById: {}, creationsById: {} } },
        ({ data, setData }, props) => {
          setWorkshopData.current = setData;
          const { drag, emitEvent, eventLine, hint, now } = current.current;
          const segments = Object.values(data.segmentsById);
          const creations = Object.values(data.creationsById);
          const knots = getBalloonKnots(segments);

          const replaceSegments = (
            nextSegments: BalloonSegment[],
            nextHint: string,
          ) => {
            setData((draft) => {
              Object.keys(draft.segmentsById).forEach(
                (id) => delete draft.segmentsById[id],
              );
              nextSegments.forEach((segment) => {
                draft.segmentsById[segment.id] = segment;
              });
            });
            setHint(nextHint);
          };

          const release = () => {
            if (segments.length === 0) {
              setHint("add a balloon first");
              return;
            }
            const id = createId("creation");
            const creation = createBalloonCreation(
              segments,
              props.identity,
              "creation",
              {
                x: 80 + Math.random() * Math.max(80, window.innerWidth - 300),
                y: 250 + Math.random() * 250,
              },
              Date.now(),
              id,
              Math.random() * 10_000,
            );
            setData((draft) => {
              draft.creationsById[id] = creation;
              Object.keys(draft.segmentsById).forEach(
                (segmentId) => delete draft.segmentsById[segmentId],
              );
            });
            setHint("");
            emitEvent(
              `${props.identity.name} let a balloon creation go · it drifts with the workshop now`,
            );
          };

          return (
            <main id="party-3-balloon-workshop" className="workshop-page">
              <header className="workshop-header">
                <div>
                  <strong>playhtml</strong>
                  <span>/ the balloon workshop</span>
                </div>
                <a href="/party/3/">← back to the party</a>
              </header>
              {creations.map((creation) => {
                const position = getDriftPosition(
                  creation.seed,
                  creation.createdAt,
                  now,
                  creation.x,
                  creation.y,
                  {
                    width: window.innerWidth,
                    height: Math.max(760, document.body.scrollHeight),
                  },
                );
                return (
                  <div
                    className="workshop-creation-position"
                    key={creation.id}
                    style={{
                      transform: `translate(${position.x}px, ${position.y}px)`,
                    }}
                  >
                    <button
                      className="workshop-creation"
                      type="button"
                      style={{
                        width: creation.width,
                        height: creation.height,
                        transform: `rotate(${position.tilt}deg)`,
                      }}
                      onClick={() => {
                        setData((draft) => {
                          delete draft.creationsById[creation.id];
                        });
                        playPartySound("pop", true);
                        emitEvent(
                          `someone popped ${creation.by.name}'s balloon creation · a moment of silence`,
                        );
                      }}
                      title={`a balloon creation twisted by ${creation.by.name}`}
                    >
                      {creation.parts.map((part) => (
                        <span
                          className="workshop-creation__part"
                          key={part.id}
                          style={{ left: part.x, top: part.y }}
                        >
                          <SegmentShape segment={part} />
                        </span>
                      ))}
                      {creation.knots.map((knot, index) => (
                        <i
                          className="workshop-knot"
                          key={index}
                          style={{ left: knot.x, top: knot.y }}
                        />
                      ))}
                    </button>
                    <small>
                      {creation.by.name}'s {creation.name}
                    </small>
                  </div>
                );
              })}
              <section className="workshop-hero">
                <h1>the twisting table</h1>
                <p>
                  every balloon animal is just balloons: <strong>drag</strong>{" "}
                  to move · <strong>click</strong> to inflate, alt-click to
                  deflate · <strong>scroll</strong> to stretch it long ·{" "}
                  <strong>double-click</strong> to turn it · hover +{" "}
                  <strong>spacebar</strong> to twist a pinch into it. touching
                  balloons knot together.
                </p>
              </section>
              <section className="workshop-table-card">
                <div
                  ref={tableRef}
                  className="workshop-table"
                  title="the table is shared · everyone sees your twisting"
                >
                  {segments.length === 0 && (
                    <p>the table is empty · add a balloon below</p>
                  )}
                  {segments.map((segment) => {
                    const dragged = drag?.id === segment.id ? drag : null;
                    const x = dragged?.x ?? segment.x;
                    const y = dragged?.y ?? segment.y;
                    return (
                      <button
                        className="workshop-segment"
                        key={segment.id}
                        type="button"
                        style={{ left: x, top: y }}
                        onPointerEnter={() => setHoveredSegment(segment.id)}
                        onPointerLeave={() =>
                          setHoveredSegment((current) =>
                            current === segment.id ? null : current,
                          )
                        }
                        onPointerDown={(
                          event: ReactPointerEvent<HTMLButtonElement>,
                        ) => {
                          if (!tableRef.current) return;
                          event.preventDefault();
                          const rect = tableRef.current.getBoundingClientRect();
                          setDrag({
                            id: segment.id,
                            x,
                            y,
                            offsetX: event.clientX - rect.left - x,
                            offsetY: event.clientY - rect.top - y,
                            startX: event.clientX,
                            startY: event.clientY,
                            moved: false,
                          });
                        }}
                        onClick={(event) => {
                          if (suppressSegmentClick.current === segment.id) {
                            suppressSegmentClick.current = null;
                            return;
                          }
                          setData((draft) => {
                            const current = draft.segmentsById[segment.id];
                            current.scale = Math.max(
                              0.45,
                              Math.min(
                                1.6,
                                current.scale + (event.altKey ? -0.15 : 0.15),
                              ),
                            );
                          });
                        }}
                        onDoubleClick={() => {
                          setData((draft) => {
                            const current = draft.segmentsById[segment.id];
                            current.scale = Math.max(0.45, current.scale - 0.3);
                            current.rotation = (current.rotation + 45) % 360;
                          });
                        }}
                        onWheel={(event) => {
                          event.preventDefault();
                          setData((draft) => {
                            const current = draft.segmentsById[segment.id];
                            current.length = Math.max(
                              0.7,
                              Math.min(
                                3.2,
                                current.length +
                                  (event.deltaY < 0 ? 0.12 : -0.12),
                              ),
                            );
                          });
                        }}
                      >
                        <SegmentShape segment={segment} />
                      </button>
                    );
                  })}
                  {knots.map((knot, index) => (
                    <i
                      className="workshop-knot"
                      key={index}
                      style={{ left: knot.x, top: knot.y }}
                    />
                  ))}
                </div>
                <div className="workshop-controls">
                  <button
                    className="phs-chip"
                    type="button"
                    onClick={() => {
                      const id = createId("segment");
                      const segment: BalloonSegment = {
                        id,
                        x: 60 + Math.random() * 300,
                        y: 60 + Math.random() * 180,
                        scale: 0.8 + Math.random() * 0.3,
                        hue: Math.floor(Math.random() * 360),
                        length: 1,
                        rotation: 0,
                        twists: 0,
                      };
                      setData((draft) => {
                        draft.segmentsById[id] = segment;
                      });
                      setHint(
                        segments.length >= 1
                          ? "drag them until they touch · a knot appears"
                          : "scroll to stretch it · hover + spacebar to twist",
                      );
                    }}
                  >
                    + add a balloon
                  </button>
                  <button
                    className="phs-btn-ink"
                    type="button"
                    onClick={release}
                  >
                    let it go
                  </button>
                  <button
                    className="phs-chip"
                    type="button"
                    onClick={() => replaceSegments([], "")}
                  >
                    start over
                  </button>
                  <button
                    className="phs-chip"
                    type="button"
                    onClick={() =>
                      replaceSegments(
                        getFlowerSegments(),
                        "here's how a flower is laid out · tweak it, then let it go",
                      )
                    }
                  >
                    lay out a flower
                  </button>
                  <button
                    className="phs-chip"
                    type="button"
                    onClick={() =>
                      replaceSegments(
                        getDogSegments(),
                        "here's how a dog is laid out · tweak it, then let it go",
                      )
                    }
                  >
                    lay out a dog
                  </button>
                  <span>{hint}</span>
                </div>
              </section>
              <p className="workshop-event-line">✳ {eventLine}</p>
              <footer className="workshop-footer">
                creations drift here through party week
              </footer>
            </main>
          );
        },
      ),
    [],
  );

  if (isLoading || !identity)
    return <main className="party-loading">inflating the room…</main>;
  return <SharedWorkshop identity={identity} />;
}
