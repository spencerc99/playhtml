// ABOUTME: Renders the collaborative third-anniversary party room.
// ABOUTME: Connects persistent party artifacts, awareness, cursors, and transient play events.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  CanToggleElement,
  playhtml,
  usePlayContext,
  usePlayerIdentity,
  useUsers,
  withSharedState,
} from "@playhtml/react";
import {
  BITE_REQUIREMENT,
  CAKE_CELL_COUNT,
  PARTY_COLORS,
  canBiteCakeCell,
  getCakeBitePosition,
  getCakeCell,
  getCurrentPlace,
  getDriftPosition,
  isCakeCellFinished,
  type BalloonsData,
  type CakeData,
  type CardPattern,
  type PartyBalloon,
  type PartyData,
  type PartyIdentity,
  type PartyWish,
  type PopperAwareness,
  type WishesData,
} from "./partyState";
import { playPartySound, stopPartySound } from "./partySound";
import "./party.scss";

const ARRIVAL_KEY = "playhtml-party-3-arrived";
const SOUND_KEY = "playhtml-party-3-sound";
const PARTY_EVENT = "playhtml-party-3-event";
const POPPER_EVENT = "playhtml-party-3-popper";
const BALLOON_POP_EVENT = "playhtml-party-3-balloon-pop";
const CAKE_FINALE_EVENT = "playhtml-party-3-cake-finale";
const PARTY_ROOM_WIDTH = 3200;
const PARTY_ROOM_HEIGHT = 900;
const PARTY_CHROME_HEIGHT = 88;
const PARTY_TOAST_DURATION = 3200;
const PARTY_STATIONS = [
  {
    center: 460,
    label: "the cake",
  },
  {
    center: 1140,
    label: "the balloon stand",
  },
  {
    center: 1660,
    label: "the party popper",
  },
  {
    center: 2180,
    label: "the card pile",
  },
];
const CARD_COLORS = [
  "var(--ph-sage)",
  "var(--ph-ultramarine-wash)",
  "var(--ph-brick-wash)",
  "var(--ph-mustard-wash)",
];
const COLOR_NAMES: Record<string, string> = {
  "#274b9e": "ultramarine",
  "#c0373c": "brick red",
  "#e8a63a": "mustard",
  "#7a9574": "sage",
  "#ff0099": "neon pink",
  "var(--ph-sage)": "sage",
  "var(--ph-ultramarine-wash)": "pale blue",
  "var(--ph-brick-wash)": "pale red",
  "var(--ph-mustard-wash)": "pale mustard",
  "var(--ph-mustard)": "mustard",
  "var(--ph-ultramarine)": "ultramarine",
  "var(--ph-brick)": "brick red",
};
const SEAL_COLORS = [
  "var(--ph-mustard)",
  "var(--ph-ultramarine)",
  "var(--ph-brick)",
];

type PartyEffect = "confetti" | "popper" | "balloon-pop" | "cake-finale";

interface PartyEventPayload {
  message: string;
  effect?: PartyEffect;
}

type SharedSetter<T> = (next: T | ((draft: T) => void)) => void;

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function identityLabel(name: string | undefined) {
  return name?.trim() || "you";
}

function getRandomPartyColor(currentColor: string) {
  const choices = PARTY_COLORS.filter((choice) => choice !== currentColor);
  return choices[Math.floor(Math.random() * choices.length)] ?? PARTY_COLORS[0];
}

function getColorName(color: string) {
  return COLOR_NAMES[color.toLowerCase()] ?? "this color";
}

function clampCamera(value: number) {
  return Math.max(0, Math.min(1, value));
}

