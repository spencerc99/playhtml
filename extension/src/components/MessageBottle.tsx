// ABOUTME: A message-bottle visual + read/write flow. Half-buried capsule that lifts and opens to a dialog.
// ABOUTME: Pure controlled component — accepts messages and an onSeal callback; storage is owned by the parent.

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SealingCeremony } from "./sealing/SealingCeremony";
import "./MessageBottle.scss";

// Stable class-name map. Lets us ditch CSS-modules so the same class names work
// in both the website (regular bundle) and the extension (shadow-DOM CSS string).
const styles = {
  field: "mb-field",
  fieldSlot: "mb-fieldSlot",
  mound: "mb-mound",
  castShadow: "mb-castShadow",
  slotCrack: "mb-slotCrack",
  capsuleMask: "mb-capsuleMask",
  capsule: "mb-capsule",
  capsuleSurface: "mb-capsuleSurface",
  capsuleLines: "mb-capsuleLines",
  capsuleUnrolling: "mb-capsuleUnrolling",
  capsuleOpen: "mb-capsuleOpen",
  authorStripe: "mb-authorStripe",
  svgArt: "mb-svgArt",
  // dialog
  overlay: "mb-overlay",
  overlayClosing: "mb-overlayClosing",
  paper: "mb-paper",
  label: "mb-label",
  messageField: "mb-messageField",
  actions: "mb-actions",
  primary: "mb-primary",
  readPane: "mb-readPane",
  writePane: "mb-writePane",
  // variant-specific
  variant_bottle: "mb-variant-bottle",
  variant_tablet: "mb-variant-tablet",
  variant_scroll: "mb-variant-scroll",
  variant_floppy: "mb-variant-floppy",
  variant_keytag: "mb-variant-keytag",
  variant_vial: "mb-variant-vial",
  variant_mirrored: "mb-variant-mirrored",
  variant_tinytext: "mb-variant-tinytext",
  variant_tinytextV: "mb-variant-tinytextV",
  variant_ghosttext: "mb-variant-ghosttext",
  variant_cipher: "mb-variant-cipher",
  variant_rock: "mb-variant-rock",
  // tablet
  tabletFace: "mb-tabletFace",
  tabletScratch: "mb-tabletScratch",
  tabletScratch2: "mb-tabletScratch2",
  tabletScratch3: "mb-tabletScratch3",
  // floppy
  floppyFace: "mb-floppyFace",
  floppyShutter: "mb-floppyShutter",
  floppyLabel: "mb-floppyLabel",
  floppyNotch: "mb-floppyNotch",
  // keytag
  keytagFace: "mb-keytagFace",
  keytagHole: "mb-keytagHole",
  keytagStamp: "mb-keytagStamp",
  // mirrored / text variants
  mirroredFace: "mb-mirroredFace",
  mirroredText: "mb-mirroredText",
  tinyTextWrap: "mb-tinyTextWrap",
  tinyTextLine: "mb-tinyTextLine",
  tinyTextVWrap: "mb-tinyTextVWrap",
  tinyTextVCol: "mb-tinyTextVCol",
  ghostTextWrap: "mb-ghostTextWrap",
  ghostTextLine: "mb-ghostTextLine",
  cipherWrap: "mb-cipherWrap",
  cipherLine: "mb-cipherLine",
};

