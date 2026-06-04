// ABOUTME: Layered guestbook where each entry is a glowing card stacked like flyers on a pole.
// ABOUTME: Click a card to expand; carousel navigation while expanded; compose via live preview card.

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from "react";
import { withSharedState, usePlayContext } from "@playhtml/react";
import { containsProfanity } from "@movement/profanity";
import { getPileDotColors, type GuestbookEntry } from "./auraGuestbookData";
import styles from "./AuraGuestbook.module.scss";

const MAX_MESSAGE_LENGTH = 400;
const MAX_NAME_LENGTH = 20;
const LOCALSTORAGE_KEY = "wewere-guestbook-submitted";
// Cap how many cards paint in the fixed-size pile; buried cards are invisible
// anyway. The expanded carousel still navigates the full entry list.
const PILE_RENDER_LIMIT = 120;
// Visitor dot sizing for the canvas band
const ORB_MIN_SIZE = 10;
const ORB_MAX_SIZE = 18;
// Nominal row spacing; actual dot Y is heavily jittered so rows blur together.
const ORB_ROW_HEIGHT = 28;
const ORB_BAND_PADDING_Y = 18;
// How far a dot can drift vertically from its row center, as a fraction of row height.
const ORB_ROW_JITTER = 0.85;

// 3 paper texture variants assigned deterministically per card
const TEXTURE_CLASSES = ["textureA", "textureB", "textureC"] as const;
function getTextureClass(index: number): string {
  return TEXTURE_CLASSES[index % TEXTURE_CLASSES.length];
}

// Aging via desaturation + dimming instead of opacity
// Fresh entries are vivid, old entries fade to muted/gray
function getAgeFilter(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 1) return "saturate(1.1) brightness(1.05)";
  const ageFactor = Math.min(Math.log10(ageHours) / 3.5, 0.7);
  const saturation = Math.max(0.3, 1 - ageFactor);
  const brightness = Math.max(0.6, 1 - ageFactor * 0.5);
  return `saturate(${saturation}) brightness(${brightness})`;
}

// Deterministic pseudo-random from a seed number
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Cards cluster near center first, spreading outward as the pile grows
function getCardTransform(timestamp: number, index: number, total: number) {
  const seed = timestamp + index * 7919;
  const rotation = (seededRandom(seed) - 0.5) * 20; // -10 to +10 deg
  // Spread range grows with card count: few cards stay tight, many cards fill
  // the board edge-to-edge so a large pile reads dense rather than clumped.
  const maxSpreadX = Math.min(48, 5 + total * 3); // up to 48% from center
  const maxSpreadY = Math.min(44, 6 + total * 3); // up to 44% from center
  const jitterX = (seededRandom(seed + 3) - 0.5) * 2; // -1 to +1
  const jitterY = (seededRandom(seed + 2) - 0.5) * 2; // -1 to +1
  const spreadX = 50 + jitterX * maxSpreadX; // centered at 50%
  const spreadY = 50 + jitterY * maxSpreadY; // centered at 50%
  return { rotation, spreadX, spreadY };
}

// Format timestamp as colloquial time: "around 11pm on a Sunday"
function formatColloquialTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hour = date.getHours();
  const dayName = date.toLocaleDateString("en-US", { weekday: "long" });

  let timeStr: string;
  if (hour === 0) timeStr = "around midnight";
  else if (hour === 6) timeStr = "around sunrise";
  else if (hour === 12) timeStr = "around noon";
  else if (hour === 18) timeStr = "around sunset";
  else if (hour < 12) timeStr = `around ${hour}am`;
  else timeStr = `around ${hour - 12}pm`;

  return `${timeStr} on a ${dayName}`;
}

