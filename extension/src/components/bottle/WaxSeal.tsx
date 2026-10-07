// ABOUTME: The pressed wax seal that closes a bottle — a matte spread of wax in
// ABOUTME: the author's cursor color with their cursor silhouette debossed into it.

// The cursor silhouette pressed into the wax. Drawn three times: a dark copy
// shifted toward the upper-left lip and a light copy toward the lower-right so
// the mark reads recessed (light catches the lower lip of a deboss), plus a
// faint dark fill for depth.
const CURSOR_PATH = "M6.4 4.4 L6.4 10.6 L8.1 9.2 L9.2 11.8 L10.4 11.3 L9.3 8.8 L11.5 8.7 Z";
// An irregular spread blob — wax pressed by hand, not a perfect circle.
const BLOB_PATH =
  "M8.5 0.8 C11.5 0.4 14.6 1.6 15.6 4.2 C16.7 6.9 16.2 9.8 14.4 11.9 " +
  "C12.6 14.1 9.6 15.4 6.9 14.6 C4.1 13.9 1.4 12.2 0.9 9.4 " +
  "C0.4 6.6 1.6 3.6 3.9 2.1 C5.3 1.2 6.9 1 8.5 0.8 Z";

export function WaxSeal({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 17 16" aria-hidden="true">
      <path d={BLOB_PATH} fill={color} />
      <path d={BLOB_PATH} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="0.7" />
      {/* one small drip past the spread edge */}
      <circle cx="15.4" cy="12.8" r="1.15" fill={color} stroke="rgba(0,0,0,0.18)" strokeWidth="0.5" />
      <path d={CURSOR_PATH} fill="rgba(0,0,0,0.30)" transform="translate(-0.3,-0.35)" />
      <path d={CURSOR_PATH} fill="rgba(255,255,255,0.30)" transform="translate(0.3,0.35)" />
      <path d={CURSOR_PATH} fill="rgba(0,0,0,0.12)" />
    </svg>
  );
}
