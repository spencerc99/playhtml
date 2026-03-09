// ABOUTME: Layered guestbook where each entry is a glowing card stacked like flyers on a pole.
// ABOUTME: Click a card to expand; carousel navigation while expanded; compose via live preview card.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { withSharedState, usePlayContext } from "@playhtml/react";
import words from "profane-words";
import styles from "./AuraGuestbook.module.scss";

interface GuestbookEntry {
  name: string;
  color: string;
  message: string;
  timestamp: number;
}

const MAX_MESSAGE_LENGTH = 400;
const MAX_NAME_LENGTH = 20;
const LOCALSTORAGE_KEY = "wewere-guestbook-submitted";

// 3 paper texture variants assigned deterministically per card
const TEXTURE_CLASSES = ["textureA", "textureB", "textureC"] as const;
function getTextureClass(index: number): string {
  return TEXTURE_CLASSES[index % TEXTURE_CLASSES.length];
}

function containsProfanity(text: string): boolean {
  return words.some((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    return regex.test(text);
  });
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

// Cards spread across the container with random positions (not ordered by age)
function getCardTransform(timestamp: number, index: number) {
  const seed = timestamp + index * 7919;
  const rotation = (seededRandom(seed) - 0.5) * 20; // -10 to +10 deg
  // Fully random horizontal spread, not correlated with index order
  const spreadX = 10 + seededRandom(seed + 3) * 80; // 10% to 90%
  const jitterY = (seededRandom(seed + 2) - 0.5) * 40; // -20 to +20 px
  return { rotation, spreadX, jitterY };
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

// Colored glow shadow layers for an orb
function getGlowShadow(color: string): string {
  return [
    `0 0 8px ${color}66`,
    `0 0 20px ${color}44`,
    `0 0 40px ${color}22`,
  ].join(", ");
}

// Visitor dots scattered like irregular polka dots
function VisitorOrbs({ entries }: { entries: GuestbookEntry[] }) {
  const MAX_VISIBLE = 150;
  const { cursors } = usePlayContext();

  const allColors = useMemo(() => {
    const colors: string[] = [];
    if (cursors.color) colors.push(cursors.color);
    const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
    for (const entry of sorted) {
      if (!colors.includes(entry.color)) {
        colors.push(entry.color);
      }
    }
    return colors;
  }, [entries, cursors.color]);

  const visible = allColors.slice(0, MAX_VISIBLE);
  const overflow = allColors.length - MAX_VISIBLE;

  return (
    <div className={styles.visitorOrbs}>
      {visible.map((color, i) => {
        // Deterministic irregular placement
        const seed = i * 7919 + color.charCodeAt(1);
        const offsetY = (seededRandom(seed) - 0.5) * 18; // -9 to +9 px vertical scatter
        const size = 10 + seededRandom(seed + 1) * 8; // 10-18px varied sizes
        const marginLeft = -4 + (seededRandom(seed + 2) - 0.5) * 6; // -7 to -1 px overlap variation
        return (
          <div
            key={`${color}-${i}`}
            className={styles.visitorOrb}
            style={{
              backgroundColor: color,
              boxShadow: getGlowShadow(color),
              zIndex: visible.length - i,
              width: size,
              height: size,
              marginLeft: i === 0 ? 0 : marginLeft,
              transform: `translateY(${offsetY}px)`,
            }}
          />
        );
      })}
      {overflow > 0 && (
        <span className={styles.visitorOverflow}>+{overflow}</span>
      )}
    </div>
  );
}

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
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const guestbookRef = useRef<HTMLDivElement>(null);

    const entries = data;
    // Oldest at bottom (lowest z-index), newest on top
    const sortedEntries = useMemo(
      () => [...entries].sort((a, b) => a.timestamp - b.timestamp),
      [entries],
    );

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

        <VisitorOrbs entries={entries} />
        {/* Stacked cards pile */}
        <div className={styles.pileContainer}>
          <div
            className={`${styles.pile} ${
              expandedIndex !== null ? styles.pileDimmed : ""
            }`}
          >
            {sortedEntries.map((entry, i) => {
              const { rotation, spreadX, jitterY } = getCardTransform(
                entry.timestamp,
                i,
              );
              const ageFilter = getAgeFilter(entry.timestamp);
              const textureClass = getTextureClass(i);
              return (
                <button
                  key={`${entry.timestamp}-${i}`}
                  className={`${styles.card} ${styles[textureClass]}`}
                  style={{
                    backgroundColor: entry.color,
                    filter: ageFilter,
                    zIndex: i,
                    left: `${spreadX}%`,
                    top: `50%`,
                    transform: `translate(-50%, -50%) translate(0px, ${jitterY}px) rotate(${rotation}deg)`,
                    boxShadow: getGlowShadow(entry.color),
                  }}
                  onClick={() => setExpandedIndex(i)}
                  aria-label={`Message from ${entry.name}`}
                >
                  <span className={styles.cardName}>{entry.name}</span>
                  <span className={styles.cardSnippet}>{entry.message}</span>
                </button>
              );
            })}
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
