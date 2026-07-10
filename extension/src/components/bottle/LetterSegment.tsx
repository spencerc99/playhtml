// ABOUTME: One read-only segment of the letter scroll — the letter text plus the
// ABOUTME: single sign-off row (signed name, cursor fingerprint, date-stamp imprint).

import type { BottleNote } from "../../features/BottleManager";
import { segmentStyle } from "./segmentStyles";
import { salutationAddress, currentFaviconUrl } from "./salutation";

/** The date as the rubber stamp pressed it, e.g. "MAR 3, 2026". */
export function formatStampDate(ts: number): string {
  return new Date(ts)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
}

/** The author's cursor pressed into the sheet — an inked, embossed thumbprint.
 *  The silhouette is filled softly in the author color, with fine ridge lines
 *  and stipple inside; CSS drop-shadows and multiply blend read it as pressed. */
export function Fingerprint({ color }: { color: string }) {
  return (
    <svg className="mbs-fingerprint" viewBox="0 0 14 18" aria-hidden="true">
      {/* the cursor silhouette, filled low so the paper shows through the ink */}
      <path
        d="M1 1 L1 13.5 L4.4 10.6 L6.6 16 L9 15 L6.9 9.8 L11.4 9.6 Z"
        fill={color}
        opacity="0.55"
      />
      {/* fine ridge lines following the shape — the thumbprint's whorls */}
      <path
        d="M2.4 3.1 L2.4 11.2 M3.6 3.6 L3.6 10.2 M4.8 4.2 L4.8 9.3"
        fill="none"
        stroke={color}
        strokeWidth="0.4"
        opacity="0.4"
      />
      {/* stipple — where the press caught more ink */}
      <g fill={color} opacity="0.5">
        <circle cx="3" cy="5.2" r="0.35" />
        <circle cx="4.3" cy="7" r="0.35" />
        <circle cx="3.5" cy="8.8" r="0.3" />
        <circle cx="5.6" cy="6.2" r="0.3" />
        <circle cx="6.4" cy="10.4" r="0.3" />
      </g>
    </svg>
  );
}

export function LetterSegment({ note }: { note: BottleNote }) {
  const style = segmentStyle(note.styleId);
  const pageUrl = note.pageUrl ?? window.location.href;
  const address = salutationAddress(pageUrl, note.pageTitle);
  const favicon = note.faviconUrl ?? currentFaviconUrl();
  return (
    <>
      <div className={`mbs-segment ${style.className}`} style={{ color: style.ink }}>
        <div className="mbs-salutation">
          {favicon && <img className="mbs-salutationFavicon" src={favicon} alt="" />}
          <span>
            dear{" "}
            <a
              className="mbs-salutationSite"
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
            >
              {address}
            </a>
            ,
          </span>
        </div>
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
