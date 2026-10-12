// ABOUTME: Styles for the published-collage viewer: the framed sheet and caption, hover lift, source tags and states.
// ABOUTME: Layered over the studio's sheet and piece rules, in its --c-* palette, so the collage reads the same.

export const VIEWER_STYLES = `
  .published-collage {
    --c-ground: #f6f5f1;
    --c-surface: #efede7;
    --c-frame: #fdfcfa;
    --c-mat: #e6e3dc;
    --c-ink: #3a3734;
    --c-muted: #86807a;
    --c-accent: #4a9a8a;
    --c-accent-ink: #2f6b60;
    --c-rule: #dcd8cf;
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: var(--c-ground);
    color: var(--c-ink);
    font-family: "Martian Mono", ui-monospace, monospace;
  }

  /* The same wordmark the extension's pages carry at their top-left. */
  .published-collage__mark {
    flex: 0 0 auto;
    color: var(--c-ink);
    font-family: "Source Serif 4", "Lora", Georgia, serif;
    font-size: 17px;
    font-style: italic;
    font-weight: 200;
    text-decoration: none;
  }

  .published-collage__mark:hover {
    color: var(--c-ink);
  }

  .published-collage__views-label {
    padding: 0 6px 0 4px;
    color: var(--c-muted);
    font-size: 9.5px;
  }

  /* The page holds the studio's mat, centered, with room kept above and below. */
  .published-collage__stage {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  /* The studio's toolbar row over the mat: the mark at left, views at right. */
  .published-collage__toolbar {
    flex: none;
    box-sizing: border-box;
    max-width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .published-collage__toolbar .collage-views {
    position: static;
  }

  /* The title is written where the studio's title field sits, read only. */
  .published-collage__title {
    margin: 0;
    overflow: hidden;
    font-weight: 400;
    line-height: 1.6;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* The studio's spacer between the title and the count on the mat. */
  .published-collage .collage-bar__spacer {
    flex: 1 1 auto;
  }

  .published-collage__meta {
    flex: none;
    white-space: nowrap;
  }

  .published-collage__problem {
    margin: 0;
    color: #b0452c;
    font-size: 9.5px;
  }

  .published-collage__piece {
    transform: rotate(var(--piece-rotation));
    cursor: zoom-in;
    outline: none;
    transition: transform 160ms ease, filter 160ms ease;
  }

  .published-collage__piece--lifted,
  .published-collage__piece:focus-visible {
    transform: rotate(var(--piece-rotation)) scale(1.035);
    filter: drop-shadow(0 8px 14px rgba(40, 34, 28, 0.28));
  }

  .published-collage__piece:focus-visible {
    outline: 3px solid var(--c-accent);
  }

  .published-collage__favicon {
    display: inline-block;
    flex: 0 0 auto;
    border-radius: 2px;
    object-fit: contain;
  }

  .published-collage__hover {
    position: fixed;
    z-index: 10010;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-sizing: border-box;
    padding: 6px 8px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 22%, transparent);
    border-radius: 3px;
    background: var(--c-surface);
    box-shadow: 0 6px 18px color-mix(in srgb, var(--c-ink) 18%, transparent);
    font-size: 10px;
    line-height: 1.45;
    pointer-events: none;
  }

  .published-collage__hover-where {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
  }

  .published-collage__hover-title {
    overflow: hidden;
    color: var(--c-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .published-collage__tags {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .published-collage__edge {
    position: absolute;
    z-index: 10004;
    box-sizing: border-box;
    border-style: dotted;
    border-color: var(--peek-tint, var(--c-muted));
    transform-origin: center;
  }

  .published-collage__edge--on {
    border-style: solid;
  }

  .published-collage__tag {
    position: absolute;
    z-index: 10005;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 230px;
    padding: 2px 5px;
    transform-origin: left top;
    border: 1px solid var(--peek-tint, color-mix(in srgb, var(--c-ink) 50%, transparent));
    border-left-width: 3px;
    border-radius: 2px;
    background: var(--c-surface);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--c-ink) 18%, transparent);
    font-size: 9px;
    line-height: 1.5;
    white-space: nowrap;
  }

  .published-collage__tag-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 600px) {
    .published-collage__title {
      flex: 1 1 auto;
      min-width: 0;
    }

    .published-collage__toolbar .collage-view {
      padding: 0 6px;
    }
  }

  /* The notices (loading, missing, failed) keep the mark at the top-left. */
  .published-collage__head {
    position: absolute;
    top: 16px;
    left: 16px;
  }

  .published-collage--notice {
    display: grid;
    place-items: center;
  }

  .published-collage__notice {
    max-width: 420px;
    padding: 0 16px;
    text-align: center;
  }

  .published-collage__notice h1 {
    margin: 0 0 8px;
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    font-size: 20px;
    font-weight: 400;
  }

  .published-collage__notice p {
    margin: 0;
    color: var(--c-muted);
    font-size: 11px;
    line-height: 1.6;
  }

  .published-collage__loading {
    width: 120px;
    height: 2px;
    margin: 14px auto 0 !important;
    background: linear-gradient(90deg, transparent, var(--c-accent), transparent);
    background-size: 200% 100%;
    animation: published-collage-loading 1.2s linear infinite;
  }

  @keyframes published-collage-loading {
    from { background-position: 100% 0; }
    to { background-position: -100% 0; }
  }

  .published-collage__retry {
    margin-top: 14px;
    padding: 4px 10px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 24%, transparent);
    border-radius: 3px;
    background: transparent;
    color: var(--c-ink);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  @media (prefers-reduced-motion: reduce) {
    .published-collage__piece {
      transition: none;
    }
  }
`;
