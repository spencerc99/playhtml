// ABOUTME: Styles for the per-piece collage tools: action bar, crop handles, cutout tolerance.
// ABOUTME: Shared by the extension studio and the walk collage table, which define the --c-* palette.

export const COLLAGE_PIECE_TOOL_STYLES = `
  .collage-studio__label {
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: lowercase;
    color: var(--c-muted);
  }

  /* The piece's own tools, floating beside it in frame space. They are drawn
     at a constant on-screen size whatever the frame is zoomed to. */
  .collage-piece-actions {
    position: absolute;
    z-index: 10004;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 4px;
    transform-origin: left top;
    border: 1px solid color-mix(in srgb, var(--c-ink) 20%, transparent);
    border-radius: 4px;
    background: var(--c-surface);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--c-ink) 18%, transparent);
    /* Only the buttons take the pointer; the gaps belong to the frame. */
    pointer-events: none;
  }

  .collage-piece-actions > button {
    pointer-events: auto;
  }

  .collage-piece-actions__rule {
    width: 1px;
    height: 15px;
    margin: 0 3px;
    background: color-mix(in srgb, var(--c-ink) 20%, transparent);
  }

  .collage-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 24px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--c-ink);
    cursor: pointer;
  }

  .collage-glyph:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--c-ink) 24%, transparent);
    background: color-mix(in srgb, var(--c-ink) 7%, transparent);
  }

  .collage-glyph:disabled {
    color: color-mix(in srgb, var(--c-muted) 45%, transparent);
    cursor: default;
  }

  .collage-glyph--on {
    border-color: color-mix(in srgb, var(--c-accent) 70%, transparent);
    background: color-mix(in srgb, var(--c-accent) 12%, transparent);
    color: var(--c-accent-ink);
  }

  .collage-glyph--danger:hover:not(:disabled) {
    border-color: rgba(196, 114, 78, 0.6);
    background: rgba(196, 114, 78, 0.12);
    color: #a2542f;
  }

  .collage-handle {
    position: absolute;
    width: 13px;
    height: 13px;
    margin: -7px 0 0 -7px;
    border: 2px solid var(--c-accent);
    border-radius: 2px;
    background: var(--c-frame);
    padding: 0;
    cursor: grab;
  }

  /*
   * While cropping, the piece's whole source is laid out dimmed and the kept
   * region is punched back through at full strength, so the material waiting
   * outside the crop is visible to drag back in.
   */
  .collage-crop {
    position: absolute;
    transform-origin: center;
    z-index: 10001;
    touch-action: none;
  }

  .collage-crop__source {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .collage-crop__shade {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--c-ink) 62%, transparent);
    pointer-events: none;
  }

  .collage-crop__kept {
    position: absolute;
    box-shadow: 0 0 0 1px var(--c-frame);
    cursor: move;
  }

  .collage-crop__window {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .collage-crop__reveal {
    position: absolute;
  }

  .collage-handle--crop {
    position: absolute;
    z-index: 2;
    pointer-events: auto;
  }

  /* The cutout's edge control takes the piece strip's place beside the piece,
     drawn at the same constant on-screen size. */
  .collage-tolerance {
    position: absolute;
    z-index: 10004;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 8px;
    transform-origin: left top;
    border: 1px solid color-mix(in srgb, var(--c-ink) 20%, transparent);
    border-radius: 4px;
    background: var(--c-surface);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--c-ink) 18%, transparent);
    white-space: nowrap;
  }

  .collage-tolerance input {
    width: 96px;
    accent-color: var(--c-accent);
  }

  .collage-tolerance__button {
    padding: 3px 6px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    color: var(--c-ink);
    cursor: pointer;
  }

  .collage-tolerance__button:hover {
    border-color: color-mix(in srgb, var(--c-ink) 20%, transparent);
  }

  /* The invert toggle reads as held down while the backdrop is what stays. */
  .collage-tolerance__button[aria-pressed="true"] {
    border-color: color-mix(in srgb, var(--c-ink) 35%, transparent);
    background: color-mix(in srgb, var(--c-ink) 10%, transparent);
  }

  .collage-tolerance__button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .collage-tolerance__button:disabled:hover {
    border-color: transparent;
  }

  .collage-tolerance__button--done {
    border-color: color-mix(in srgb, var(--c-accent) 50%, transparent);
    color: var(--c-accent-ink);
  }

  .collage-piece__cut {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
  }

`;
