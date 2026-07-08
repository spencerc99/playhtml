// ABOUTME: Press-and-hold rubber date stamp — hold to ink, release to thunk the
// ABOUTME: dated imprint onto the letter. The stamp is the letter's commit action.

import { useEffect, useRef, useState } from "react";
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
  const holdStart = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const firedRef = useRef(false);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function onPointerDown(e: React.PointerEvent) {
    if (disabled || phase === "stamped") return;
    (e.target as Element).setPointerCapture(e.pointerId);
    holdStart.current = performance.now();
    firedRef.current = false;
    setPhase("pressing");
  }

  function onPointerUp() {
    if (phase !== "pressing") return;
    // If disabled changed mid-hold, spring back instead of stamping.
    if (disabled) {
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
          {formatStampDate(Date.now())}
        </span>
      ) : (
        <>
          {phase === "resting" && !disabled && (
            <span className="mbs-stampHint">press &amp; hold to stamp the date</span>
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
        </>
      )}
    </div>
  );
}
