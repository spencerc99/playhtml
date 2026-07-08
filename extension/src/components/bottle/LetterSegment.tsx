// ABOUTME: One read-only segment of the letter scroll — the letter text plus the
// ABOUTME: single sign-off row (signed name, cursor fingerprint, date-stamp imprint).

import type { BottleNote } from "../../features/BottleManager";
import { segmentStyle } from "./segmentStyles";

/** The date as the rubber stamp pressed it, e.g. "MAR 3, 2026". */
export function formatStampDate(ts: number): string {
  return new Date(ts)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
}

/** An inked imprint of a cursor — the author's thumbprint. */
export function Fingerprint({ color }: { color: string }) {
  return (
    <svg className="mbs-fingerprint" viewBox="0 0 14 18" aria-hidden="true">
      <path
        d="M1 1 L1 13.5 L4.4 10.6 L6.6 16 L9 15 L6.9 9.8 L11.4 9.6 Z"
        fill={color}
        opacity="0.8"
      />
      <path
        d="M2.5 3.5 L2.5 10 L4.8 8.2 L6.4 12.4"
        fill="none"
        stroke={color}
        strokeWidth="0.6"
        opacity="0.35"
      />
    </svg>
  );
}

export function LetterSegment({ note }: { note: BottleNote }) {
  const style = segmentStyle(note.styleId);
  return (
    <>
      <div className={`mbs-segment ${style.className}`} style={{ color: style.ink }}>
        <div className="mbs-letterText">{note.text}</div>
        <div className="mbs-signoff" style={{ color: note.authorColor }}>
          {note.authorName && <span className="mbs-signName">{note.authorName}</span>}
          <Fingerprint color={note.authorColor} />
          <span className="mbs-dateImprint" style={{ color: style.ink }}>
            {formatStampDate(note.createdAt)}
          </span>
        </div>
      </div>
      <div className={`mbs-perf perf-${style.id}`} aria-hidden="true" />
    </>
  );
}
