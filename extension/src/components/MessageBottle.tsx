// ABOUTME: A message-bottle visual + read/write flow. Half-buried card that lifts and opens to a dialog.
// ABOUTME: Pure controlled component — accepts messages and an onSeal callback; storage is owned by the parent.

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SealingCeremony } from "./sealing/SealingCeremony";
import "./MessageBottle.scss";

// Compiled stylesheet as a string, for injecting into a Shadow DOM root
// (the extension renders the bottle inside a closed shadow tree). The plain
// side-effect import above styles the website build; this string styles the
// extension. Both come from the same .scss, so class names stay in sync.
export { default as MESSAGE_BOTTLE_CSS } from "./MessageBottle.scss?inline";

export interface BottleMessageRef {
  id: string;
  text: string;
  authorColor?: string;
}

interface MessageBottleProps {
  messages: BottleMessageRef[];
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

interface BottleFieldProps {
  pageKey: string;
  seed?: string[];
  count?: number;
  pageBg?: string;
  children?: React.ReactNode;
}

type Stage =
  | "sealed"
  | "unrolling"
  | "expanding"
  | "read"
  | "write"
  | "sealing"
  | "closing";

function pickMessage(messages: BottleMessageRef[]): BottleMessageRef | null {
  if (!messages.length) return null;
  return messages[Math.floor(Math.random() * messages.length)];
}

export function MessageBottle({
  messages,
  onSeal,
  onOpened,
  onClosed,
  rotateDeg = 0,
  pageBg = "#ffffff",
  portalContainer,
}: MessageBottleProps) {
  const [stage, setStage] = useState<Stage>("sealed");
  const [current, setCurrent] = useState<BottleMessageRef | null>(null);
  const [draft, setDraft] = useState("");
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [sealedText, setSealedText] = useState("");
  const capsuleRef = useRef<HTMLButtonElement>(null);
  const writeRef = useRef<HTMLTextAreaElement>(null);

  const open = useCallback(() => {
    if (capsuleRef.current) {
      const r = capsuleRef.current.getBoundingClientRect();
      setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    setCurrent(pickMessage(messages));
    setStage("unrolling");
    setTimeout(() => setStage("expanding"), 700);
    setTimeout(() => setStage("read"), 700 + 480);
    if (onOpened) onOpened();
  }, [messages, onOpened]);

  const close = useCallback(() => {
    setStage("closing");
    setTimeout(() => {
      setStage("sealed");
      setDraft("");
      setCurrent(null);
      setOrigin(null);
      if (onClosed) onClosed();
    }, 360);
  }, [onClosed]);

  const goWrite = useCallback(() => {
    setStage("write");
  }, []);

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

  // The card shows the first message's author color as a left-edge stripe.
  const authorColor = messages[0]?.authorColor;
  const isEmpty = messages.length === 0;

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
                  <div className="mb-label">a message left here</div>
                  <textarea
                    className="mb-messageField"
                    value={
                      current
                        ? current.text
                        : "(this bottle is empty — be the first to leave a message)"
                    }
                    readOnly
                  />
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
            authorColor={messages[0]?.authorColor ?? "#4a9a8a"}
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

// ============================
// BottleField — website-only sandbox wrapper that owns localStorage state
// ============================

interface SandboxMessage {
  id: string;
  text: string;
  ts: number;
}

const STORAGE_PREFIX = "bottle:v1:";

function loadSandboxMessages(pageKey: string, seed: string[]): SandboxMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + pageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as SandboxMessage[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    // fall through
  }
  return seed.map((text, i) => ({
    id: `seed-${i}`,
    text,
    ts: Date.now() - (seed.length - i) * 86_400_000,
  }));
}

function saveSandboxMessages(pageKey: string, messages: SandboxMessage[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + pageKey, JSON.stringify(messages));
  } catch {
    // ignore
  }
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pseudoRandom(seed: number, i: number): number {
  const x = Math.sin(seed * 9301 + i * 49297) * 233280;
  return x - Math.floor(x);
}

export function BottleField({
  pageKey,
  seed = [],
  count = 3,
  pageBg = "#ffffff",
  children,
}: BottleFieldProps) {
  const [messages, setMessages] = useState<SandboxMessage[]>(() =>
    loadSandboxMessages(pageKey, seed),
  );

  const positions = Array.from({ length: count }, (_, i) => {
    const s = hashSeed(pageKey + ":" + i);
    return {
      top: 6 + pseudoRandom(s, 1) * 80,
      left: 6 + pseudoRandom(s, 2) * 86,
      rotate: -18 + pseudoRandom(s, 3) * 36,
    };
  });

  const handleSeal = useCallback(
    (slotIndex: number) => (text: string) => {
      const slotKey = `${pageKey}:${slotIndex}`;
      const next: SandboxMessage[] = [
        ...messages,
        { id: `m-${Date.now()}-${slotIndex}`, text, ts: Date.now() },
      ];
      setMessages(next);
      saveSandboxMessages(slotKey, next);
    },
    [messages, pageKey],
  );

  return (
    <div className="mb-field">
      {children}
      {positions.map((p, i) => {
        const slotKey = `${pageKey}:${i}`;
        const slotMessages = loadSandboxMessages(slotKey, seed);
        const refs: BottleMessageRef[] = slotMessages.map((m) => ({
          id: m.id,
          text: m.text,
        }));
        return (
          <div
            key={i}
            className="mb-fieldSlot"
            style={{ top: `${p.top}%`, left: `${p.left}%` }}
          >
            <MessageBottle
              messages={refs}
              onSeal={handleSeal(i)}
              rotateDeg={p.rotate}
              pageBg={pageBg}
            />
          </div>
        );
      })}
    </div>
  );
}
