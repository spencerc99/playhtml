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

  /* The maker's stamp, with who and when shown on hover or focus. */
  .published-collage__signed {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    outline: none;
  }

  .published-collage__signed-tip {
    position: absolute;
    right: -6px;
    bottom: calc(100% + 8px);
    z-index: 10010;
    display: flex;
    flex-direction: column;
    padding: 6px 8px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 22%, transparent);
    border-radius: 3px;
    background: var(--c-surface);
    box-shadow: 0 6px 18px color-mix(in srgb, var(--c-ink) 18%, transparent);
    color: var(--c-ink);
    font-family: "Martian Mono", ui-monospace, monospace;
    font-size: 10px;
    line-height: 1.45;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    transition: opacity 140ms ease, visibility 140ms;
    pointer-events: none;
  }

  .published-collage__signed:hover .published-collage__signed-tip,
  .published-collage__signed:focus-visible .published-collage__signed-tip {
    opacity: 1;
    visibility: visible;
  }

  .published-collage__signed:focus-visible .signature-stamp {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
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
    transition: filter 220ms ease;
  }

  /* The opening reveal: a piece waits unseen for its picture and its turn,
     then is set down onto the paper. Fill backwards only, so the hover lift
     still works once it has landed. */
  .published-collage__piece--waiting {
    opacity: 0;
  }

  .published-collage__piece--arrived {
    animation: published-collage-set-down 460ms cubic-bezier(0.2, 0.8, 0.2, 1)
      backwards;
  }

  @keyframes published-collage-set-down {
    from {
      opacity: 0;
      transform: rotate(var(--piece-rotation)) translateY(-14px) scale(1.06);
      filter: drop-shadow(0 12px 16px rgba(40, 34, 28, 0.22));
    }
    to {
      opacity: 1;
      transform: rotate(var(--piece-rotation));
      filter: drop-shadow(0 0 0 rgba(40, 34, 28, 0));
    }
  }

  /* Hovering only lets a piece cast a faint shadow where it sits, so looking
     around the collage never shuffles it. */
  .published-collage__piece--lifted,
  .published-collage__piece:focus-visible {
    filter: drop-shadow(0 2px 5px rgba(40, 34, 28, 0.22));
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
    /* A short wait before the label shows, so sweeping across the collage stays quiet. */
    animation: published-collage-label-in 180ms ease 220ms backwards;
  }

  @keyframes published-collage-label-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
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

    .published-collage__piece--arrived,
    .published-collage__hover {
      animation: none;
    }
  }
`;
