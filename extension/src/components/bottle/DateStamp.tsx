// ABOUTME: Press-and-hold rubber date stamp — hold to ink, release to thunk the
// ABOUTME: dated imprint onto the letter. The stamp is the letter's commit action.

import { useEffect, useRef, useState } from "react";
import { formatStampDate } from "./LetterSegment";

const HOLD_MS = 550;

interface DateStampProps {
  disabled: boolean;
  onStamped: () => void;
}

type Phase = "resting" | "pressing" | "stamped";

export function DateStamp({ disabled, onStamped }: DateStampProps) {
  const [phase, setPhase] = useState<Phase>("resting");
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
    if (performance.now() - holdStart.current >= HOLD_MS) {
      firedRef.current = true;
      setPhase("stamped");
      timers.current.push(setTimeout(onStamped, 250));
    } else {
      setPhase("resting");
    }
  }

  return (
    <div className="mbs-stampWell">
      {phase === "stamped" ? (
        <span className="mbs-dateImprint mbs-imprintFresh">
          {formatStampDate(Date.now())}
        </span>
      ) : (
        <button
          type="button"
          className={`mbs-stamp${phase === "pressing" ? " pressing" : ""}`}
          disabled={disabled}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          title="press and hold to stamp today's date"
          aria-label="press and hold to stamp today's date"
        >
          <span className="mbs-stampHandle" />
          <span className="mbs-stampBase" />
        </button>
      )}
    </div>
  );
}
