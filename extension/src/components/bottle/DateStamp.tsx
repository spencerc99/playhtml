// ABOUTME: Press-and-hold rubber date stamp — hold to ink, release to thunk the
// ABOUTME: dated imprint onto the letter. The stamp is the letter's commit action.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatStampDate } from "./LetterSegment";

// Minimum hold to commit; holding longer inks the imprint darker and squarer,
// up to a full press. A quick stamp lands light and crooked.
const HOLD_MS = 550;
const FULL_INK_MS = 1800;

interface DateStampProps {
  disabled: boolean;
  onStamped: () => void;
}

type Phase = "resting" | "pressing" | "stamped";

export function DateStamp({ disabled, onStamped }: DateStampProps) {
  const [phase, setPhase] = useState<Phase>("resting");
  // 0..1 — how fully the stamp was pressed; drives the imprint's ink + tilt.
  const [pressure, setPressure] = useState(1);
  // The date frozen at press-start, so the ghost preview names the exact date
  // the released imprint will land.
  const [previewDate, setPreviewDate] = useState("");
  // Toggled on the frame after "pressing" begins so the ghost's opacity/ink
  // transition (matching the sink curve) fires instead of applying instantly.
  const [inking, setInking] = useState(false);
  // Kept true briefly after an early release so the half-inked ghost fades out
  // instead of vanishing.
  const [fadingGhost, setFadingGhost] = useState(false);
  const holdStart = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const firedRef = useRef(false);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Start the ghost's inking transition one frame after "pressing" renders it
  // faint, so it darkens over the hold rather than snapping to full ink.
  useLayoutEffect(() => {
    if (phase !== "pressing") {
      setInking(false);
      return;
    }
    const id = requestAnimationFrame(() => setInking(true));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  function onPointerDown(e: React.PointerEvent) {
    if (disabled || phase === "stamped") return;
    (e.target as Element).setPointerCapture(e.pointerId);
    holdStart.current = performance.now();
    firedRef.current = false;
    setFadingGhost(false);
    setPreviewDate(formatStampDate(Date.now()));
    setPhase("pressing");
  }

  // An early release drops the half-inked ghost back out: fade it, then unmount.
  function releaseGhost() {
    setFadingGhost(true);
    timers.current.push(
      setTimeout(() => setFadingGhost(false), 260),
    );
  }

  function onPointerUp() {
    if (phase !== "pressing") return;
    // If disabled changed mid-hold, spring back instead of stamping.
    if (disabled) {
      releaseGhost();
      setPhase("resting");
      return;
    }
    // Prevent double-fire if pointerup and pointercancel both fire before state flushes.
    if (firedRef.current) return;
    const held = performance.now() - holdStart.current;
    if (held >= HOLD_MS) {
      firedRef.current = true;
      setPressure(Math.min(1, (held - HOLD_MS) / (FULL_INK_MS - HOLD_MS)));
      setPhase("stamped");
      timers.current.push(setTimeout(onStamped, 350));
    } else {
      releaseGhost();
      setPhase("resting");
    }
  }

  // A rushed stamp reads lighter and lands more crooked than a firm one.
  const imprintVars = {
    "--ink": String(0.45 + 0.5 * pressure),
    "--tilt": `${-2 - 5 * (1 - pressure)}deg`,
  } as React.CSSProperties;

  return (
    <div className="mbs-stampWell">
      {phase === "stamped" ? (
        <span className="mbs-dateImprint mbs-imprintFresh" style={imprintVars}>
          {previewDate || formatStampDate(Date.now())}
        </span>
      ) : (
        <>
          {phase === "resting" && !disabled && (
            <span className="mbs-stampHint">press &amp; hold to stamp the date</span>
          )}
          <div className="mbs-stampStage">
            {(phase === "pressing" || fadingGhost) && (
              // A ghost imprint under the stamp's foot: renders barely-there,
              // then darkens toward full ink over the hold (opacity transition
              // matched to the sink curve). On an early release it fades out.
              <span
                className={`mbs-dateImprint mbs-dateGhost${inking ? " inking" : ""}${
                  fadingGhost ? " fading" : ""
                }`}
                aria-hidden="true"
              >
                {previewDate}
              </span>
            )}
            <button
              type="button"
              className={`mbs-stamp${phase === "pressing" ? " pressing" : ""}`}
              disabled={disabled}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              title="press and hold to stamp today's date"
              aria-label="press and hold to stamp today's date"
            />
          </div>
        </>
      )}
    </div>
  );
}