// Coarse, casual relative time for the dot hover tooltip.
// For entries a day or more old, appends a time-of-day phrase.
function formatVisitTooltip(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let relative: string;
  let withinDay: boolean;
  if (diffMs < 5 * minute) {
    relative = "just now";
    withinDay = true;
  } else if (diffMs < hour) {
    relative = "a little while ago";
    withinDay = true;
  } else if (diffMs < day) {
    relative = "earlier today";
    withinDay = true;
  } else if (diffMs < 2 * day) {
    relative = "yesterday";
    withinDay = false;
  } else if (diffMs < 7 * day) {
    relative = "this week";
    withinDay = false;
  } else if (diffMs < 14 * day) {
    relative = "last week";
    withinDay = false;
  } else {
    relative = "a while ago";
    withinDay = false;
  }

  if (withinDay) return `visited ${relative}`;

  const hourOfDay = new Date(timestamp).getHours();
  let partOfDay: string;
  if (hourOfDay >= 5 && hourOfDay <= 11) partOfDay = "in the morning";
  else if (hourOfDay >= 12 && hourOfDay <= 16) partOfDay = "in the afternoon";
  else if (hourOfDay >= 17 && hourOfDay <= 20) partOfDay = "in the evening";
  else partOfDay = "at night";
  return `visited ${relative} ${partOfDay}`;
}

