// ABOUTME: A message-bottle visual. Half-buried card that lifts and opens onto the letter scroll.
// ABOUTME: Pure controlled component — accepts a thread of notes and an onSeal callback; storage is owned by the parent.

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SealingCeremony } from "./sealing/SealingCeremony";
import { LetterScroll } from "./bottle/LetterScroll";
import type { StampedLetter } from "./bottle/WriteSegment";
import type { BottleNote } from "../features/BottleManager";

// Compiled stylesheet as a string, injected into the bottle's Shadow DOM root
// by the extension (features/social/bottles.ts). We deliberately do NOT import
// the .scss as a global side effect: the content script's CSS is injected into
// every page via the manifest, which would leak these .mb-* rules onto every
// host page and defeat the shadow-DOM isolation.
export { default as MESSAGE_BOTTLE_CSS } from "./MessageBottle.scss?inline";

interface MessageBottleProps {
  /** The bottle's thread, oldest first. Empty for an unwritten prompt. */
  notes: BottleNote[];
  authorColor?: string;
  /** Whether the current viewer may write a reply (false if they left the
   * bottle's latest note themselves). Defaults to true. */
  canReply?: boolean;
  onSeal: (text: string, meta: { authorName?: string; styleId?: string }) => void;
  onOpened?: () => void;
  /** Fires when the scroll fully closes (after read/write/cancel). */
  onClosed?: () => void;
  rotateDeg?: number;
  pageBg?: string;
  /**
   * Where to portal the overlay/scroll. Defaults to document.body for the
   * website; pass a Shadow DOM node for the extension.
   */
  portalContainer?: Element | null;
}

type Stage =
  | "sealed"
  | "unrolling"
  | "expanding"
  | "scroll"
  | "sealing"
  | "closing";

