// ABOUTME: Styles for the shared-collage viewer: the fitted frame, hover lift and label, source tags and states.
// ABOUTME: Uses the studio's --c-* palette so the sources toggle and tags match the scraps studio.

export const VIEWER_STYLES = `
  .shared-collage {
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

  .shared-collage__head {
    position: absolute;
    top: 12px;
    left: 16px;
    right: 260px;
    z-index: 10001;
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }

  .shared-collage__mark {
    flex: 0 0 auto;
    color: var(--c-muted);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-decoration: none;
  }

  .shared-collage__mark:hover {
    color: var(--c-ink);
  }

  .shared-collage__title {
    margin: 0;
    overflow: hidden;
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    font-size: 17px;
    font-weight: 400;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .shared-collage__views-label {
    padding: 0 6px 0 4px;
    color: var(--c-muted);
    font-size: 9.5px;
  }

  .shared-collage__stage {
    position: absolute;
    left: 0;
    right: 0;
    display: grid;
    place-items: center;
  }

  .shared-collage__fit {
    position: relative;
  }

  .shared-collage__frame {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    box-shadow: 0 10px 34px color-mix(in srgb, var(--c-ink) 16%, transparent);
  }

  /* What shows stops at the frame's edge, as it does in the studio and the bake. */
  .shared-collage__pieces {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .shared-collage__piece {
    position: absolute;
    overflow: hidden;
    transform: rotate(var(--piece-rotation));
    transform-origin: center;
    cursor: zoom-in;
    user-select: none;
    outline: none;
    transition: transform 160ms ease, opacity 160ms ease, filter 160ms ease;
  }

  .shared-collage__frame--looking .shared-collage__piece:not(.shared-collage__piece--lifted) {
    opacity: 0.42;
    filter: saturate(0.7);
  }

  .shared-collage__piece--lifted,
  .shared-collage__piece:focus-visible {
    transform: rotate(var(--piece-rotation)) scale(1.035);
    filter: drop-shadow(0 8px 14px rgba(40, 34, 28, 0.28));
  }

  .shared-collage__piece:focus-visible {
    outline: 3px solid var(--c-accent);
  }

  .shared-collage__source {
    position: absolute;
    transform-origin: center;
    pointer-events: none;
  }

  .shared-collage__image {
    position: absolute;
    display: block;
    max-width: none;
  }

  .shared-collage__favicon {
    display: inline-block;
    flex: 0 0 auto;
    border-radius: 2px;
    object-fit: contain;
  }

  .shared-collage__hover {
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

  .shared-collage__hover-where {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
  }

  .shared-collage__hover-title {
    overflow: hidden;
    color: var(--c-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .shared-collage__tags {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .shared-collage__edge {
    position: absolute;
    z-index: 10004;
    box-sizing: border-box;
    border-style: dotted;
    border-color: var(--peek-tint, var(--c-muted));
    transform-origin: center;
  }

  .shared-collage__edge--on {
    border-style: solid;
  }

  .shared-collage__tag {
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

  .shared-collage__tag-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shared-collage__foot {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 12px;
    display: flex;
    justify-content: space-between;
    gap: 16px;
    color: var(--c-muted);
    font-size: 9.5px;
  }

  @media (hover: none), (max-width: 600px) {
    .shared-collage__hint {
      display: none;
    }
  }

  @media (max-width: 600px) {
    .shared-collage__head {
      right: 16px;
      flex-direction: column;
      gap: 2px;
    }

    .shared-collage__title {
      font-size: 15px;
    }

    .shared-collage .collage-views {
      top: auto;
      bottom: 34px;
      right: 50%;
      transform: translateX(50%);
    }
  }

  .shared-collage--notice {
    display: grid;
    place-items: center;
  }

  .shared-collage__notice {
    max-width: 420px;
    padding: 0 16px;
    text-align: center;
  }

  .shared-collage__notice h1 {
    margin: 0 0 8px;
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    font-size: 20px;
    font-weight: 400;
  }

  .shared-collage__notice p {
    margin: 0;
    color: var(--c-muted);
    font-size: 11px;
    line-height: 1.6;
  }

  .shared-collage__loading {
    width: 120px;
    height: 2px;
    margin: 14px auto 0 !important;
    background: linear-gradient(90deg, transparent, var(--c-accent), transparent);
    background-size: 200% 100%;
    animation: shared-collage-loading 1.2s linear infinite;
  }

  @keyframes shared-collage-loading {
    from { background-position: 100% 0; }
    to { background-position: -100% 0; }
  }

  .shared-collage__retry {
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
    .shared-collage__piece {
      transition: none;
    }
  }
`;