export type Variant =
  | "bottle"
  | "tablet"
  | "scroll"
  | "floppy"
  | "keytag"
  | "vial"
  | "mirrored"
  | "tinytext"
  | "tinytextV"
  | "ghosttext"
  | "cipher"
  | "rock";

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
  variant?: Variant;
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
  variant?: Variant;
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
  variant = "tinytextV",
  pageBg = "#ffffff",
  portalContainer,
}: MessageBottleProps) {
  const [stage, setStage] = useState<Stage>("sealed");
  const [current, setCurrent] = useState<BottleMessageRef | null>(null);
  const [draft, setDraft] = useState("");
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
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

  const [sealedText, setSealedText] = useState("");

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
    styles.capsule,
    stage === "unrolling" ? styles.capsuleUnrolling : "",
    stage === "expanding" ||
    stage === "read" ||
    stage === "write" ||
    stage === "sealing"
      ? styles.capsuleOpen
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
    styles.overlay,
    stage === "closing" ? styles.overlayClosing : "",
  ]
    .filter(Boolean)
    .join(" ");

  const variantClass = styles[`variant_${variant}` as keyof typeof styles] || "";
  const fullCapsuleClass = [capsuleClass, variantClass].filter(Boolean).join(" ");

  // pick author color of the first message in the bottle, if any
  const authorColor = messages[0]?.authorColor;

  return (
    <>
      <div className={styles.mound} style={capsuleStyle}>
        <span className={styles.castShadow} aria-hidden="true" />
        <div className={styles.capsuleMask}>
          <button
            ref={capsuleRef}
            type="button"
            className={fullCapsuleClass}
            onClick={open}
            aria-label="open message bottle"
            title="something tucked into the page"
          >
            {authorColor && (
              <span
                className={styles.authorStripe}
                style={{ background: authorColor }}
                aria-hidden="true"
              />
            )}
            {renderVariantArt(variant, messages.length === 0)}
          </button>
        </div>
        <span className={styles.slotCrack} aria-hidden="true" />
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
            <div className={styles.paper}>
              {(stage === "read" || stage === "expanding") && (
                <div className={styles.readPane}>
                  <div className={styles.label}>a message left here</div>
                  {current ? (
                    <textarea
                      className={styles.messageField}
                      value={current.text}
                      readOnly
                    />
                  ) : (
                    <textarea
                      className={styles.messageField}
                      value="(this bottle is empty — be the first to leave a message)"
                      readOnly
                    />
                  )}
                  <div className={styles.actions}>
                    <button type="button" onClick={close}>
                      seal & leave
                    </button>
                    <button
                      type="button"
                      onClick={goWrite}
                      className={styles.primary}
                    >
                      write a reply →
                    </button>
                  </div>
                </div>
              )}

              {stage === "write" && (
                <div className={styles.writePane}>
                  <div className={styles.label}>leave your message</div>
                  <textarea
                    ref={writeRef}
                    className={styles.messageField}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="write something for the next person who finds this page..."
                    maxLength={500}
                  />
                  <div className={styles.actions}>
                    <button type="button" onClick={close}>
                      cancel
                    </button>
                    <button
                      type="button"
                      onClick={seal}
                      className={styles.primary}
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

function renderVariantArt(v: Variant, empty: boolean) {
  // empty bottles render the variant chrome but skip the contents
  switch (v) {
    case "bottle":
      return <BottleArt />;
    case "vial":
      return <VialArt />;
    case "scroll":
      return <ScrollArt />;
    case "rock":
      return <RockArt />;
    case "tablet":
      return (
        <span className={styles.tabletFace} aria-hidden="true">
          <span className={styles.tabletScratch} />
          <span className={styles.tabletScratch2} />
          <span className={styles.tabletScratch3} />
        </span>
      );
    case "floppy":
      return (
        <span className={styles.floppyFace} aria-hidden="true">
          <span className={styles.floppyShutter} />
          <span className={styles.floppyLabel} />
          <span className={styles.floppyNotch} />
        </span>
      );
    case "keytag":
      return (
        <span className={styles.keytagFace} aria-hidden="true">
          <span className={styles.keytagHole} />
          {!empty && <span className={styles.keytagStamp} />}
        </span>
      );
    case "mirrored":
      return empty ? null : <MirroredScribble />;
    case "tinytext":
      return empty ? null : <TinyTextArt />;
    case "tinytextV":
      return empty ? null : <TinyTextVerticalArt />;
    case "ghosttext":
      return empty ? null : <GhostTextArt />;
    case "cipher":
      return empty ? null : <CipherArt />;
  }
}

function TinyTextArt() {
  const lines = [
    "lorem ipsum dolor sit amet consectetur",
    "adipiscing elit sed do eiusmod tempor",
    "incididunt ut labore et dolore magna",
    "aliqua ut enim ad minim veniam quis",
    "nostrud exercitation ullamco laboris",
    "nisi ut aliquip ex ea commodo consequat",
  ];
  return (
    <div className={styles.tinyTextWrap} aria-hidden="true">
      {lines.map((l, i) => (
        <div key={i} className={styles.tinyTextLine}>
          {l}
        </div>
      ))}
    </div>
  );
}

function TinyTextVerticalArt() {
  const columns = [
    "loremipsumdolorsitametconsec",
    "teturadipiscingelitseddoeius",
    "modtemporincididuntutlabore",
    "etdoloremagnaaliquautenima",
    "dminimveniamquisnostrudexer",
  ];
  return (
    <div className={styles.tinyTextVWrap} aria-hidden="true">
      {columns.map((col, i) => (
        <div key={i} className={styles.tinyTextVCol}>
          {col.split("").map((ch, j) => (
            <span key={j}>{ch}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function GhostTextArt() {
  return (
    <div className={styles.ghostTextWrap} aria-hidden="true">
      <div className={styles.ghostTextLine}>leave</div>
      <div className={styles.ghostTextLine}>a note</div>
      <div className={styles.ghostTextLine}>for the</div>
      <div className={styles.ghostTextLine}>next one</div>
    </div>
  );
}

function CipherArt() {
  const lines = ["ꭰꮃꮈꭷꮒꭹ", "ꞵꞋꞗꞆꞎ", "ⰀⰁⰂⰃⰄⰅ", "ꭱꮾꮶꭺꭽ", "ⰠⰡⰢⰣⰤ"];
  return (
    <div className={styles.cipherWrap} aria-hidden="true">
      {lines.map((l, i) => (
        <div key={i} className={styles.cipherLine}>
          {l}
        </div>
      ))}
    </div>
  );
}

function MirroredScribble() {
  return (
    <svg
      className={styles.svgArt}
      viewBox="0 0 30 175"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1="3" y1="22" x2="27" y2="22" stroke="rgba(0,0,0,0.06)" strokeWidth="0.4" />
      <line x1="3" y1="36" x2="27" y2="36" stroke="rgba(0,0,0,0.06)" strokeWidth="0.4" />
      <line x1="3" y1="50" x2="27" y2="50" stroke="rgba(0,0,0,0.06)" strokeWidth="0.4" />
      <line x1="3" y1="64" x2="27" y2="64" stroke="rgba(0,0,0,0.06)" strokeWidth="0.4" />
      <path d="M 4 22 q 1.5 -2 3 0 t 3 0 t 3 0 t 3 0 t 3 0 t 3 0 t 3 0" stroke="rgba(50,50,60,0.55)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <path d="M 4 36 q 2 -2 4 0 t 4 0 t 4 0 t 4 0 t 4 0 t 4 0" stroke="rgba(50,50,60,0.55)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <path d="M 4 50 q 1.5 -2 3 0 t 3 0 t 3 0 t 3 0 t 3 0 t 3 0" stroke="rgba(50,50,60,0.55)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <path d="M 4 64 q 2 -2 4 0 t 4 0 t 4 0" stroke="rgba(50,50,60,0.55)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function BottleArt() {
  return (
    <svg className={styles.svgArt} viewBox="0 0 40 160" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="bottleGlass" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#1a4d3a" />
          <stop offset="22%" stopColor="#2d7a52" />
          <stop offset="38%" stopColor="#5fae7e" />
          <stop offset="48%" stopColor="#a8d8b0" />
          <stop offset="58%" stopColor="#5fae7e" />
          <stop offset="78%" stopColor="#246648" />
          <stop offset="100%" stopColor="#0e3526" />
        </linearGradient>
        <linearGradient id="bottlePaper" x1="0" x2="1">
          <stop offset="0%" stopColor="#d4c8a0" />
          <stop offset="50%" stopColor="#f0e6c4" />
          <stop offset="100%" stopColor="#c4b890" />
        </linearGradient>
      </defs>
      <rect x="14" y="60" width="12" height="78" rx="2" fill="url(#bottlePaper)" />
      <path d="M 13 30 Q 13 24 16 22 L 16 12 Q 16 8 20 8 Q 24 8 24 12 L 24 22 Q 27 24 27 30 L 32 50 Q 36 60 36 80 L 36 150 Q 36 158 30 160 L 10 160 Q 4 158 4 150 L 4 80 Q 4 60 8 50 Z" fill="url(#bottleGlass)" stroke="#0a2418" strokeWidth="0.8" />
      <path d="M 9 36 Q 8 60 8 90 L 8 145" stroke="rgba(220,255,230,0.6)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M 12 38 Q 11 70 11 110" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" strokeLinecap="round" fill="none" />
      <rect x="15" y="2" width="10" height="8" rx="1" fill="#b8804a" />
      <rect x="15" y="2" width="10" height="2" fill="#8b5a2b" />
      <rect x="15" y="2" width="10" height="1" fill="#6b4220" />
      <path d="M 8 50 Q 6 56 6 64 L 6 76" stroke="rgba(0,0,0,0.25)" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function VialArt() {
  return (
    <svg className={styles.svgArt} viewBox="0 0 28 160" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="vialGlass" x1="0" x2="1">
          <stop offset="0%" stopColor="#a8c8d8" />
          <stop offset="40%" stopColor="#e8f0f4" />
          <stop offset="60%" stopColor="#f4f8fa" />
          <stop offset="100%" stopColor="#7090a0" />
        </linearGradient>
        <linearGradient id="vialLiquid" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#d49a3a" />
          <stop offset="100%" stopColor="#8b5a1a" />
        </linearGradient>
      </defs>
      <rect x="6" y="60" width="16" height="92" rx="2" fill="url(#vialLiquid)" />
      <path d="M 5 14 L 5 152 Q 5 158 9 158 L 19 158 Q 23 158 23 152 L 23 14 Z" fill="url(#vialGlass)" stroke="#3a5660" strokeWidth="0.8" />
      <rect x="3" y="10" width="22" height="6" rx="1" fill="#c8d8e0" stroke="#3a5660" strokeWidth="0.8" />
      <rect x="6" y="2" width="16" height="9" rx="1.5" fill="#1a1a1a" />
      <rect x="6" y="2" width="16" height="2" fill="#0a0a0a" />
      <path d="M 8 22 L 8 140" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M 11 24 L 11 100" stroke="rgba(255,255,255,0.3)" strokeWidth="0.6" />
    </svg>
  );
}

function ScrollArt() {
  return (
    <svg className={styles.svgArt} viewBox="0 0 36 160" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="scrollPaper" x1="0" x2="1">
          <stop offset="0%" stopColor="#bda878" />
          <stop offset="35%" stopColor="#e8d8a8" />
          <stop offset="55%" stopColor="#f4e8c0" />
          <stop offset="100%" stopColor="#a89868" />
        </linearGradient>
        <radialGradient id="waxSeal" cx="0.4" cy="0.3" r="0.7">
          <stop offset="0%" stopColor="#d83a3a" />
          <stop offset="60%" stopColor="#a01010" />
          <stop offset="100%" stopColor="#5a0808" />
        </radialGradient>
      </defs>
      <rect x="4" y="6" width="28" height="148" rx="2" fill="url(#scrollPaper)" stroke="#7a6a40" strokeWidth="0.6" />
      <ellipse cx="18" cy="6" rx="14" ry="3.5" fill="#c4a868" stroke="#7a6a40" strokeWidth="0.6" />
      <line x1="8" y1="20" x2="28" y2="20" stroke="rgba(120,90,40,0.18)" strokeWidth="0.5" />
      <line x1="8" y1="34" x2="28" y2="34" stroke="rgba(120,90,40,0.18)" strokeWidth="0.5" />
      <line x1="8" y1="48" x2="28" y2="48" stroke="rgba(120,90,40,0.18)" strokeWidth="0.5" />
      <circle cx="18" cy="62" r="9" fill="url(#waxSeal)" stroke="#3a0404" strokeWidth="0.6" />
      <text x="18" y="66" textAnchor="middle" fontSize="9" fontFamily="Georgia, serif" fontWeight="700" fill="#5a0808" opacity="0.55">✦</text>
      <path d="M 22 70 Q 23 75 21 78" stroke="#7a0a0a" strokeWidth="1" fill="none" opacity="0.6" />
    </svg>
  );
}

function RockArt() {
  return (
    <svg className={styles.svgArt} viewBox="0 0 64 160" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="rockBase" x1="0.2" x2="0.8" y1="0" y2="1">
          <stop offset="0%" stopColor="#d6cab6" />
          <stop offset="35%" stopColor="#a89c86" />
          <stop offset="70%" stopColor="#766a58" />
          <stop offset="100%" stopColor="#3e362c" />
        </linearGradient>
      </defs>
      <path d="M 22 14 Q 14 18 10 30 Q 4 44 4 62 L 2 90 L 4 120 Q 6 142 12 154 Q 18 160 28 160 L 40 160 Q 52 158 58 146 Q 62 130 60 108 L 62 78 Q 60 50 54 32 Q 48 18 38 14 Q 30 12 22 14 Z" fill="url(#rockBase)" stroke="#2a221a" strokeWidth="0.8" />
      <path d="M 22 14 Q 14 18 10 30 Q 4 44 4 62 L 14 56 L 24 36 L 30 18 Z" fill="rgba(255,250,240,0.22)" />
      <path d="M 14 56 L 24 36 L 30 18 L 38 24 L 36 56 L 24 78 Z" fill="rgba(255,245,225,0.08)" />
      <path d="M 54 32 Q 60 50 62 78 L 60 108 Q 62 130 58 146 L 50 130 L 46 80 L 50 50 Z" fill="rgba(0,0,0,0.28)" />
      <path d="M 28 50 Q 32 70 30 95 Q 34 115 32 138" stroke="rgba(0,0,0,0.3)" strokeWidth="0.6" fill="none" />
      <circle cx="22" cy="38" r="0.9" fill="rgba(0,0,0,0.4)" />
      <circle cx="40" cy="60" r="1.1" fill="rgba(0,0,0,0.3)" />
      <circle cx="18" cy="88" r="0.7" fill="rgba(0,0,0,0.35)" />
      <circle cx="46" cy="100" r="1" fill="rgba(0,0,0,0.3)" />
      <circle cx="32" cy="124" r="0.8" fill="rgba(0,0,0,0.35)" />
      <path d="M 16 30 Q 18 27 21 28 Q 23 25 26 28" stroke="#6a8a48" strokeWidth="0.9" fill="none" opacity="0.55" />
      <path d="M 18 32 Q 19 30 21 31" stroke="#5a7a38" strokeWidth="0.6" fill="none" opacity="0.4" />
    </svg>
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
  variant = "tinytextV",
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
    <div className={styles.field}>
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
            className={styles.fieldSlot}
            style={{ top: `${p.top}%`, left: `${p.left}%` }}
          >
            <MessageBottle
              messages={refs}
              onSeal={handleSeal(i)}
              rotateDeg={p.rotate}
              variant={variant}
              pageBg={pageBg}
            />
          </div>
        );
      })}
    </div>
  );
}