export function MessageBottle({
  notes,
  authorColor,
  canReply = true,
  onSeal,
  onOpened,
  onClosed,
  rotateDeg = 0,
  pageBg = "#ffffff",
  portalContainer,
}: MessageBottleProps) {
  const [stage, setStage] = useState<Stage>("sealed");
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [pendingLetter, setPendingLetter] = useState<StampedLetter | null>(null);
  // During the in-place sealing handoff the scroll overlay stays MOUNTED (its
  // backdrop is the ceremony's single backdrop) but the DOM scroll content is
  // hidden once the WebGL paper has rendered aligned over it. Until then the
  // real scroll shows through, so the ceremony mounts with no blank gap / jump.
  const [scrollHidden, setScrollHidden] = useState(false);
  const capsuleRef = useRef<HTMLButtonElement>(null);
  // Stage-transition timers, tracked so they can be cleared on unmount and at
  // the start of each new transition (otherwise an unmount mid-open/close runs
  // setStage on a gone component, resurrecting or mutating a closed scroll).
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const open = useCallback(() => {
    if (capsuleRef.current) {
      const r = capsuleRef.current.getBoundingClientRect();
      setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    setStage("unrolling");
    clearTimers();
    timersRef.current.push(setTimeout(() => setStage("expanding"), 700));
    timersRef.current.push(setTimeout(() => setStage("scroll"), 700 + 480));
    if (onOpened) onOpened();
  }, [onOpened, clearTimers]);

  const close = useCallback(() => {
    setStage("closing");
    clearTimers();
    timersRef.current.push(
      setTimeout(() => {
        setStage("sealed");
        setOrigin(null);
        if (onClosed) onClosed();
      }, 360),
    );
  }, [onClosed, clearTimers]);

  const handleStamped = useCallback(
    (letter: StampedLetter) => {
      if (!letter.text) {
        close();
        return;
      }
      // Defer the actual onSeal + close to the ceremony onComplete so the
      // shadow DOM doesn't tear down the ceremony mid-flight.
      setPendingLetter(letter);
      // Clear any pending open-stage timers; otherwise a stale timer fires and
      // snaps the stage back mid-ceremony.
      clearTimers();
      setStage("sealing");
      // The scroll stays visible until the ceremony's aligned first frame lands
      // (handleCeremonyFirstFrame). Fallback: if readiness doesn't arrive in
      // ~500ms, hide anyway so a slow raster can't strand the reader on the DOM
      // scroll with the ceremony invisibly on top.
      timersRef.current.push(setTimeout(() => setScrollHidden(true), 500));
    },
    [close, clearTimers],
  );

  const handleCeremonyFirstFrame = useCallback(() => {
    setScrollHidden(true);
  }, []);

  const finishCeremony = useCallback(() => {
    if (pendingLetter) {
      onSeal(pendingLetter.text, {
        authorName: pendingLetter.authorName,
        styleId: pendingLetter.styleId,
      });
    }
    setPendingLetter(null);
    setScrollHidden(false);
    // The bottle has already plunged into the page — reset straight to sealed.
    // Routing through close() would remount the overlay for its closing
    // animation, flashing the scroll after the ceremony ends.
    clearTimers();
    setStage("sealed");
    setOrigin(null);
    if (onClosed) onClosed();
  }, [pendingLetter, onSeal, clearTimers, onClosed]);

  // Escape mid-ceremony discards the stamped letter and tears down cleanly:
  // unmount the ceremony (pendingLetter cleared), un-hide the scroll state, and
  // route through the overlay's closing animation.
  const abortSealing = useCallback(() => {
    setPendingLetter(null);
    setScrollHidden(false);
    close();
  }, [close]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (stage === "sealed" || stage === "closing") return;
      if (e.key !== "Escape") return;
      if (stage === "sealing") abortSealing();
      else close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, close, abortSealing]);

  // The overlay stays mounted THROUGH sealing so its backdrop is the ceremony's
  // single backdrop (the ceremony container is transparent). The scroll content
  // inside is hidden once the aligned WebGL paper has rendered over it.
  const overlayVisible =
    stage === "expanding" ||
    stage === "scroll" ||
    stage === "sealing" ||
    stage === "closing";

  const capsuleClass = [
    "mb-capsule",
    "mb-variant-tinytextV",
    stage === "unrolling" ? "mb-capsuleUnrolling" : "",
    stage === "expanding" || stage === "scroll" || stage === "sealing"
      ? "mb-capsuleOpen"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const capsuleStyle: CSSProperties = {
    transform: `rotate(${rotateDeg}deg)`,
    ["--page-bg" as string]: pageBg,
  };

  const overlayClass = [
    "mb-overlay",
    stage === "closing" ? "mb-overlayClosing" : "",
    // Hide the scroll frame (but keep the backdrop) once the ceremony's WebGL
    // paper has taken over in place.
    scrollHidden ? "mb-overlayScrollHidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The card shows the latest note's author color as a left-edge stripe.
  const isEmpty = notes.length === 0;

  return (
    <>
      <div className="mb-mound" style={capsuleStyle}>
        <span className="mb-castShadow" aria-hidden="true" />
        <div className="mb-capsuleMask">
          <button
            ref={capsuleRef}
            type="button"
            className={capsuleClass}
            onClick={open}
            aria-label="open message bottle"
            title="something tucked into the page"
          >
            {authorColor && (
              <span
                className="mb-authorStripe"
                style={{ background: authorColor }}
                aria-hidden="true"
              />
            )}
            {!isEmpty && <TinyTextVerticalArt />}
          </button>
        </div>
        <span className="mb-slotCrack" aria-hidden="true" />
      </div>

      {overlayVisible &&
        createPortal(
          <div className={overlayClass}>
            <LetterScroll
              notes={notes}
              canReply={canReply}
              authorColor={authorColor ?? "#4a9a8a"}
              onStamped={handleStamped}
              onClose={close}
            />
          </div>,
          portalContainer ?? document.body,
        )}

      {stage === "sealing" &&
        pendingLetter &&
        origin &&
        createPortal(
          <SealingCeremony
            text={pendingLetter.text}
            authorColor={authorColor ?? "#4a9a8a"}
            slotX={origin.x}
            slotY={origin.y}
            styleId={pendingLetter.styleId}
            notes={notes}
            newNote={{
              text: pendingLetter.text,
              createdAt: Date.now(),
              createdBy: "",
              authorColor: authorColor ?? "#4a9a8a",
              ...(pendingLetter.authorName
                ? { authorName: pendingLetter.authorName }
                : {}),
              styleId: pendingLetter.styleId,
            }}
            portalContainer={portalContainer ?? document.body}
            onFirstFrame={handleCeremonyFirstFrame}
            onComplete={finishCeremony}
          />,
          portalContainer ?? document.body,
        )}
    </>
  );
}

/** The card's surface: vertical columns of tiny apparent-letters — "writing
 *  exists here" without being legible. */
function TinyTextVerticalArt() {
  const columns = [
    "loremipsumdolorsitametconsec",
    "teturadipiscingelitseddoeius",
    "modtemporincididuntutlabore",
    "etdoloremagnaaliquautenima",
    "dminimveniamquisnostrudexer",
  ];
  return (
    <div className="mb-tinyTextVWrap" aria-hidden="true">
      {columns.map((col, i) => (
        <div key={i} className="mb-tinyTextVCol">
          {col.split("").map((ch, j) => (
            <span key={j}>{ch}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