function isScrollableTarget(target: EventTarget | null) {
  let element = target instanceof HTMLElement ? target : null;
  while (element) {
    const styles = getComputedStyle(element);
    if (
      (/(auto|scroll)/.test(styles.overflowY) &&
        element.scrollHeight > element.clientHeight + 2) ||
      (/(auto|scroll)/.test(styles.overflowX) &&
        element.scrollWidth > element.clientWidth + 2)
    ) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

function getRoomPoint(clientX: number, clientY: number) {
  const room = document.getElementById("party-3-room-canvas");
  const rect = room?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) {
    return { x: clientX, y: clientY };
  }
  return {
    x: ((clientX - rect.left) / rect.width) * PARTY_ROOM_WIDTH,
    y: ((clientY - rect.top) / rect.height) * PARTY_ROOM_HEIGHT,
  };
}

function ColorChoices({
  label,
  colors,
  selectedColor,
  customColor,
  onChange,
  onCustomColorChange,
}: {
  label: string;
  colors: string[];
  selectedColor: string;
  customColor: string;
  onChange: (color: string) => void;
  onCustomColorChange: (color: string) => void;
}) {
  return (
    <span className="party-color-choices" role="group" aria-label={label}>
      <em>{label}</em>
      {colors.map((choice) => (
        <button
          key={choice}
          type="button"
          className={selectedColor === choice ? "is-selected" : ""}
          style={{ background: choice }}
          onClick={() => onChange(choice)}
          aria-label={`Use ${getColorName(choice)} for ${label}`}
          aria-pressed={selectedColor === choice}
        />
      ))}
      <label title={`Pick your own ${label} color`}>
        <input
          type="color"
          className={selectedColor === customColor ? "is-selected" : ""}
          value={customColor}
          onChange={(event) => onCustomColorChange(event.target.value)}
          aria-label={`Pick your own ${label} color`}
        />
      </label>
    </span>
  );
}

function ArrivalNametag({
  initialName,
  initialColor,
  onEnter,
}: {
  initialName: string;
  initialColor: string;
  onEnter: (name: string, color: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const [customColor, setCustomColor] = useState(initialColor);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="party-arrival"
      role="dialog"
      aria-modal="true"
      aria-labelledby="party-arrival-title"
    >
      <form
        className="party-nametag"
        onSubmit={(event) => {
          event.preventDefault();
          onEnter(name.trim(), color);
        }}
      >
        <div className="party-nametag__band">
          <p id="party-arrival-title">HELLO</p>
          <span>my name is</span>
        </div>
        <div className="party-nametag__body">
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={14}
            placeholder="your name"
            aria-label="Your name"
          />
          <div className="party-color-row" aria-label="Choose your party color">
            {PARTY_COLORS.map((choice) => (
              <button
                key={choice}
                type="button"
                className={choice === color ? "is-selected" : ""}
                style={{ background: choice }}
                onClick={() => setColor(choice)}
                aria-label={`Use ${getColorName(choice)}`}
                aria-pressed={choice === color}
              />
            ))}
            <button
              className="party-color-row__random"
              type="button"
              onClick={() =>
                setColor((current) => getRandomPartyColor(current))
              }
              aria-label="Choose a random party color"
              title="surprise me"
            >
              ↻
            </button>
            <label title="pick your own party color">
              <input
                type="color"
                className={
                  !PARTY_COLORS.some((choice) => choice === color)
                    ? "is-selected"
                    : ""
                }
                value={customColor}
                onChange={(event) => {
                  setCustomColor(event.target.value);
                  setColor(event.target.value);
                }}
                aria-label="Pick your own party color"
              />
            </label>
          </div>
          <button className="phs-btn-ink party-nametag__enter" type="submit">
            {name.trim() ? "join the party" : "slip in unnamed"}
          </button>
          <p className="party-nametag__note">
            your tag follows you around · everything you touch gets your name on
            it
          </p>
        </div>
      </form>
    </div>
  );
}

function Pennants() {
  const colors = [
    "var(--ph-sage-wash)",
    "#f0e3c0",
    "var(--ph-mustard)",
    "var(--ph-paper)",
  ];
  return (
    <div
      className="party-pennants"
      title="can-toggle · click a letter to make it glow"
    >
      {"playhtml is 3".split("").map((character, index) =>
        character === " " ? (
          <span className="party-pennants__space" key={`space-${index}`} />
        ) : (
          <CanToggleElement key={`${character}-${index}`}>
            {({ data }) => (
              <button
                id={`party-3-pennant-${index}`}
                className={`party-pennant ${data?.on ? "is-glowing" : ""}`}
                style={
                  {
                    "--flag-color": colors[index % colors.length],
                  } as React.CSSProperties
                }
                type="button"
                aria-label={`Toggle glow on ${character}`}
              >
                <span>{character}</span>
                <i />
              </button>
            )}
          </CanToggleElement>
        ),
      )}
    </div>
  );
}

function PresenceBalloons({ colors }: { colors: string[] }) {
  const visibleColors =
    colors.length > 0 ? colors.slice(0, 3) : [PARTY_COLORS[0]];
  return (
    <span className="presence-balloons" aria-hidden="true">
      {visibleColors.map((color, index) => (
        <i
          key={`${color}-${index}`}
          style={
            {
              "--presence-color": color,
              "--presence-delay": `${index * 0.65}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}

function PeopleChip({
  count,
  glyph,
  color,
  label,
  className = "",
}: {
  count: number;
  glyph: string;
  color: string;
  label: string;
  className?: string;
}) {
  return (
    <span className={`party-people-chip ${className}`}>
      <i style={{ background: color }}>{glyph}</i>
      <strong>{count}</strong>
      <span>{label}</span>
    </span>
  );
}

function Confetti({ effect }: { effect: PartyEffect | null }) {
  if (effect !== "confetti" && effect !== "popper" && effect !== "cake-finale")
    return null;
  return (
    <div className="party-confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, index) => (
        <i
          key={index}
          style={
            {
              left: `${(index * 137) % 100}%`,
              background: [
                "var(--ph-mustard)",
                "var(--ph-ultramarine)",
                "var(--ph-brick)",
                "var(--ph-sage-deep)",
              ][index % 4],
              animationDuration: `${2.4 + (index % 5) * 0.5}s`,
              animationDelay: `${(index % 7) * 0.4}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function CakeStation({
  identity,
  emitEvent,
  soundOn,
}: {
  identity: PartyIdentity;
  emitEvent: (message: string, effect?: PartyEffect) => void;
  soundOn: boolean;
}) {
  const current = useRef({ identity, emitEvent, soundOn });
  current.current = { identity, emitEvent, soundOn };
  const SharedCake = useMemo(
    () =>
      withSharedState<CakeData>(
        { defaultData: { cellsByIndex: {} } },
        ({ data, setData }) => {
          const { identity, emitEvent, soundOn } = current.current;
          const finishedCount = Array.from(
            { length: CAKE_CELL_COUNT },
            (_, index) => isCakeCellFinished(data.cellsByIndex, index),
          ).filter(Boolean).length;
          const participantTotals = new Map<
            string,
            PartyIdentity & { bites: number }
          >();
          Object.values(data.cellsByIndex).forEach((cell) => {
            Object.values(cell.bitesByParticipant).forEach((bite) => {
              const current = participantTotals.get(bite.pid);
              participantTotals.set(bite.pid, {
                pid: bite.pid,
                name: bite.name,
                color: bite.color,
                bites: (current?.bites ?? 0) + 1,
              });
            });
          });
          const credits = [...participantTotals.values()]
            .sort((a, b) => b.bites - a.bites)
            .slice(0, 6);
          const maxBites = Math.max(
            1,
            ...credits.map((credit) => credit.bites),
          );

          const biteCell = (
            index: number,
            event: React.MouseEvent<HTMLButtonElement>,
          ) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const column = index % 10;
            const row = Math.floor(index / 10);
            const useVerticalFraction =
              (column === 0 || column === 9) && row !== 0 && row !== 5;
            const clickFraction = useVerticalFraction
              ? (event.clientY - rect.top) / rect.height
              : (event.clientX - rect.left) / rect.width;
            let message = "";
            let didBite = false;
            let finishedCake = false;
            setData((draft) => {
              if (!canBiteCakeCell(draft.cellsByIndex, index)) {
                message =
                  "you can't reach the middle yet · the cake is eaten from the outside in";
                return;
              }
              const key = String(index);
              if (!draft.cellsByIndex[key]) {
                draft.cellsByIndex[key] = { bitesByParticipant: {} };
              }
              const cell = draft.cellsByIndex[key];
              if (cell.bitesByParticipant[identity.pid]) {
                message =
                  "you already bit this square · other guests finish it";
                return;
              }
              if (
                Object.keys(cell.bitesByParticipant).length >= BITE_REQUIREMENT
              )
                return;
              const position = getCakeBitePosition(
                draft.cellsByIndex,
                index,
                clickFraction,
              );
              cell.bitesByParticipant[identity.pid] = {
                ...identity,
                ...position,
              };
              const count = Object.keys(cell.bitesByParticipant).length;
              didBite = true;
              message =
                count >= BITE_REQUIREMENT
                  ? "you finished the square · crumbs and credits remain"
                  : `you bit a hole (${count}/${BITE_REQUIREMENT}) · ${BITE_REQUIREMENT - count} more to finish it`;
              finishedCake = Array.from(
                { length: CAKE_CELL_COUNT },
                (_, cellIndex) =>
                  isCakeCellFinished(draft.cellsByIndex, cellIndex),
              ).every(Boolean);
            });
            if (!message) return;
            if (didBite) playPartySound("bite", soundOn);
            emitEvent(message, finishedCake ? "cake-finale" : undefined);
          };

          return (
            <section
              id="party-3-cake"
              className="party-station party-station--cake"
            >
              <StationHeading number="1" color="var(--ph-brick)">
                help yourself to cake
              </StationHeading>
              <div className="party-card party-cake-card">
                <PeopleChip
                  count={participantTotals.size}
                  glyph="◕"
                  color="var(--ph-brick)"
                  label="people took a bite"
                  className="party-people-chip--corner party-cake__participants"
                />
                <div className="party-candles">
                  {[0, 1, 2].map((index) => (
                    <CanToggleElement key={index}>
                      {({ data: candle }) => (
                        <button
                          id={`party-3-candle-${index}`}
                          type="button"
                          title="can-toggle · blow it out"
                        >
                          <img
                            src={
                              candle?.on
                                ? "/party/3/assets/candle-off.png"
                                : "/party/3/assets/candle-on.gif"
                            }
                            alt={
                              candle?.on ? "Extinguished candle" : "Lit candle"
                            }
                          />
                        </button>
                      )}
                    </CanToggleElement>
                  ))}
                </div>
                <div className="party-cake">
                  {[
                    ["chocolate", "Chocolate cake"],
                    ["peach", "Peach cake"],
                    ["matcha", "Matcha cake"],
                    ["vanilla", "Vanilla funfetti cake"],
                    ["pecan", "Pecan praline cake"],
                    ["lemon", "Lemon cake"],
                  ].map(([flavor, alt]) => (
                    <img
                      key={flavor}
                      className={`party-cake__${flavor}`}
                      src={`/party/3/assets/cake-${flavor}.png`}
                      alt={alt}
                    />
                  ))}
                  <div className="party-cake__grid">
                    {Array.from({ length: CAKE_CELL_COUNT }, (_, index) => {
                      const cell = getCakeCell(data.cellsByIndex, index);
                      const bites = Object.values(cell.bitesByParticipant);
                      const finished = bites.length >= BITE_REQUIREMENT;
                      const reachable = canBiteCakeCell(
                        data.cellsByIndex,
                        index,
                      );
                      return (
                        <button
                          key={index}
                          className={`party-cake__cell ${finished ? "is-finished" : ""}`}
                          type="button"
                          onClick={(event) => biteCell(index, event)}
                          title={
                            finished
                              ? `finished by ${bites.map((bite) => bite.name).join(", ")}`
                              : reachable
                                ? `${bites.length}/${BITE_REQUIREMENT} bites`
                                : "can't reach this yet"
                          }
                        >
                          {finished ? (
                            <span className="party-cake__eaters">
                              {bites.map((bite) => bite.name).join(" · ")}
                            </span>
                          ) : (
                            bites.map((bite, biteIndex) => (
                              <i
                                className="party-cake__bite"
                                key={bite.pid}
                                style={
                                  {
                                    left: bite.x,
                                    top: bite.y,
                                    transform: `rotate(${(index * 47 + biteIndex * 111) % 360}deg)`,
                                    "--crumb-color": bite.color,
                                  } as React.CSSProperties
                                }
                                title={`a bite by ${bite.name}`}
                              >
                                <b />
                                <em />
                              </i>
                            ))
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {finishedCount === CAKE_CELL_COUNT && (
                  <div className="party-cake__plaque">
                    this cake was eaten square by square · august 2026
                  </div>
                )}
                <div className="party-cake__counter">
                  <span>
                    <strong>{CAKE_CELL_COUNT - finishedCount}</strong> of 60
                    squares left
                  </span>
                </div>
                {finishedCount === CAKE_CELL_COUNT && credits.length > 0 && (
                  <div className="party-cake__credits">
                    <strong>cake credits</strong>
                    {credits.map((credit) => (
                      <div key={credit.pid}>
                        <i style={{ background: credit.color }} />
                        <span>{credit.name}</span>
                        <b>
                          <i
                            style={{
                              width: `${(credit.bites / maxBites) * 100}%`,
                              background: credit.color,
                            }}
                          />
                        </b>
                        <small>{credit.bites} bites</small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        },
      ),
    [],
  );
  return <SharedCake />;
}

function StationHeading({
  number,
  color,
  children,
}: {
  number: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <h2 className="party-station-heading" style={{ color }}>
      <span style={{ background: color }}>{number}</span>
      {children}
    </h2>
  );
}

function BalloonShape({
  balloon,
  position,
  onPointerDown,
  onClick,
  popped,
  active,
}: {
  balloon: PartyBalloon;
  position: { x: number; y: number; tilt: number; scale?: number };
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  popped: boolean;
  active: boolean;
}) {
  return (
    <div
      className={`party-balloon-position ${active ? "is-dragging" : ""}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      {popped ? (
        <strong className="party-balloon-pop">pop!</strong>
      ) : (
        <button
          className="party-balloon"
          type="button"
          onPointerDown={onPointerDown}
          onClick={onClick}
          style={{
            transform: `scale(${position.scale ?? balloon.scale}) rotate(${position.tilt}deg)`,
            filter: `hue-rotate(${balloon.hue}deg) saturate(1.05)`,
          }}
          title={`a balloon tied by ${balloon.by.name}`}
          aria-label={`Balloon tied by ${balloon.by.name}. Drag it to Spencer to inflate it.`}
        >
          <i className="party-balloon__body" />
          <i className="party-balloon__highlight" />
          <i className="party-balloon__knot" />
          <i className="party-balloon__string" />
        </button>
      )}
    </div>
  );
}

function BalloonsStation({
  identity,
  emitEvent,
  soundOn,
}: {
  identity: PartyIdentity;
  emitEvent: (message: string, effect?: PartyEffect) => void;
  soundOn: boolean;
}) {
  const spencerRef = useRef<HTMLDivElement>(null);
  const [holdingPin, setHoldingPin] = useState<number | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    scale: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    blowing: boolean;
    moved: boolean;
  } | null>(null);
  const [now, setNow] = useState(Date.now());
  const setBalloonsData = useRef<SharedSetter<BalloonsData> | null>(null);
  const suppressBalloonClick = useRef<string | null>(null);
  const blowingSoundPlaying = useRef(false);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const current = useRef({
    drag,
    emitEvent,
    holdingPin,
    identity,
    now,
    soundOn,
  });
  current.current = { drag, emitEvent, holdingPin, identity, now, soundOn };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const shouldPlay = Boolean(drag?.blowing && soundOn);
    if (shouldPlay && !blowingSoundPlaying.current) {
      playPartySound("blow", true);
    } else if (!shouldPlay && blowingSoundPlaying.current) {
      stopPartySound("blow");
    }
    blowingSoundPlaying.current = shouldPlay;
  }, [drag?.blowing, soundOn]);

  useEffect(
    () => () => {
      stopPartySound("blow");
    },
    [],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      setDrag((currentDrag) => {
        if (!currentDrag) return null;
        const roomPoint = getRoomPoint(event.clientX, event.clientY);
        const x = roomPoint.x - currentDrag.offsetX;
        const y = roomPoint.y - currentDrag.offsetY;
        const spencer = spencerRef.current?.getBoundingClientRect();
        const mouth = spencer
          ? getRoomPoint(
              spencer.left + spencer.width * 0.56,
              spencer.top + spencer.height * 0.8,
            )
          : { x: -9999, y: -9999 };
        const blowing = Math.hypot(x + 30 - mouth.x, y + 40 - mouth.y) < 75;
        const nextDrag = {
          ...currentDrag,
          x,
          y,
          blowing,
          moved:
            currentDrag.moved ||
            Math.hypot(
              event.clientX - currentDrag.startX,
              event.clientY - currentDrag.startY,
            ) > 4,
          scale: blowing
            ? Math.min(1.8, currentDrag.scale + 0.013)
            : currentDrag.scale,
        };
        dragRef.current = nextDrag;
        return nextDrag;
      });
    };
    const onPointerUp = () => {
      const currentDrag = dragRef.current;
      if (!currentDrag) return;
      const shouldPop = currentDrag.scale > 1.75;
      setBalloonsData.current?.((draft) => {
        const balloon = draft.balloonsById[currentDrag.id];
        if (!balloon) return;
        balloon.x = currentDrag.x;
        balloon.y = currentDrag.y;
        balloon.scale = Math.min(1.75, currentDrag.scale);
        if (shouldPop) delete draft.balloonsById[currentDrag.id];
      });
      if (shouldPop) {
        playPartySound("pop", current.current.soundOn);
        current.current.emitEvent(
          "you overfilled a balloon · everyone heard it",
          "balloon-pop",
        );
      } else if (currentDrag.blowing) {
        current.current.emitEvent("spencer catches his breath");
      }
      suppressBalloonClick.current = currentDrag.moved ? currentDrag.id : null;
      if (currentDrag.moved) {
        window.setTimeout(() => {
          if (suppressBalloonClick.current === currentDrag.id) {
            suppressBalloonClick.current = null;
          }
        }, 0);
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const SharedBalloons = useMemo(
    () =>
      withSharedState<BalloonsData>(
        {
          id: "party-3-balloons-data",
          defaultData: { balloonsById: {}, pinClaimsByIndex: {} },
        },
        ({ data, setData }) => {
          setBalloonsData.current = setData;
          const { drag, emitEvent, holdingPin, identity, now, soundOn } =
            current.current;
          const balloons = Object.values(data.balloonsById);
          const participants = new Set(
            balloons.map((balloon) => balloon.by.pid),
          );
          const availablePins = [0, 1, 2].filter((index) => {
            const claim = data.pinClaimsByIndex[String(index)];
            return !claim || now - claim.claimedAt >= 20_000;
          });

          const tieBalloon = () => {
            const rect = spencerRef.current?.getBoundingClientRect();
            const tiePoint = rect
              ? getRoomPoint(rect.right, rect.top)
              : { x: 1160, y: 210 };
            const id = createId("balloon");
            const balloon: PartyBalloon = {
              id,
              by: identity,
              createdAt: Date.now(),
              seed: Math.random() * 10_000,
              x: tiePoint.x + 30 + Math.random() * 80,
              y: tiePoint.y - 40 + Math.random() * 100,
              scale: 0.55 + Math.random() * 0.15,
              hue: Math.floor(Math.random() * 360),
            };
            setData((draft) => {
              draft.balloonsById[id] = balloon;
            });
            emitEvent(
              "you tied a new balloon at the stand · it's small until spencer fills it",
            );
          };

          const popBalloon = (
            balloon: PartyBalloon,
            event: React.MouseEvent<HTMLButtonElement>,
          ) => {
            if (suppressBalloonClick.current === balloon.id) {
              suppressBalloonClick.current = null;
              return;
            }
            if (holdingPin !== null) {
              setData((draft) => {
                delete draft.balloonsById[balloon.id];
              });
              setHoldingPin(null);
              playPartySound("pop", soundOn);
              emitEvent(
                "pinned! the pop echoed through the party · the pin is spent",
                "balloon-pop",
              );
              return;
            }
            const nextScale = Math.max(
              0.5,
              balloon.scale + (event.altKey ? -0.15 : 0.15),
            );
            if (nextScale > 1.75) {
              setData((draft) => {
                delete draft.balloonsById[balloon.id];
              });
              playPartySound("pop", soundOn);
              emitEvent(
                "you popped a balloon · everyone heard it",
                "balloon-pop",
              );
              return;
            }
            setData((draft) => {
              draft.balloonsById[balloon.id].scale = nextScale;
            });
          };

          return (
            <>
              {balloons.map((balloon) => {
                const drift = getDriftPosition(
                  balloon.seed,
                  balloon.createdAt,
                  now,
                  balloon.x,
                  balloon.y,
                  {
                    width: PARTY_ROOM_WIDTH,
                    height: PARTY_ROOM_HEIGHT,
                  },
                );
                const currentDrag = drag?.id === balloon.id ? drag : null;
                return (
                  <BalloonShape
                    key={balloon.id}
                    balloon={balloon}
                    position={
                      currentDrag
                        ? {
                            x: currentDrag.x,
                            y: currentDrag.y,
                            tilt: 0,
                            scale: currentDrag.scale,
                          }
                        : drift
                    }
                    popped={false}
                    active={Boolean(currentDrag)}
                    onClick={(event) => popBalloon(balloon, event)}
                    onPointerDown={(event) => {
                      if (holdingPin !== null) return;
                      event.preventDefault();
                      const roomPoint = getRoomPoint(
                        event.clientX,
                        event.clientY,
                      );
                      const position = currentDrag ?? {
                        x: drift.x,
                        y: drift.y,
                        scale: balloon.scale,
                      };
                      const nextDrag = {
                        id: balloon.id,
                        x: position.x,
                        y: position.y,
                        scale: position.scale,
                        offsetX: roomPoint.x - position.x,
                        offsetY: roomPoint.y - position.y,
                        startX: event.clientX,
                        startY: event.clientY,
                        blowing: false,
                        moved: false,
                      };
                      dragRef.current = nextDrag;
                      setDrag(nextDrag);
                    }}
                  />
                );
              })}
              <section
                id="party-3-balloons"
                className="party-station party-station--balloons"
              >
                <StationHeading number="2" color="var(--ph-ultramarine)">
                  blow up a balloon
                </StationHeading>
                <div className="party-card party-balloon-card">
                  <div className="party-spencer">
                    <div ref={spencerRef} className="party-spencer__photo">
                      <img
                        src={
                          drag?.blowing
                            ? "/party/3/assets/spencer-blowing.png"
                            : "/party/3/assets/spencer-normal.png"
                        }
                        alt="Spencer on balloon duty"
                      />
                      {drag?.blowing && (
                        <span className="party-spencer__puffs">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </div>
                    <p>
                      {drag?.blowing ? "fwoooo…" : "spencer, on balloon duty"}
                    </p>
                  </div>
                  <div className="party-balloon-controls">
                    <p>
                      decorate with some balloons! Use spencer's mouth to blow
                      it up.
                    </p>
                    <div className="party-balloon-workbench">
                      <img
                        className="party-unblown-balloons"
                        src="/party/3/assets/unblown-balloon-pile.svg"
                        alt=""
                        aria-hidden="true"
                      />
                      <button
                        className="party-tie-balloon"
                        type="button"
                        onClick={tieBalloon}
                      >
                        <span>tie a balloon</span>
                        <small>pick one from the pile</small>
                      </button>
                      <span className="party-pins">
                        {availablePins.map((index) => (
                          <button
                            key={index}
                            type="button"
                            className={holdingPin === index ? "is-held" : ""}
                            style={{
                              transform: `rotate(${[24, -12, 38][index]}deg)`,
                            }}
                            onClick={() => {
                              if (holdingPin !== null) return;
                              setData((draft) => {
                                draft.pinClaimsByIndex[String(index)] = {
                                  participantId: identity.pid,
                                  claimedAt: Date.now(),
                                };
                              });
                              setHoldingPin(index);
                              emitEvent(
                                "you picked up a pin · the balloons are nervous",
                              );
                            }}
                            aria-label="Pick up a pin"
                          >
                            <i />
                            <b />
                          </button>
                        ))}
                      </span>
                      <small className="party-pin-hint">
                        {holdingPin === null
                          ? ""
                          : "click any balloon to pop it · one use"}
                      </small>
                    </div>
                  </div>
                  <PeopleChip
                    count={participants.size}
                    glyph="●"
                    color="var(--ph-ultramarine)"
                    label="people tied balloons"
                    className="party-people-chip--corner party-balloon__participants"
                  />
                </div>
              </section>
            </>
          );
        },
      ),
    [],
  );
  return <SharedBalloons />;
}

function CardBand({
  cardColor,
  sealColor,
  pattern,
}: {
  cardColor: string;
  sealColor: string;
  pattern: CardPattern;
}) {
  return (
    <div
      className={`party-wish__band party-wish__band--${pattern}`}
      style={
        {
          background: cardColor,
          "--seal-color": sealColor,
        } as React.CSSProperties
      }
    >
      <i />
      <b />
    </div>
  );
}

function WishesStation({
  identity,
  emitEvent,
  soundOn,
}: {
  identity: PartyIdentity;
  emitEvent: (message: string, effect?: PartyEffect) => void;
  soundOn: boolean;
}) {
  const [note, setNote] = useState("");
  const [cardColor, setCardColor] = useState("var(--ph-sage)");
  const [sealColor, setSealColor] = useState("var(--ph-mustard)");
  const [customCardColor, setCustomCardColor] = useState("#f2c4cf");
  const [customSealColor, setCustomSealColor] = useState("#7a9574");
  const [pattern, setPattern] = useState<CardPattern>("cross");
  const [composerOpen, setComposerOpen] = useState(false);
  const cardMakerButtonRef = useRef<HTMLButtonElement>(null);
  const cardMakerDialogRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!composerOpen) return;
    const room = document.getElementById("party-3-room");
    room?.setAttribute("inert", "");
    const focusFrame = window.requestAnimationFrame(() => {
      noteRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setComposerOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        cardMakerDialogRef.current?.querySelectorAll<HTMLElement>(
          'button, textarea, input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      room?.removeAttribute("inert");
      cardMakerButtonRef.current?.focus();
    };
  }, [composerOpen]);

  const current = useRef({
    cardColor,
    composerOpen,
    customCardColor,
    customSealColor,
    emitEvent,
    identity,
    note,
    pattern,
    sealColor,
    soundOn,
  });
  current.current = {
    cardColor,
    composerOpen,
    customCardColor,
    customSealColor,
    emitEvent,
    identity,
    note,
    pattern,
    sealColor,
    soundOn,
  };
  const SharedWishes = useMemo(
    () =>
      withSharedState<WishesData>(
        { defaultData: { wishesById: {} } },
        ({ data, setData }) => {
          const {
            cardColor,
            composerOpen,
            customCardColor,
            customSealColor,
            emitEvent,
            identity,
            note,
            pattern,
            sealColor,
            soundOn,
          } = current.current;
          const wishes = Object.values(data.wishesById).sort(
            (a, b) => a.createdAt - b.createdAt,
          );
          const participants = new Set(wishes.map((wish) => wish.pid));
          const signWish = () => {
            const trimmedNote = note.trim();
            if (!trimmedNote) return;
            const id = createId("wish");
            const wish: PartyWish = {
              ...identity,
              id,
              note: trimmedNote,
              cardColor,
              sealColor,
              pattern,
              when: "today",
              where: getCurrentPlace(),
              createdAt: Date.now(),
            };
            setData((draft) => {
              draft.wishesById[id] = wish;
            });
            setNote("");
            setComposerOpen(false);
            playPartySound("chime", soundOn);
            emitEvent("you signed a card for the pile · it stays for good");
          };
          return (
            <section
              id="party-3-wishes"
              className="party-station party-station--wishes"
            >
              <StationHeading number="3" color="var(--ph-sage-deep)">
                leave a wish
              </StationHeading>
              <div className="party-card party-wishes-card">
                <h3>the message pile</h3>
                <p>
                  {wishes.length === 0
                    ? "the pile is waiting. leave the first card."
                    : "everyone here left a card. add yours to the pile."}
                </p>
                <PeopleChip
                  count={participants.size}
                  glyph="✦"
                  color="var(--ph-sage-deep)"
                  label="people left wishes"
                  className="party-people-chip--corner party-wishes__participants"
                />
                <div className="party-wishes-pile">
                  {wishes.length === 0 && (
                    <div className="party-empty-note" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <span>your card starts the pile</span>
                    </div>
                  )}
                  {wishes.map((wish, index) => (
                    <article
                      className="party-wish"
                      key={wish.id}
                      style={{
                        transform: `rotate(${[-1.4, 0.9, -0.6, 1.5, -1.1][index % 5]}deg)`,
                      }}
                    >
                      <CardBand
                        cardColor={wish.cardColor}
                        sealColor={wish.sealColor}
                        pattern={wish.pattern}
                      />
                      <div className="party-wish__body">
                        <p>{wish.note}</p>
                        <strong>— {wish.name}</strong>
                        <small>
                          {wish.when} · {wish.where}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
                <button
                  ref={cardMakerButtonRef}
                  className="party-open-card-maker"
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setComposerOpen(true)}
                >
                  <strong>make a card</strong>
                  <span>choose the paper, seal, and band</span>
                </button>
              </div>
              {composerOpen &&
                createPortal(
                  <div
                    className="party-card-modal"
                    data-camera-ignore
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget) {
                        setComposerOpen(false);
                      }
                    }}
                  >
                    <div
                      ref={cardMakerDialogRef}
                      className="party-card-maker"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="party-card-maker-title"
                    >
                      <button
                        className="party-card-maker__close"
                        type="button"
                        aria-label="Close card maker"
                        onClick={() => setComposerOpen(false)}
                      >
                        ×
                      </button>
                      <div className="party-card-maker__heading">
                        <span>card table</span>
                        <h3 id="party-card-maker-title">make a card</h3>
                        <p>
                          leave something for the next person who wanders in.
                        </p>
                      </div>
                      <div className="party-signing-bench">
                        <div>
                          <label htmlFor="party-card-note">your message</label>
                          <textarea
                            ref={noteRef}
                            id="party-card-note"
                            value={note}
                            maxLength={120}
                            onChange={(event) => setNote(event.target.value)}
                            placeholder="write your anniversary wish"
                          />
                          <div className="party-card-options">
                            <ColorChoices
                              label="card"
                              colors={CARD_COLORS}
                              selectedColor={cardColor}
                              customColor={customCardColor}
                              onChange={setCardColor}
                              onCustomColorChange={(color) => {
                                setCustomCardColor(color);
                                setCardColor(color);
                              }}
                            />
                            <ColorChoices
                              label="seal"
                              colors={SEAL_COLORS}
                              selectedColor={sealColor}
                              customColor={customSealColor}
                              onChange={setSealColor}
                              onCustomColorChange={(color) => {
                                setCustomSealColor(color);
                                setSealColor(color);
                              }}
                            />
                            <span className="party-pattern-choices">
                              <em>band</em>{" "}
                              {(
                                ["cross", "sash", "polka"] as CardPattern[]
                              ).map((choice) => (
                                <button
                                  key={choice}
                                  className={
                                    pattern === choice ? "is-selected" : ""
                                  }
                                  type="button"
                                  onClick={() => setPattern(choice)}
                                  aria-label={choice}
                                >
                                  <CardBand
                                    cardColor="#f4efe5"
                                    sealColor="#1c1c1c"
                                    pattern={choice}
                                  />
                                </button>
                              ))}
                            </span>
                          </div>
                          <button
                            className="phs-btn-ink"
                            type="button"
                            disabled={!note.trim()}
                            onClick={signWish}
                          >
                            sign it and add it to the pile
                          </button>
                        </div>
                        <div className="party-wish-preview">
                          <article className="party-wish">
                            <CardBand
                              cardColor={cardColor}
                              sealColor={sealColor}
                              pattern={pattern}
                            />
                            <div className="party-wish__body">
                              <p>{note.trim() || "your wish goes here…"}</p>
                              <strong>— {identity.name}</strong>
                              <small>today · {getCurrentPlace()}</small>
                            </div>
                          </article>
                          <small>yours, before you sign it</small>
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body,
                )}
            </section>
          );
        },
      ),
    [],
  );
  return <SharedWishes />;
}

function PartyPopper({
  data,
  setData,
  awareness,
  setMyAwareness,
  identity,
  emitEvent,
  soundOn,
}: {
  data: PartyData;
  setData: (setter: PartyData | ((draft: PartyData) => void)) => void;
  awareness: PopperAwareness[];
  setMyAwareness: (awareness: PopperAwareness) => void;
  identity: PartyIdentity;
  emitEvent: (message: string, effect?: PartyEffect) => void;
  soundOn: boolean;
}) {
  const [charge, setCharge] = useState(0);
  const [holdId, setHoldId] = useState("");
  const [snapped, setSnapped] = useState(false);
  const [tease, setTease] = useState(
    "someone else has to be here for this one.",
  );
  const chargeRef = useRef(0);
  const holders = awareness.filter(
    (person) => person.holdingPopper && person.holdId,
  );
  const otherHolder = holders.find((person) => person.pid !== identity.pid);
  const lastPopperPair = useRef(data.lastPopperPair);
  lastPopperPair.current = data.lastPopperPair;
  const holding = holders.some(
    (person) => person.pid === identity.pid && person.holdId === holdId,
  );

  const release = useCallback(() => {
    setMyAwareness({ ...identity, holdingPopper: false, holdId: "" });
    setHoldId("");
    chargeRef.current = 0;
    setCharge(0);
  }, [identity, setMyAwareness]);

  const startHolding = useCallback(() => {
    if (holdId) return;
    const nextHoldId = createId("hold");
    setHoldId(nextHoldId);
    setMyAwareness({
      ...identity,
      holdingPopper: true,
      holdId: nextHoldId,
    });
  }, [holdId, identity, setMyAwareness]);

  useEffect(() => {
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  }, [release]);

  useEffect(() => {
    if (!holding || !otherHolder || snapped) return;
    const pairKey = [holdId, otherHolder.holdId].sort().join(":");
    const timer = window.setInterval(() => {
      const next = Math.min(1, chargeRef.current + 0.14);
      chargeRef.current = next;
      setCharge(next);
      if (next >= 1 && lastPopperPair.current !== pairKey) {
        const leader =
          [identity.pid, otherHolder.pid].sort()[0] === identity.pid;
        if (leader) {
          setData((draft) => {
            if (draft.lastPopperPair === pairKey) return;
            draft.lastPopperPair = pairKey;
            draft.popperCount += 1;
          });
          setSnapped(true);
          playPartySound("bang", soundOn);
          emitEvent(
            `the popper went off · ${otherHolder.name} and ${identity.name} pulled it together`,
            "popper",
          );
          window.setTimeout(() => {
            setSnapped(false);
            release();
          }, 2600);
        }
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [
    emitEvent,
    holdId,
    holding,
    identity,
    otherHolder,
    release,
    setData,
    snapped,
    soundOn,
  ]);

  useEffect(() => {
    if (!holding || otherHolder) return;
    const timer = window.setTimeout(() => {
      const teases = [
        "you are holding one end of a paper tube. compelling.",
        "pulling alone makes a sad crinkle sound.",
        "it takes two. this is the whole point of the party.",
        "nothing. you've achieved nothing. together, though…",
      ];
      setTease(teases[Math.floor(Math.random() * teases.length)]);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [holding, otherHolder]);

  const tension = Math.round(charge * 10);
  return (
    <div className="party-popper" data-popper>
      <span className="party-popper__note">needs two people</span>
      {snapped && <strong className="party-popper__bang">bang!</strong>}
      <div className={holding && otherHolder ? "is-pulling" : ""}>
        <button
          className="party-popper__end party-popper__end--mine"
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            startHolding();
          }}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
              event.preventDefault();
              startHolding();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === "Enter" || event.key === " ") release();
          }}
          style={{
            transform: `translateX(${snapped ? -34 : holding ? -8 - tension : 0}px)`,
          }}
          aria-label="Hold your end of the party popper"
        >
          <i />
          <b />
          <em />
        </button>
        <span className="party-popper__middle">
          <i />
        </span>
        <button
          className={`party-popper__end party-popper__end--theirs ${otherHolder ? "is-held" : ""}`}
          type="button"
          onClick={() =>
            setTease(
              "that end isn't yours to hold · someone else has to take it",
            )
          }
          style={{
            transform: `translateX(${snapped ? 34 : otherHolder ? 8 + tension : 0}px)`,
          }}
          aria-label="The other person's end of the party popper"
        >
          <i />
          <b />
          <em />
        </button>
      </div>
      <p>
        {snapped
          ? "pop! that only works together."
          : holding && otherHolder
            ? "pulling together… hold on!"
            : otherHolder
              ? `${otherHolder.name} has the other end · hold yours`
              : holding
                ? "holding · waiting for someone else"
                : tease}
      </p>
      <small>pulled {data.popperCount} times</small>
    </div>
  );
}

function PartyRoom({
  cameraEnabled,
  identity,
  soundOn,
  setSoundOn,
}: {
  cameraEnabled: boolean;
  identity: PartyIdentity;
  soundOn: boolean;
  setSoundOn: (value: boolean) => void;
}) {
  const {
    dispatchPlayEvent,
    registerPlayEventListener,
    removePlayEventListener,
  } = usePlayContext();
  const users = useUsers();
  const [eventLine, setEventLine] = useState<string | null>(null);
  const [effect, setEffect] = useState<PartyEffect | null>(null);
  const effectTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [camera, setCamera] = useState(0);
  const [hasMovedCamera, setHasMovedCamera] = useState(false);
  const [draggingRoom, setDraggingRoom] = useState(false);
  const [frame, setFrame] = useState({ width: 1280, height: 800 });
  const cameraStart = useRef({ x: 0, camera: 0 });

  const roomScale = Math.max(
    0.78,
    (frame.height - PARTY_CHROME_HEIGHT) / PARTY_ROOM_HEIGHT,
  );
  const cameraTravel = Math.max(1, PARTY_ROOM_WIDTH * roomScale - frame.width);
  const viewportCenter = (camera * cameraTravel + frame.width / 2) / roomScale;
  const nearestStation = [...PARTY_STATIONS].sort(
    (a, b) =>
      Math.abs(a.center - viewportCenter) - Math.abs(b.center - viewportCenter),
  )[0];
  const roomHint = hasMovedCamera ? `you’re at ${nearestStation.label}` : null;

  useEffect(() => {
    const updateFrame = () =>
      setFrame({ width: window.innerWidth, height: window.innerHeight });
    updateFrame();
    window.addEventListener("resize", updateFrame);
    return () => window.removeEventListener("resize", updateFrame);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!cameraEnabled) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.closest(
          "input, textarea, button, a, footer, [data-camera-ignore]",
        ) ||
        isScrollableTarget(target)
      ) {
        return;
      }
      cameraStart.current = { x: event.clientX, camera };
      setDraggingRoom(true);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRoom) return;
      setHasMovedCamera(true);
      setCamera(
        clampCamera(
          cameraStart.current.camera -
            (event.clientX - cameraStart.current.x) / cameraTravel,
        ),
      );
    };
    const onPointerUp = () => setDraggingRoom(false);
    const onWheel = (event: WheelEvent) => {
      if (!cameraEnabled || isScrollableTarget(event.target)) return;
      setHasMovedCamera(true);
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      setCamera((currentCamera) => clampCamera(currentCamera + delta / 1200));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !cameraEnabled ||
        (event.target instanceof HTMLElement &&
          event.target.closest("input, textarea"))
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        setHasMovedCamera(true);
        setCamera((currentCamera) => clampCamera(currentCamera - 0.08));
      }
      if (event.key === "ArrowRight") {
        setHasMovedCamera(true);
        setCamera((currentCamera) => clampCamera(currentCamera + 0.08));
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [camera, cameraEnabled, cameraTravel, draggingRoom]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (!cameraEnabled || !(event.target instanceof HTMLElement)) return;
      const target = event.target;
      if (!target.closest("#party-3-room-canvas")) return;
      const rect = target.getBoundingClientRect();
      if (rect.right >= 36 && rect.left <= frame.width - 36) return;
      const worldCenter =
        (rect.left + camera * cameraTravel + rect.width / 2) / roomScale;
      setHasMovedCamera(true);
      setCamera(
        clampCamera((worldCenter * roomScale - frame.width / 2) / cameraTravel),
      );
    };
    window.addEventListener("focusin", onFocusIn);
    return () => window.removeEventListener("focusin", onFocusIn);
  }, [camera, cameraEnabled, cameraTravel, frame.width, roomScale]);

  const showEffect = useCallback((nextEffect?: PartyEffect) => {
    if (!nextEffect) return;
    setEffect(nextEffect);
    if (effectTimer.current) window.clearTimeout(effectTimer.current);
    effectTimer.current = window.setTimeout(
      () => setEffect(null),
      nextEffect === "cake-finale" ? 7000 : 2800,
    );
  }, []);

  const showToast = useCallback((message: string) => {
    setEventLine(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(
      () => setEventLine(null),
      PARTY_TOAST_DURATION,
    );
  }, []);

  useEffect(
    () => () => {
      if (effectTimer.current) window.clearTimeout(effectTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    const eventTypes = [
      PARTY_EVENT,
      POPPER_EVENT,
      BALLOON_POP_EVENT,
      CAKE_FINALE_EVENT,
    ];
    const listenerIds = eventTypes.map((type) => ({
      type,
      id: registerPlayEventListener(type, {
        onEvent: (
          payload: { eventPayload: unknown } | Partial<PartyEventPayload>,
        ) => {
          if (!("message" in payload) || !payload.message) return;
          showToast(payload.message);
          showEffect(payload.effect);
        },
      }),
    }));
    return () =>
      listenerIds.forEach(({ type, id }) => removePlayEventListener(type, id));
  }, [
    registerPlayEventListener,
    removePlayEventListener,
    showEffect,
    showToast,
  ]);

  const emitEvent = useCallback(
    (message: string, nextEffect?: PartyEffect) => {
      showToast(message);
      showEffect(nextEffect);
      const type =
        nextEffect === "popper"
          ? POPPER_EVENT
          : nextEffect === "balloon-pop"
            ? BALLOON_POP_EVENT
            : nextEffect === "cake-finale"
              ? CAKE_FINALE_EVENT
              : PARTY_EVENT;
      dispatchPlayEvent({
        type,
        eventPayload: {
          message,
          effect: nextEffect,
        } satisfies PartyEventPayload,
      });
    },
    [dispatchPlayEvent, showEffect, showToast],
  );

  const current = useRef({
    camera,
    cameraTravel,
    draggingRoom,
    effect,
    emitEvent,
    eventLine,
    roomHint,
    roomScale,
    setSoundOn,
    soundOn,
    users,
  });
  current.current = {
    camera,
    cameraTravel,
    draggingRoom,
    effect,
    emitEvent,
    eventLine,
    roomHint,
    roomScale,
    setSoundOn,
    soundOn,
    users,
  };
  const setPartyAwareness = useRef<
    ((awareness: PopperAwareness) => void) | null
  >(null);

  useEffect(() => {
    setPartyAwareness.current?.({
      ...identity,
      holdingPopper: false,
      holdId: "",
    });
  }, [identity]);

  const SharedRoom = useMemo(
    () =>
      withSharedState<PartyData, PopperAwareness, { identity: PartyIdentity }>(
        (props) => ({
          defaultData: { popperCount: 0, lastPopperPair: "" },
          myDefaultAwareness: {
            ...props.identity,
            holdingPopper: false,
            holdId: "",
          },
        }),
        ({ data, setData, awareness, setMyAwareness }, props) => {
          setPartyAwareness.current = setMyAwareness;
          const {
            camera,
            cameraTravel,
            draggingRoom,
            effect,
            emitEvent,
            eventLine,
            roomHint,
            roomScale,
            setSoundOn,
            soundOn,
            users,
          } = current.current;
          return (
            <div id="party-3-room" className="party-page">
              <Confetti effect={effect} />
              <div
                id="party-3-room-canvas"
                className={`party-room ${draggingRoom ? "is-dragging" : ""}`}
                style={{
                  transform: `translateX(${-camera * cameraTravel}px) scale(${roomScale})`,
                }}
                role="region"
                aria-label="Party room. Drag, scroll, or use the arrow keys to move around."
                data-room
              >
                <div className="party-room__wall party-room__wall--first" />
                <div className="party-room__wall party-room__wall--second" />
                <div className="party-room__wall-seam" />
                <div className="party-room__floor" />
                <div className="party-room__baseboard" />
                <div className="party-room__confetti" />
                <CanToggleElement>
                  {({ data: lamp }) => (
                    <button
                      id="party-3-lamp"
                      className={`party-room__lamp ${lamp?.on ? "is-off" : ""}`}
                      type="button"
                      title="can-toggle · turn the lamp on or off"
                      aria-label={lamp?.on ? "Turn lamp on" : "Turn lamp off"}
                      aria-pressed={!lamp?.on}
                    >
                      <img
                        src="/party/3/assets/noguchi-hanging-lamp.png"
                        alt=""
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </CanToggleElement>
                <Pennants />
                <section className="party-hero" data-hero>
                  <p className="party-hero__date">August 2023–2026</p>
                  <h1>help us celebrate!</h1>
                  <p>
                    three years ago I put <strong>playhtml</strong> on the
                    internet hoping the web could feel a little more lived-in.
                    Now we have hundreds of tiny social websites that people
                    inhabit every day.
                  </p>
                  <p className="party-hero__signoff">— spencer</p>
                  <PartyPopper
                    data={data}
                    setData={setData}
                    awareness={awareness}
                    setMyAwareness={setMyAwareness}
                    identity={props.identity}
                    emitEvent={emitEvent}
                    soundOn={soundOn}
                  />
                </section>
                <div className="party-room__note">
                  please don’t pop
                  <br />
                  other people’s balloons
                </div>
                <div className="party-room__floor-cup" aria-hidden="true" />
                <div
                  className="party-room__floor-cup party-room__floor-cup--second"
                  aria-hidden="true"
                />
                <div
                  className="party-room__floor-cup party-room__floor-cup--third"
                  aria-hidden="true"
                />
                <div className="party-room__floor-plate" aria-hidden="true" />
                <div
                  className="party-room__floor-plate party-room__floor-plate--second"
                  aria-hidden="true"
                />
                <div className="party-room__napkin" aria-hidden="true" />
                <div
                  className="party-room__streamer party-room__streamer--one"
                  aria-hidden="true"
                />
                <div
                  className="party-room__streamer party-room__streamer--two"
                  aria-hidden="true"
                />
                <div
                  className="party-room__balloon-remnant"
                  aria-hidden="true"
                />
                <div className="party-room__door" aria-hidden="true">
                  <b />
                  <span>thanks for coming</span>
                  <i />
                </div>
                <a
                  className="party-room__sound-credit"
                  href="/party/3/assets/SOUND_CREDITS.txt"
                  target="_blank"
                  rel="noreferrer"
                >
                  balloon sound by Terhen
                </a>
                <CakeStation
                  identity={props.identity}
                  emitEvent={emitEvent}
                  soundOn={soundOn}
                />
                <BalloonsStation
                  identity={props.identity}
                  emitEvent={emitEvent}
                  soundOn={soundOn}
                />
                <WishesStation
                  identity={props.identity}
                  emitEvent={emitEvent}
                  soundOn={soundOn}
                />
              </div>
              {eventLine && (
                <p
                  className="party-event-line"
                  role="status"
                  aria-live="polite"
                  data-camera-ignore
                >
                  ✳ {eventLine}
                </p>
              )}
              <footer className="party-footer" data-footer>
                {roomHint && (
                  <span className="party-footer__location">{roomHint}</span>
                )}
                <button
                  type="button"
                  onClick={() => setSoundOn(!soundOn)}
                  aria-label={
                    soundOn ? "Mute party sounds" : "Turn on party sounds"
                  }
                  aria-pressed={soundOn}
                  title={
                    soundOn
                      ? "sound on · click to mute"
                      : "muted · click for pops and bangs"
                  }
                >
                  {soundOn ? "♪" : "♪̸"}
                </button>
                <span className="party-footer__presence">
                  <PresenceBalloons colors={users.map((user) => user.color)} />{" "}
                  {users.length} here
                </span>
                <a href="https://playhtml.fun">home</a>
                <a href="https://playhtml.fun/docs/">docs</a>
                <a href="https://discord.gg/2FhWH9AmSp">discord</a>
              </footer>
            </div>
          );
        },
      ),
    [],
  );
  return <SharedRoom identity={identity} />;
}

export function PartyPage() {
  const playerIdentity = usePlayerIdentity();
  const { isLoading } = usePlayContext();
  const [arrived, setArrived] = useState<boolean | null>(null);
  const [soundOn, setSoundOnState] = useState(true);

  useEffect(() => {
    const skipEntry = new URLSearchParams(window.location.search).has(
      "skipEntry",
    );
    setArrived(skipEntry || localStorage.getItem(ARRIVAL_KEY) === "true");
    setSoundOnState(localStorage.getItem(SOUND_KEY) !== "off");
  }, []);

  const setSoundOn = useCallback((value: boolean) => {
    setSoundOnState(value);
    localStorage.setItem(SOUND_KEY, value ? "on" : "off");
  }, []);

  if (isLoading || arrived === null || !playerIdentity.pid) {
    return <main className="party-loading">setting the table…</main>;
  }

  const identity: PartyIdentity = {
    pid: playerIdentity.pid,
    name: identityLabel(playerIdentity.name),
    color: playerIdentity.color || PARTY_COLORS[0],
  };

  return (
    <>
      {!arrived && (
        <ArrivalNametag
          initialName={playerIdentity.name ?? ""}
          initialColor={
            PARTY_COLORS.some((choice) => choice === playerIdentity.color)
              ? playerIdentity.color
              : PARTY_COLORS[0]
          }
          onEnter={(name, color) => {
            playhtml.users.me.name = name || undefined;
            playhtml.users.me.color = color;
            localStorage.setItem(ARRIVAL_KEY, "true");
            setArrived(true);
            playPartySound("chime", soundOn);
          }}
        />
      )}
      <div inert={arrived ? undefined : true} aria-hidden={!arrived}>
        <PartyRoom
          cameraEnabled={arrived}
          identity={identity}
          soundOn={soundOn}
          setSoundOn={setSoundOn}
        />
      </div>
    </>
  );
}
