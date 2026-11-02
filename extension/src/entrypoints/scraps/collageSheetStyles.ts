// ABOUTME: The studio rules for the collage mat and sheet (front, back and the turn between) and placed piece material.
// ABOUTME: Shared by the studio stylesheet and the published-collage viewer, so a piece looks the same in both.

/**
 * The sheet both faces sit on, the turn over to the back, and the back's own
 * writing. Uses the studio's --c-* palette.
 */
export const COLLAGE_SHEET_STYLES = `
  /* Both sides of the collage share one place on the stage. The sheet keeps
     the frame's true size and is only ever zoomed, never squeezed by the flex
     stage around it. */
  .collage-sheet {
    position: relative;
    flex: none;
    transform-origin: center;
    perspective: 6000px;
  }

  /* The sheet turns over the way a printed card does, about its vertical axis. */
  .collage-sheet__leaf {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
    transition: transform 560ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }

  .collage-sheet--over .collage-sheet__leaf {
    transform: rotateY(180deg);
  }

  /* The frame's paper comes from the record, so the studio shows what bakes. */
  .collage-frame {
    position: relative;
    box-shadow: 0 10px 34px color-mix(in srgb, var(--c-ink) 16%, transparent);
    touch-action: none;
    backface-visibility: hidden;
  }

  /* What bakes stops at the frame's edge, so the pieces are clipped there. */
  .collage-frame__pieces {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  /* The back: the same paper, the front faintly through it, and the sources. */
  .collage-back {
    position: absolute;
    inset: 0;
    overflow: hidden;
    box-shadow: 0 10px 34px color-mix(in srgb, var(--c-ink) 16%, transparent);
    backface-visibility: hidden;
    transform: rotateY(180deg);
    user-select: text;
  }

  .collage-back__text {
    position: absolute;
    inset: 0;
  }

  /* The field over it shows the title, so the written one only holds its place. */
  .collage-back__text--titled .collage-back__title {
    visibility: hidden;
  }

  /* The title on the back, editable where it is written. It always reads as
     the writing itself: no outline or text cursor, only a caret once it is
     clicked into. */
  .collage-back__title-field {
    position: absolute;
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    overflow: hidden;
    overflow-wrap: anywhere;
    resize: none;
    cursor: inherit;
  }

  .collage-back__title-field::placeholder {
    color: var(--collage-back-muted);
    opacity: 1;
  }

  /* The side facing away takes no pointer, however the sheet turned over. */
  .collage-sheet__leaf > [inert] {
    pointer-events: none;
  }

  /* A sheet that cannot swing still turns over, just as a crossfade. */
  @media (prefers-reduced-motion: reduce) {
    .collage-sheet__leaf,
    .collage-sheet--over .collage-sheet__leaf {
      transform: none;
      transition: none;
    }

    .collage-frame,
    .collage-back {
      backface-visibility: visible;
      transition: opacity 180ms linear;
    }

    .collage-back {
      transform: none;
    }

    .collage-sheet__leaf > [inert] {
      opacity: 0;
    }
  }

  .collage-frame__edge {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c-ink) 16%, transparent);
  }
`;

/**
 * A placed piece and the material inside it: the source box, lettering, and
 * how icons, buttons and cursors fill their piece the way the bake draws them.
 */
export const PIECE_MATERIAL_STYLES = `
  .collage-piece {
    position: absolute;
    overflow: hidden;
    transform-origin: center;
    user-select: none;
  }

  .collage-piece__source {
    position: absolute;
  }

  /* The box a heading or button is set in before it is scaled to its piece. */
  .collage-piece__lettering {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: left top;
  }

  /* A placed piece fills its box whatever kind of scrap it came from. */
  .collage-piece__source .scrap-collage__svg,
  .collage-piece__source .scrap-collage__button {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Matches how the bake draws a button, so the studio is what you get. */
  .collage-piece__source .scrap-collage__button {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .collage-piece__source .scrap-collage__svg svg {
    width: 100%;
    height: 100%;
  }

  /*
   * A cursor is pinned to 32px on the browse surface. A placed piece is sized
   * by its own box instead, so the pin and its centering offset are undone —
   * the studio must show exactly what the bake draws.
   */
  .collage-piece__source .scrap-collage__cursor,
  .collage-tray__thumb .scrap-collage__cursor {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transform: none;
  }

  /* The swatch stand-in follows the same box as the cursor it sits under. */
  .collage-piece__source .scrap-collage__swatch,
  .collage-tray__thumb .scrap-collage__swatch {
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    transform: none;
  }
`;

/**
 * The mat the frame is mounted on, with the collage's caption (its title,
 * count and date) written along its bottom edge.
 */
export const COLLAGE_MAT_STYLES = `
  /* The mat: a board the frame is mounted on, with the collage's caption
     written along its bottom edge. Its size is set in pixels from the zoom,
     so the caption stays one size however the frame is fitted. */
  .collage-mat {
    position: relative;
    flex: none;
    background: var(--c-mat);
    box-shadow:
      0 1px 0 color-mix(in srgb, #fff 70%, transparent) inset,
      0 0 0 1px var(--c-rule),
      0 10px 24px color-mix(in srgb, var(--c-ink) 8%, transparent);
  }
  .collage-mat__window {
    position: absolute;
  }
  .collage-mat .collage-sheet {
    transform-origin: 0 0;
  }
  .collage-mat .collage-frame {
    box-shadow:
      inset 1px 1px 0 color-mix(in srgb, var(--c-ink) 14%, transparent),
      0 0 0 1px color-mix(in srgb, #fff 80%, transparent);
  }
  .collage-mat__caption {
    position: absolute;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 24px;
  }

  .collage-title-input {
    flex: 0 1 300px;
    min-width: 120px;
    padding: 2px 0;
    border: none;
    border-bottom: 1px dotted var(--c-muted);
    background: transparent;
    color: var(--c-ink);
    font-family: "Lora", Georgia, serif;
    font-size: 15px;
  }

  .collage-title-input:focus {
    outline: none;
    border-bottom-color: color-mix(in srgb, var(--c-accent) 80%, transparent);
  }

  .collage-title-input::placeholder {
    color: color-mix(in srgb, var(--c-muted) 70%, transparent);
  }
`;
