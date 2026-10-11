// ABOUTME: Styles for the published-collage viewer: the framed sheet and caption, hover lift, source tags and states.
// ABOUTME: Layered over the studio's sheet and piece rules, in its --c-* palette, so the collage reads the same.

export const VIEWER_STYLES = `
  .published-collage {
    --c-ground: #f6f5f1;
    --c-surface: #efede7;
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

  .published-collage__head {
    position: absolute;
    top: 16px;
    left: 16px;
    right: 260px;
    z-index: 10001;
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }

  .published-collage__mark {
    flex: 0 0 auto;
    color: var(--c-muted);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-decoration: none;
  }

  .published-collage__mark:hover {
    color: var(--c-ink);
  }

  .published-collage__title {
    margin: 0;
    overflow: hidden;
    font-family: "Lora", Georgia, serif;
    font-size: 19px;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .published-collage__views-label {
    padding: 0 6px 0 4px;
    color: var(--c-muted);
    font-size: 9.5px;
  }

  .published-collage__stage {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .published-collage__fit {
    position: relative;
    flex: none;
  }

  /* The studio's sheet, zoomed from its corner to fit the page. */
  .published-collage__sheet {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }

  /* The caption sits under the frame like a label on a mount. */
  .published-collage__caption {
    flex: none;
    box-sizing: border-box;
    max-width: calc(100vw - 32px);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding-top: 14px;
  }

  .published-collage__about {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .published-collage__meta {
    margin: 0;
    color: var(--c-muted);
    font-size: 9.5px;
    letter-spacing: 0.03em;
  }

  .published-collage__problem {
    margin: 0;
    color: #b0452c;
    font-size: 9.5px;
  }

  .published-collage__turn {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--c-rule);
    border-radius: 4px;
    background: var(--c-surface);
    color: var(--c-ink);
    font-family: "Martian Mono", monospace;
    font-size: 9.5px;
    cursor: pointer;
  }

  .published-collage__turn:hover {
    border-color: color-mix(in srgb, var(--c-ink) 24%, transparent);
  }

  .published-collage__turn[aria-pressed="true"] {
    border-color: color-mix(in srgb, var(--c-accent) 70%, transparent);
    background: color-mix(in srgb, var(--c-accent) 12%, transparent);
    color: var(--c-accent-ink);
  }

  .published-collage__turn:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 1px;
  }

  .published-collage__piece {
    transform: rotate(var(--piece-rotation));
    cursor: zoom-in;
    outline: none;
    transition: transform 160ms ease, opacity 160ms ease, filter 160ms ease;
  }

  .published-collage__frame--looking .published-collage__piece:not(.published-collage__piece--lifted) {
    opacity: 0.42;
    filter: saturate(0.7);
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
    .published-collage__head {
      right: 16px;
      flex-direction: column;
      gap: 2px;
    }

    .published-collage__title {
      font-size: 16px;
      white-space: normal;
    }

    .published-collage .collage-views {
      top: 10px;
      right: 10px;
    }
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
