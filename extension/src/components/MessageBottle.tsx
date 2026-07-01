// ABOUTME: A message-bottle visual + read/write flow. Half-buried card that lifts and opens to a dialog.
// ABOUTME: Pure controlled component — accepts a thread of notes and an onSeal callback; storage is owned by the parent.

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SealingCeremony } from "./sealing/SealingCeremony";
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
  onSeal: (text: string) => void;
  onOpened?: () => void;
  /** Fires when the dialog fully closes (after read/write/cancel). */
  onClosed?: () => void;
  rotateDeg?: number;
  pageBg?: string;
  /**
   * Where to portal the overlay/dialog. Defaults to document.body for the
   * website; pass a Shadow DOM node for the extension.
   */
  portalContainer?: Element | null;
}

type Stage =
  | "sealed"
  | "unrolling"
  | "expanding"
  | "read"
  | "write"
  | "sealing"
  | "closing";

export function MessageBottle({
  notes,
  authorColor,
  onSeal,
  onOpened,
  onClosed,
  rotateDeg = 0,
  pageBg = "#ffffff",
  portalContainer,
}: MessageBottleProps) {
  const [stage, setStage] = useState<Stage>("sealed");
  const [draft, setDraft] = useState("");
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [sealedText, setSealedText] = useState("");
  const capsuleRef = useRef<HTMLButtonElement>(null);
  const writeRef = useRef<HTMLTextAreaElement>(null);
  // Stage-transition timers, tracked so they can be cleared on unmount and at
  // the start of each new transition (otherwise an unmount mid-open/close runs
  // setStage on a gone component, resurrecting or mutating a closed dialog).
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
    timersRef.current.push(setTimeout(() => setStage("read"), 700 + 480));
    if (onOpened) onOpened();
  }, [onOpened, clearTimers]);

  const close = useCallback(() => {
    setStage("closing");
    clearTimers();
    timersRef.current.push(
      setTimeout(() => {
        setStage("sealed");
        setDraft("");
        setOrigin(null);
        if (onClosed) onClosed();
      }, 360),
    );
  }, [onClosed, clearTimers]);

  const goWrite = useCallback(() => {
    // Cancel the open() stage timers — clicking "write a reply" during the
    // expanding window would otherwise let the pending read timer fire and
    // snap the dialog back to read, dropping the user out of the write box.
    clearTimers();
    setStage("write");
  }, [clearTimers]);

  const seal = useCallback(() => {
    const text = draft.trim();
    if (!text) {
      close();
      return;
    }
    // Defer the actual onSeal + close to the ceremony onComplete so the
    // shadow DOM doesn't tear down the ceremony mid-flight.
    setSealedText(text);
    setStage("sealing");
  }, [draft, close]);

  const finishCeremony = useCallback(() => {
    if (sealedText) onSeal(sealedText);
    setSealedText("");
    close();
  }, [sealedText, onSeal, close]);

  useEffect(() => {
    if (stage === "write") {
      writeRef.current?.focus();
    }
  }, [stage]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (stage === "sealed" || stage === "closing") return;
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, close]);

  const overlayVisible =
    stage === "expanding" ||
    stage === "read" ||
    stage === "write" ||
    stage === "closing";

  const capsuleClass = [
    "mb-capsule",
    "mb-variant-tinytextV",
    stage === "unrolling" ? "mb-capsuleUnrolling" : "",
    stage === "expanding" ||
    stage === "read" ||
    stage === "write" ||
    stage === "sealing"
      ? "mb-capsuleOpen"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const capsuleStyle: CSSProperties = {
    transform: `rotate(${rotateDeg}deg)`,
    ["--page-bg" as string]: pageBg,
  };

  const overlayStyle: CSSProperties = origin
    ? ({
        "--origin-dx": `${origin.x - window.innerWidth / 2}px`,
        "--origin-dy": `${origin.y - window.innerHeight / 2}px`,
      } as CSSProperties)
    : {};

  const overlayClass = [
    "mb-overlay",
    stage === "closing" ? "mb-overlayClosing" : "",
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
          <div
            className={overlayClass}
            style={overlayStyle}
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div className="mb-paper">
              {(stage === "read" || stage === "expanding") && (
                <div className="mb-readPane">
                  <div className="mb-label">
                    {isEmpty
                      ? "an empty bottle"
                      : notes.length === 1
                        ? "a message left here"
                        : `${notes.length} messages left here`}
                  </div>
                  {isEmpty ? (
                    <textarea
                      className="mb-messageField"
                      value="(this bottle is empty — be the first to leave a message)"
                      readOnly
                    />
                  ) : (
                    <div className="mb-thread">
                      {notes.map((n, i) => (
                        <div
                          key={i}
                          className="mb-note"
                          style={{ borderLeftColor: n.authorColor }}
                        >
                          {n.text}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mb-actions">
                    <button type="button" onClick={close}>
                      seal & leave
                    </button>
                    <button type="button" onClick={goWrite} className="mb-primary">
                      write a reply →
                    </button>
                  </div>
                </div>
              )}

              {stage === "write" && (
                <div className="mb-writePane">
                  <div className="mb-label">leave your message</div>
                  <textarea
                    ref={writeRef}
                    className="mb-messageField"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="write something for the next person who finds this page..."
                    maxLength={500}
                  />
                  <div className="mb-actions">
                    <button type="button" onClick={close}>
                      cancel
                    </button>
                    <button
                      type="button"
                      onClick={seal}
                      className="mb-primary"
                      disabled={!draft.trim()}
                    >
                      seal the bottle
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          portalContainer ?? document.body,
        )}

      {stage === "sealing" &&
        origin &&
        createPortal(
          <SealingCeremony
            text={sealedText}
            authorColor={authorColor ?? "#4a9a8a"}
            slotX={origin.x}
            slotY={origin.y}
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