// Apply an alpha to a color in any CSS format (hex, hsl, named). color-mix is
// supported in all evergreen browsers and handles formats hex-append cannot.
function withAlpha(color: string, alpha: number): string {
  const pct = Math.round(alpha * 100);
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

// Multi-layer colored glow for the expanded/compose cards (few painted at once)
function getGlowShadow(color: string): string {
  return [
    `0 0 8px ${withAlpha(color, 0.4)}`,
    `0 0 20px ${withAlpha(color, 0.27)}`,
    `0 0 40px ${withAlpha(color, 0.13)}`,
  ].join(", ");
}

// Single-layer glow, cheap enough to paint on every pile card
function getCardGlow(color: string): string {
  return `0 0 12px ${withAlpha(color, 0.27)}`;
}

// Tight dot-colored glow for a card highlighted via its visitor dot, layered
// over a small dark drop shadow for depth.
function getHighlightGlow(color: string): string {
  return `0 0 14px ${withAlpha(color, 0.55)}, 0 2px 6px rgba(0, 0, 0, 0.3)`;
}

interface DotLayout {
  color: string;
  x: number;
  cy: number;
  radius: number;
}

// Place dots left-to-right with deterministic jitter, wrapping to new rows so
// every dot is shown. Returns the dots plus the total band height they need.
// Pack dots into a fixed-height horizontal band. Each "column" of dots stacks
// vertically within `height`, with heavy jitter so the column grid dissolves.
// Returns dots plus the total layout width — the parent makes that scrollable.
function layoutOrbs(
  colors: string[],
  height: number,
): { dots: DotLayout[]; width: number } {
  const dots: DotLayout[] = [];
  if (height === 0) return { dots, width: 0 };
  // How many dots stack vertically per column. Picked so the column-row height
  // is similar to ORB_ROW_HEIGHT regardless of band height.
  const innerHeight = Math.max(1, height - ORB_BAND_PADDING_Y * 2);
  const rowsPerCol = Math.max(2, Math.floor(innerHeight / ORB_ROW_HEIGHT));
  const colRowHeight = innerHeight / rowsPerCol;
  const maxJitter = colRowHeight * ORB_ROW_JITTER;

  let col = 0;
  let row = 0;
  let x = ORB_MAX_SIZE;
  let colMaxRadius = 0;

  for (let i = 0; i < colors.length; i++) {
    const color = colors[i];
    const seed = i * 7919 + color.charCodeAt(1);
    const size =
      ORB_MIN_SIZE + seededRandom(seed + 1) * (ORB_MAX_SIZE - ORB_MIN_SIZE);
    const radius = size / 2;

    const rowCenterY =
      ORB_BAND_PADDING_Y + row * colRowHeight + colRowHeight / 2;
    const offsetY = (seededRandom(seed) - 0.5) * 2 * maxJitter;

    // Horizontal jitter within the column so dots in the same column don't
    // align vertically.
    const colJitterX = (seededRandom(seed + 4) - 0.5) * (ORB_MAX_SIZE * 0.6);
    dots.push({
      color,
      x: x + colJitterX,
      cy: rowCenterY + offsetY,
      radius,
    });
    colMaxRadius = Math.max(colMaxRadius, radius);

    row++;
    if (row >= rowsPerCol) {
      // Advance to next column: base gap + occasional wide gap so columns
      // don't read as evenly spaced.
      const baseGap = 4 + seededRandom(col * 31.1 + 7) * 8;
      const wideGap =
        seededRandom(col * 17.3 + 3) < 0.12
          ? 10 + seededRandom(col * 19.7) * 16
          : 0;
      x += colMaxRadius + baseGap + wideGap + ORB_MAX_SIZE / 2;
      col++;
      row = 0;
      colMaxRadius = 0;
      // Stagger each column's vertical start so column-tops don't form a line.
      // Implemented by shifting the first row's center via row variable being
      // 0 + an x-only offset is enough since jitter handles the rest.
    }
  }

  // Compute total width from the rightmost dot.
  let width = ORB_MAX_SIZE;
  for (const d of dots) width = Math.max(width, d.x + d.radius + ORB_MAX_SIZE);
  return { dots, width };
}

// Visitor dots — every unique rendered pile color, drawn on one canvas so the
// glow scales without compositing a box-shadow per DOM node.
// Hovering a dot reports its color up so the matching pile cards can lift.
const VisitorOrbs = memo(function VisitorOrbs({
  dotColors,
  hoveredColor,
  onHoverColor,
  firstVisitByColor,
}: {
  dotColors: string[];
  hoveredColor: string | null;
  onHoverColor: (color: string | null) => void;
  firstVisitByColor: Map<string, number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [bandHeight, setBandHeight] = useState(0);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  const { dots, width: bandWidth } = useMemo(
    () => layoutOrbs(dotColors, bandHeight),
    [dotColors, bandHeight],
  );

  // Track the viewport's height so layout matches the visible band.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entriesObserved) => {
      setBandHeight(entriesObserved[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bandHeight === 0 || bandWidth === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = bandWidth * dpr;
    canvas.height = bandHeight * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, bandWidth, bandHeight);

    for (const { color, x, cy, radius } of dots) {
      const isHovered = hoveredColor === color;
      const drawRadius = isHovered ? radius * 1.35 : radius;

      // Tight radial glow (alpha via globalAlpha so any color format works),
      // then a solid core at full opacity. Hovered dots glow brighter + larger.
      ctx.save();
      ctx.globalAlpha = isHovered ? 0.5 : 0.28;
      const glowR = drawRadius * 1.6;
      const glow = ctx.createRadialGradient(x, cy, 0, x, cy, glowR);
      glow.addColorStop(0, color);
      // Fade to the SAME color at zero alpha (not "transparent", which is
      // black-transparent and leaves a dark fringe under premultiplied alpha).
      glow.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, cy, glowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, cy, drawRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [dots, bandWidth, bandHeight, hoveredColor]);

  // Hit-test the pointer against dot positions; report the hovered color up.
  // Last color reported up, so mousemove only updates state on transitions
  // (the handler fires every pointer frame; unguarded setState would re-render
  // the dot band on each one).
  const lastHoveredRef = useRef<string | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      // Pick the nearest dot within its hit radius. Dots are packed tightly with
      // a generous hit radius, so points can fall inside several — nearest-center
      // resolves overlaps predictably (closest dot wins).
      let found: DotLayout | null = null;
      let bestDistSq = Infinity;
      for (const d of dots) {
        const dx = px - d.x;
        const dy = py - d.cy;
        const distSq = dx * dx + dy * dy;
        const hit = Math.max(d.radius, 9);
        if (distSq <= hit * hit && distSq < bestDistSq) {
          bestDistSq = distSq;
          found = d;
        }
      }
      const foundColor = found ? found.color : null;
      if (foundColor === lastHoveredRef.current) return;
      lastHoveredRef.current = foundColor;
      onHoverColor(foundColor);
      if (found) {
        const firstVisit = firstVisitByColor.get(found.color);
        setTooltip({
          x: found.x,
          y: found.cy - found.radius,
          text:
            firstVisit !== undefined
              ? formatVisitTooltip(firstVisit)
              : "a visitor",
        });
      } else {
        setTooltip(null);
      }
    },
    [dots, onHoverColor, firstVisitByColor],
  );

  const handleMouseLeave = useCallback(() => {
    lastHoveredRef.current = null;
    onHoverColor(null);
    setTooltip(null);
  }, [onHoverColor]);

  // Gentle horizontal auto-scroll on touch devices so visitors see the band
  // has more content than the visible viewport. Pauses on user interaction and
  // resumes a few seconds after they stop.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (!isTouch) return;
    const maxScroll = viewport.scrollWidth - viewport.clientWidth;
    if (maxScroll <= 4) return;

    let rafId = 0;
    let direction = 1;
    let paused = false;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const PIXELS_PER_SECOND = 16;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      if (!paused) {
        const next = viewport.scrollLeft + direction * PIXELS_PER_SECOND * dt;
        if (next >= maxScroll) {
          viewport.scrollLeft = maxScroll;
          direction = -1;
        } else if (next <= 0) {
          viewport.scrollLeft = 0;
          direction = 1;
        } else {
          viewport.scrollLeft = next;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const pauseFor = (ms: number) => {
      paused = true;
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        paused = false;
        lastTime = performance.now();
      }, ms);
    };
    const onUserScroll = () => pauseFor(4000);
    viewport.addEventListener("touchstart", onUserScroll, { passive: true });
    viewport.addEventListener("wheel", onUserScroll, { passive: true });

    return () => {
      cancelAnimationFrame(rafId);
      if (resumeTimer) clearTimeout(resumeTimer);
      viewport.removeEventListener("touchstart", onUserScroll);
      viewport.removeEventListener("wheel", onUserScroll);
    };
  }, [bandHeight, bandWidth]);

  return (
    <div className={styles.visitorOrbs} ref={wrapRef}>
      <div className={styles.visitorOrbViewport} ref={viewportRef}>
        <div
          className={styles.visitorOrbBand}
          style={{ width: bandWidth, height: bandHeight }}
        >
          <canvas
            ref={canvasRef}
            className={styles.visitorOrbCanvas}
            style={{ width: bandWidth, height: bandHeight }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
          {tooltip && (
            <span
              className={styles.visitorTooltip}
              style={{ left: tooltip.x, top: tooltip.y }}
              role="tooltip"
            >
              {tooltip.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

export const AuraGuestbook = withSharedState(
  { defaultData: [] as GuestbookEntry[] },
  ({ data, setData }) => {
    const { cursors } = usePlayContext();
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
    const [composing, setComposing] = useState(false);
    const [message, setMessage] = useState("");
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const [hoveredColor, setHoveredColor] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const guestbookRef = useRef<HTMLDivElement>(null);

    const entries = data;
    // Oldest at bottom (lowest z-index), newest on top
    const sortedEntries = useMemo(
      () => [...entries].sort((a, b) => a.timestamp - b.timestamp),
      [entries],
    );

    // The pile area is fixed-size; only the most recent cards are ever visible
    // (older ones are fully buried). Render a window of the newest entries,
    // keeping real indices so the expanded carousel still spans every entry.
    const visiblePileCards = useMemo(() => {
      const start = Math.max(0, sortedEntries.length - PILE_RENDER_LIMIT);
      return sortedEntries.slice(start).map((entry, offset) => {
        const index = start + offset;
        const { rotation, spreadX, spreadY } = getCardTransform(
          entry.timestamp,
          index,
          sortedEntries.length,
        );
        return {
          entry,
          index,
          rotation,
          spreadX,
          spreadY,
          textureClass: getTextureClass(index),
        };
      });
    }, [sortedEntries]);
    const pileDotColors = useMemo(
      () => getPileDotColors(sortedEntries, PILE_RENDER_LIMIT),
      [sortedEntries],
    );

    // Earliest timestamp per visitor color, for the dot hover tooltip
    const firstVisitByColor = useMemo(() => {
      const map = new Map<string, number>();
      for (const entry of entries) {
        const existing = map.get(entry.color);
        if (existing === undefined || entry.timestamp < existing) {
          map.set(entry.color, entry.timestamp);
        }
      }
      return map;
    }, [entries]);

    useEffect(() => {
      setHasSubmitted(localStorage.getItem(LOCALSTORAGE_KEY) === "true");
    }, []);

    // Keyboard navigation — only active when expanded or guestbook is in viewport
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (composing) return;
        // Only intercept keys when expanded, to avoid hijacking page scroll
        if (expandedIndex === null) return;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          if (expandedIndex < sortedEntries.length - 1) {
            setExpandedIndex(expandedIndex + 1);
          }
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          if (expandedIndex > 0) {
            setExpandedIndex(expandedIndex - 1);
          }
        } else if (e.key === "Escape") {
          setExpandedIndex(null);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [expandedIndex, sortedEntries.length, composing]);

    // Touch swipe for carousel
    const touchStartX = useRef(0);
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
    }, []);
    const handleTouchEnd = useCallback(
      (e: React.TouchEvent) => {
        if (expandedIndex === null) return;
        const diff = touchStartX.current - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) {
          if (diff > 0 && expandedIndex < sortedEntries.length - 1) {
            setExpandedIndex(expandedIndex + 1);
          } else if (diff < 0 && expandedIndex > 0) {
            setExpandedIndex(expandedIndex - 1);
          }
        }
      },
      [expandedIndex, sortedEntries.length],
    );

    const handleSubmit = () => {
      const trimmedMessage = message.trim();
      const trimmedName = name.trim();
      if (!trimmedMessage) return;
      if (containsProfanity(trimmedMessage) || containsProfanity(trimmedName)) {
        setError("now why would you try to do something like that?");
        return;
      }
      setError("");
      setData([
        ...data,
        {
          name: trimmedName || "someone",
          color: cursors.color || "#8a8279",
          message: trimmedMessage,
          timestamp: Date.now(),
        },
      ]);
      setMessage("");
      setName("");
      setComposing(false);
      setHasSubmitted(true);
      localStorage.setItem(LOCALSTORAGE_KEY, "true");
    };

    const myColor = cursors.color || "#8a8279";
    const expanded =
      expandedIndex !== null ? sortedEntries[expandedIndex] : null;
    // Stable seed for compose card rotation (doesn't change on re-render)
    const composeRotation = useMemo(() => (seededRandom(42) - 0.5) * 6, []);

    return (
      <div className={styles.guestbook} ref={guestbookRef} id="guestbook-pile">
        {/* Visitor dots above heading */}

        <VisitorOrbs
          dotColors={pileDotColors}
          hoveredColor={hoveredColor}
          onHoverColor={setHoveredColor}
          firstVisitByColor={firstVisitByColor}
        />
        {/* Stacked cards pile */}
        <div className={styles.pileContainer}>
          <div
            className={`${styles.pile} ${
              expandedIndex !== null ? styles.pileDimmed : ""
            }`}
          >
            {visiblePileCards.map(
              ({
                entry,
                index,
                rotation,
                spreadX,
                spreadY,
                textureClass,
              }) => {
                const isHighlighted = hoveredColor === entry.color;
                return (
                  <button
                    key={`${entry.timestamp}-${index}`}
                    className={`${styles.card} ${styles[textureClass]} ${
                      isHighlighted ? styles.cardHighlighted : ""
                    }`}
                    style={{
                      backgroundColor: entry.color,
                      // Computed inline (not memoized) so the age fade keeps
                      // updating over time even without new entries.
                      filter: isHighlighted
                        ? "saturate(1.15) brightness(1.08)"
                        : getAgeFilter(entry.timestamp),
                      // Highlighted cards are lifted via .cardHighlighted's
                      // z-index; this is just the in-pile stacking order.
                      zIndex: index,
                      left: `${spreadX}%`,
                      top: `${spreadY}%`,
                      transform: `translate(-50%, -50%) rotate(${rotation}deg)${
                        isHighlighted ? " scale(1.12)" : ""
                      }`,
                      boxShadow: isHighlighted
                        ? getHighlightGlow(entry.color)
                        : getCardGlow(entry.color),
                    }}
                    onClick={() => setExpandedIndex(index)}
                    aria-label={`Message from ${entry.name}`}
                  >
                    <span className={styles.cardName}>{entry.name}</span>
                    <span className={styles.cardSnippet}>{entry.message}</span>
                  </button>
                );
              },
            )}
          </div>

          {/* Expanded card view */}
          {expanded && (
            <div
              className={styles.expandedOverlay}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onClick={(e) => {
                if (e.target === e.currentTarget) setExpandedIndex(null);
              }}
            >
              <div className={styles.expandedLayout}>
                <button
                  className={styles.navButton}
                  onClick={() =>
                    setExpandedIndex(Math.max(0, expandedIndex! - 1))
                  }
                  disabled={expandedIndex === 0}
                  aria-label="Previous"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M12 4L6 10l6 6" />
                  </svg>
                </button>

                <div
                  className={`${styles.expandedCard} ${
                    styles[getTextureClass(expandedIndex!)]
                  }`}
                  style={{
                    backgroundColor: expanded.color,
                    boxShadow: getGlowShadow(expanded.color),
                  }}
                >
                  <span className={styles.expandedName}>{expanded.name}</span>
                  <span className={styles.expandedMessage}>
                    {expanded.message}
                  </span>
                  <span className={styles.expandedMeta}>
                    {formatColloquialTime(expanded.timestamp)}
                  </span>
                </div>

                <button
                  className={styles.navButton}
                  onClick={() =>
                    setExpandedIndex(
                      Math.min(sortedEntries.length - 1, expandedIndex! + 1),
                    )
                  }
                  disabled={expandedIndex === sortedEntries.length - 1}
                  aria-label="Next"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M8 4l6 6-6 6" />
                  </svg>
                </button>
              </div>

              <button
                className={styles.expandedClose}
                onClick={() => setExpandedIndex(null)}
              >
                back to all
              </button>
            </div>
          )}
        </div>

        <p className={styles.arrowHint}>
          <span className={styles.arrowHintDesktop}>
            use arrow keys to browse
          </span>
          <span className={styles.arrowHintMobile}>
            scroll sideways to see more
          </span>
        </p>

        {/* Compose — live preview card with inline editing */}
        {!hasSubmitted && (
          <div className={styles.composeArea}>
            {!composing ? (
              <button
                className={styles.composeCard}
                style={{
                  backgroundColor: myColor,
                  boxShadow: getGlowShadow(myColor),
                  transform: `rotate(${composeRotation}deg)`,
                }}
                onClick={() => {
                  setComposing(true);
                  setTimeout(() => textareaRef.current?.focus(), 100);
                }}
              >
                <span className={styles.composeCta}>leave your mark</span>
              </button>
            ) : (
              <div className={styles.composeExpanded}>
                <div
                  className={`${styles.composeLiveCard} ${styles.textureA}`}
                  style={{
                    backgroundColor: myColor,
                    boxShadow: getGlowShadow(myColor),
                  }}
                >
                  <input
                    type="text"
                    className={styles.composeLiveName}
                    placeholder="name"
                    value={name}
                    maxLength={MAX_NAME_LENGTH}
                    onChange={(e) => {
                      // Strip spaces, only allow a-z, 0-9, underscores, hyphens
                      const cleaned = e.target.value.replace(/\s/g, "");
                      setName(cleaned);
                    }}
                  />
                  <textarea
                    ref={textareaRef}
                    className={styles.composeLiveMessage}
                    placeholder="leave a message..."
                    value={message}
                    maxLength={MAX_MESSAGE_LENGTH}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                  <span className={styles.composeLiveMeta}>
                    {message.length}/{MAX_MESSAGE_LENGTH}
                  </span>
                </div>
                {error && <span className={styles.composeError}>{error}</span>}
                <div className={styles.composeActions}>
                  <button
                    className={styles.composeCancel}
                    onClick={() => {
                      setComposing(false);
                      setError("");
                    }}
                  >
                    cancel
                  </button>
                  <button
                    className={styles.composeSubmit}
                    onClick={handleSubmit}
                    disabled={!message.trim()}
                  >
                    send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);
