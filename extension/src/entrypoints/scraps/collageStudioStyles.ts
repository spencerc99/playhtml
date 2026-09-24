// ABOUTME: Stylesheet for the scrap collage studio, tray, and history surfaces.
// ABOUTME: Warm paper chrome that stays quiet behind the collaged material.

export const COLLAGE_STUDIO_STYLES = `
  .collage-studio {
    position: absolute;
    inset: 0;
    display: flex;
    color: #3d3833;
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
  }

  .collage-studio__label {
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: lowercase;
    color: #827a72;
  }

  .collage-tray {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 10px 8px 8px;
    gap: 6px;
    border-right: 1px solid rgba(61, 56, 51, 0.12);
  }

  .collage-tray__count {
    margin: 0;
  }

  .collage-tray__reset {
    padding: 0;
    border: 0;
    background: transparent;
    color: #33796d;
    font: inherit;
    letter-spacing: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .collage-tray__reset:focus-visible {
    outline: 2px solid rgba(74, 154, 138, 0.45);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .collage-tray__sizes {
    display: flex;
    flex: 0 0 auto;
    gap: 2px;
  }

  .collage-tray__size {
    width: 17px;
    height: 17px;
    padding: 0;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 3px;
    background: transparent;
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    text-transform: uppercase;
    cursor: pointer;
  }

  .collage-tray__size--on {
    border-color: rgba(74, 154, 138, 0.7);
    background: rgba(74, 154, 138, 0.12);
    color: #2f6b60;
  }

  .collage-tray__tuck {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 999px;
    background: transparent;
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease;
  }

  .collage-tray__tuck:hover {
    border-color: rgba(61, 56, 51, 0.38);
    color: #3d3833;
  }

  .collage-tray__tuck:focus-visible {
    outline: none;
    border-color: #4a9a8a;
    box-shadow: 0 0 0 3px rgba(74, 154, 138, 0.16);
  }

  .collage-tray__rail {
    flex: 0 0 auto;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 3px;
    background: transparent;
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    line-height: 1;
    padding: 4px 5px;
    cursor: pointer;
  }

  .collage-tray--tucked {
    padding: 10px 4px;
    align-items: center;
  }

  .collage-tray__rail {
    height: 100%;
    font-size: 8px;
    letter-spacing: 0.1em;
    writing-mode: vertical-rl;
    padding: 8px 3px;
  }

  /* The drawer's inner edge, dragged to resize it. */
  .collage-tray__grip {
    position: absolute;
    top: 0;
    right: -3px;
    width: 7px;
    height: 100%;
    cursor: ew-resize;
    touch-action: none;
  }

  .collage-tray__grip:hover {
    background: rgba(74, 154, 138, 0.25);
  }

  .collage-tray__scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .collage-tray__runway {
    position: relative;
    width: 100%;
  }

  .collage-tray__slot {
    position: absolute;
    display: block;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    cursor: grab;
  }

  .collage-tray__slot:hover,
  .collage-tray__slot:focus-visible {
    border-color: rgba(61, 56, 51, 0.28);
    background: rgba(61, 56, 51, 0.05);
    outline: none;
  }

  .collage-tray__thumb {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 2px;
  }

  /*
   * A chequer says "this has holes in it", so it only goes behind material
   * that really does: an icon, a cursor, or a picture whose own pixels turned
   * out to be see-through. Everything else sits on the paper.
   */
  .collage-tray__thumb--checker {
    background-color: #f3efe8;
    background-image:
      linear-gradient(45deg, rgba(61, 56, 51, 0.07) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(61, 56, 51, 0.07) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(61, 56, 51, 0.07) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(61, 56, 51, 0.07) 75%);
    background-size: 12px 12px;
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  }

  /* A small thing gets a plain box so it is legible without being blown up. */
  .collage-tray__thumb--small {
    border: 1px solid rgba(61, 56, 51, 0.16);
  }

  /*
   * A button sits on the paper, but plenty of them are white on white, so the
   * patch keeps a hairline edge — otherwise the scrap is invisible in the
   * drawer even though it is really there.
   */
  .collage-tray__thumb--paper {
    border: 1px solid rgba(61, 56, 51, 0.1);
  }

  /*
   * A scrap that brought its page's own backdrop paints it itself, so the
   * drawer adds nothing behind it and only keeps it inside the cell.
   */
  .collage-tray__thumb--own {
    background: transparent;
  }

  /* Nothing may spill out of its own cell into the one beside it. */
  .collage-tray__thumb > * {
    max-width: 100%;
    max-height: 100%;
  }

  /* The page's own backdrop patch fills the cell it was given. */
  .collage-tray__thumb .scrap-collage__backdrop {
    width: 100%;
    height: 100%;
  }

  .collage-tray__slot {
    box-sizing: border-box;
  }

  /* Nothing in the tray is cropped; a picture fits whole inside its slot. */
  .collage-tray__thumb .scrap-collage__image {
    object-fit: contain;
  }

  /*
   * A small thing is shown at a legible size rather than lost in a big empty
   * slot, but never blown up far past what it really is.
   */
  .collage-tray__thumb .scrap-collage__cursor {
    width: auto;
    height: auto;
    max-width: 64px;
    max-height: 64px;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }

  .collage-tray__thumb .scrap-collage__button,
  .collage-tray__thumb .scrap-collage__svg {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    max-height: 100%;
    overflow: hidden;
  }

  /*
   * A button's reconstruction carries the page's own width, padding and font
   * size, which is usually wider than a drawer cell. In the drawer those give
   * way to the cell, so the whole button is seen rather than a slice of it.
   */
  .collage-tray__thumb .scrap-collage__button {
    box-sizing: border-box;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: 100% !important;
    max-height: 100% !important;
    min-height: 0 !important;
    padding: 2px 4px !important;
    font-size: 10px !important;
    line-height: 1.2 !important;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .collage-tray__thumb .scrap-collage__svg svg,
  .collage-tray__thumb .scrap-collage__button svg {
    max-width: 100%;
    max-height: 100%;
  }

  /* Pieces dragged past the frame stay visible, quietly, so none are lost. */
  .collage-piece--off-frame {
    opacity: 0.45;
    outline: 1px dashed rgba(196, 114, 78, 0.6);
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
    border: 1px solid rgba(61, 56, 51, 0.2);
    border-radius: 4px;
    background: #f5f0e8;
    box-shadow: 0 4px 14px rgba(61, 56, 51, 0.18);
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
    background: rgba(61, 56, 51, 0.2);
  }

  /* Undo, redo and the shortcut list, in the stage's top-left corner. */
  /* The stage's top-left row: the way back, then the studio tools. */
  .collage-stage-top {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .collage-leave {
    padding: 4px 2px;
    border: none;
    background: none;
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  .collage-leave:hover,
  .collage-leave:focus-visible {
    color: #3d3833;
  }

  .collage-tools {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 4px;
    border: 1px solid rgba(61, 56, 51, 0.16);
    border-radius: 4px;
    background: rgba(245, 240, 232, 0.94);
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
    color: #3d3833;
    cursor: pointer;
  }

  .collage-glyph:hover:not(:disabled) {
    border-color: rgba(61, 56, 51, 0.24);
    background: rgba(61, 56, 51, 0.07);
  }

  .collage-glyph:disabled {
    color: rgba(130, 122, 114, 0.45);
    cursor: default;
  }

  .collage-glyph--on {
    border-color: rgba(74, 154, 138, 0.7);
    background: rgba(74, 154, 138, 0.12);
    color: #2f6b60;
  }

  .collage-glyph--danger:hover:not(:disabled) {
    border-color: rgba(196, 114, 78, 0.6);
    background: rgba(196, 114, 78, 0.12);
    color: #a2542f;
  }

  /* The document's own settings, opposite the studio tools. */
  .collage-format {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border: 1px solid rgba(61, 56, 51, 0.16);
    border-radius: 4px;
    background: rgba(245, 240, 232, 0.94);
  }

  .collage-paper-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .collage-paper-button__swatch {
    width: 10px;
    height: 10px;
    border: 1px solid rgba(61, 56, 51, 0.35);
    border-radius: 2px;
  }

  .collage-paper-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 10002;
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 232px;
    padding: 9px 10px;
    border: 1px solid rgba(61, 56, 51, 0.2);
    border-radius: 4px;
    background: #f5f0e8;
    box-shadow: 0 10px 28px rgba(61, 56, 51, 0.2);
  }

  .collage-paper-popover p.collage-studio__label {
    margin: 2px 0 0;
  }

  .collage-format__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .collage-swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid rgba(61, 56, 51, 0.28);
    border-radius: 3px;
    cursor: pointer;
  }

  .collage-swatch--on {
    outline: 1px solid #2f6b60;
    outline-offset: 1px;
  }

  .collage-swatch--custom {
    background: transparent;
  }

  /* The paper's grain, beside the tones it lies over. */
  .collage-grain {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 2px;
    cursor: pointer;
  }

  .collage-grain input {
    accent-color: #4a9a8a;
    margin: 0;
  }

  .collage-format__confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    margin: 0;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1.5;
    color: #8f4a29;
  }

  .collage-card--unreadable {
    border-style: dashed;
    border-color: rgba(196, 114, 78, 0.5);
    background: rgba(196, 114, 78, 0.06);
  }

  .collage-frame-area {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .collage-frame-area__stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    overflow: hidden;
  }

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
    box-shadow: 0 10px 34px rgba(61, 56, 51, 0.16);
    overflow: hidden;
    touch-action: none;
    backface-visibility: hidden;
  }

  /* The back: the same paper, the front faintly through it, and the sources. */
  .collage-back {
    position: absolute;
    inset: 0;
    overflow: hidden;
    box-shadow: 0 10px 34px rgba(61, 56, 51, 0.16);
    backface-visibility: hidden;
    transform: rotateY(180deg);
    user-select: text;
  }

  .collage-back__text {
    position: absolute;
    inset: 0;
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
    box-shadow: inset 0 0 0 1px rgba(61, 56, 51, 0.16);
  }

  .collage-frame--drop-target {
    box-shadow: 0 10px 34px rgba(61, 56, 51, 0.16), inset 0 0 0 2px rgba(74, 154, 138, 0.5);
  }

  .collage-piece {
    position: absolute;
    overflow: hidden;
    transform-origin: center;
    user-select: none;
  }

  .collage-piece__source {
    position: absolute;
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

  .collage-piece--selected {
    outline: 1px solid rgba(74, 154, 138, 0.85);
    outline-offset: 0;
  }

  .collage-handle {
    position: absolute;
    width: 11px;
    height: 11px;
    margin: -6px 0 0 -6px;
    border: 1px solid rgba(61, 56, 51, 0.55);
    border-radius: 2px;
    background: #fffdf9;
    padding: 0;
    cursor: grab;
  }

  .collage-handle--rotate {
    border-radius: 50%;
    cursor: crosshair;
  }

  .collage-handle__tether {
    position: absolute;
    width: 1px;
    background: rgba(61, 56, 51, 0.4);
    pointer-events: none;
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
    background: rgba(61, 56, 51, 0.62);
    pointer-events: none;
  }

  .collage-crop__kept {
    position: absolute;
    box-shadow: 0 0 0 1px #fffdf9;
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

  /* Small readout that rides above a piece during a modal rotate or scale. */
  .collage-readout {
    position: absolute;
    margin: 0;
    padding: 2px 6px;
    z-index: 10002;
    transform-origin: center bottom;
    border: 1px solid rgba(61, 56, 51, 0.2);
    border-radius: 3px;
    background: #f5f0e8;
    color: #3d3833;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.04em;
    white-space: nowrap;
    pointer-events: none;
  }

  /* What a click would take. Faint, because it is only a hint. */
  .collage-piece-hover {
    position: absolute;
    z-index: 9998;
    border-style: solid;
    border-color: rgba(61, 56, 51, 0.32);
    transform-origin: center;
    pointer-events: none;
  }

  /* Every piece stacked under the pointer, so a buried one can be picked by
     eye rather than by clicking down through the pile. */
  .collage-here {
    position: absolute;
    z-index: 10007;
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 196px;
    max-height: 260px;
    overflow-y: auto;
    padding: 5px;
    transform-origin: left top;
    border: 1px solid rgba(61, 56, 51, 0.2);
    border-radius: 4px;
    background: #f5f0e8;
    box-shadow: 0 10px 28px rgba(61, 56, 51, 0.22);
  }

  .collage-here__head {
    margin: 0 0 3px 2px;
  }

  .collage-here__row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .collage-here__row:hover {
    border-color: rgba(61, 56, 51, 0.2);
    background: rgba(61, 56, 51, 0.06);
  }

  .collage-here__row--on {
    border-color: rgba(74, 154, 138, 0.7);
    background: rgba(74, 154, 138, 0.1);
  }

  .collage-here__thumb {
    position: relative;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    overflow: hidden;
    border: 1px solid rgba(61, 56, 51, 0.16);
    border-radius: 2px;
    background: #fffdf9;
  }

  .collage-here__thumb > * {
    max-width: 100%;
    max-height: 100%;
  }

  .collage-here__thumb img,
  .collage-here__thumb svg {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .collage-here__what {
    display: flex;
    min-width: 0;
    flex-direction: column;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    line-height: 1.5;
    letter-spacing: 0.02em;
  }

  .collage-here__kind {
    color: #3d3833;
  }

  .collage-here__where {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #827a72;
  }

  /* The peeked piece's own edge, so its label has something to belong to. */
  .collage-peek-edge {
    position: absolute;
    z-index: 10004;
    border-style: dotted;
    border-color: #827a72;
    transform-origin: center;
    pointer-events: none;
  }

  .collage-peek-edge--on {
    border-style: solid;
    border-color: #3d3833;
  }

  /* An archive label pinned to a piece while the peek key is held. It is a
     slip of paper over the work, never a control: it takes no pointer. */
  .collage-peek {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-width: 230px;
    padding: 2px 5px;
    transform-origin: left top;
    border: 1px solid rgba(61, 56, 51, 0.28);
    border-radius: 2px;
    background: #f5f0e8;
    /* A tag at rest is as quiet as its dotted edge; the hovered one is ink. */
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    line-height: 1.5;
    letter-spacing: 0.02em;
    pointer-events: none;
    user-select: none;
  }

  .collage-peek--full {
    border-color: rgba(61, 56, 51, 0.5);
    color: #3d3833;
    box-shadow: 0 2px 8px rgba(61, 56, 51, 0.18);
  }

  .collage-peek__where {
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }

  .collage-peek__mark {
    display: block;
    width: 10px;
    height: 10px;
    object-fit: contain;
  }

  .collage-peek__more {
    display: flex;
    flex-direction: column;
    padding-top: 1px;
    border-top: 1px solid rgba(61, 56, 51, 0.14);
    color: #827a72;
  }

  .collage-peek__line {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Where the save button used to be: a quiet word on how the work stands. */
  .collage-standing {
    margin: 0;
    padding: 0 4px;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.03em;
    color: #827a72;
    white-space: nowrap;
  }

  .collage-standing--problem {
    color: #c4724e;
  }

  .collage-tolerance {
    position: absolute;
    z-index: 10002;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    transform: translateX(-50%);
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 3px;
    background: #f5f0e8;
  }

  .collage-tolerance input {
    width: 96px;
    accent-color: #4a9a8a;
  }

  .collage-piece__cut {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
  }

  /* A cut that is still being computed, and one that could not be read. */
  .collage-piece__pending {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      45deg,
      rgba(61, 56, 51, 0.06),
      rgba(61, 56, 51, 0.06) 4px,
      transparent 4px,
      transparent 8px
    );
  }

  .collage-piece__missing {
    position: absolute;
    inset: 0;
    border: 1px dashed rgba(196, 114, 78, 0.7);
    background: rgba(196, 114, 78, 0.08);
  }

  .collage-keys {
    position: absolute;
    right: 16px;
    bottom: 16px;
    z-index: 10003;
    width: 310px;
    max-height: calc(100% - 32px);
    overflow-y: auto;
    padding: 10px 12px;
    border: 1px solid rgba(61, 56, 51, 0.2);
    border-radius: 4px;
    background: #f5f0e8;
    box-shadow: 0 10px 28px rgba(61, 56, 51, 0.2);
  }

  .collage-keys__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .collage-keys__close {
    border: none;
    background: transparent;
    color: #827a72;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    padding: 0 2px;
  }

  .collage-keys__group {
    margin-top: 8px;
  }

  .collage-keys__group-name {
    margin: 0 0 3px;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    letter-spacing: 0.08em;
    color: #827a72;
  }

  .collage-keys__row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0;
    padding: 3px 0;
    font-size: 11px;
    line-height: 1.4;
  }

  .collage-keys__combo {
    flex: 0 0 132px;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    letter-spacing: 0.02em;
    color: #3d3833;
  }

  .collage-keys__what {
    color: #827a72;
  }

  .collage-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-top: 1px solid rgba(61, 56, 51, 0.12);
  }

  .collage-bar__spacer {
    flex: 1 1 auto;
  }

  .collage-title-input {
    flex: 0 1 260px;
    min-width: 120px;
    padding: 4px 6px;
    border: none;
    border-bottom: 1px solid rgba(61, 56, 51, 0.28);
    background: transparent;
    color: #3d3833;
    font-family: "Lora", Georgia, serif;
    font-size: 15px;
  }

  /* Stands where the title was, at the title field's height, so turning over
     never changes the bar's height or the frame's zoom. */
  .collage-bar__turned {
    display: inline-flex;
    align-items: center;
    min-height: 29px;
  }

  .collage-title-input:focus {
    outline: none;
    border-bottom-color: rgba(74, 154, 138, 0.8);
  }

  .collage-title-input::placeholder {
    color: rgba(130, 122, 114, 0.7);
  }

  .collage-action {
    padding: 4px 9px;
    border: 1px solid rgba(61, 56, 51, 0.22);
    border-radius: 3px;
    background: transparent;
    color: #3d3833;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.04em;
    cursor: pointer;
  }

  .collage-action:hover:not(:disabled) {
    background: rgba(61, 56, 51, 0.07);
  }

  .collage-action:disabled {
    color: rgba(130, 122, 114, 0.6);
    border-color: rgba(61, 56, 51, 0.12);
    cursor: default;
  }

  .collage-action--primary {
    border-color: rgba(74, 154, 138, 0.7);
    color: #2f6b60;
  }

  .collage-action--danger:hover:not(:disabled) {
    background: rgba(196, 114, 78, 0.12);
    border-color: rgba(196, 114, 78, 0.6);
    color: #a2542f;
  }

  .collage-notice {
    padding: 6px 14px;
    border-top: 1px solid rgba(196, 114, 78, 0.35);
    background: rgba(196, 114, 78, 0.1);
    color: #8f4a29;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1.6;
    letter-spacing: 0.02em;
  }

  .collage-notice--quiet {
    border-top-color: rgba(61, 56, 51, 0.12);
    background: rgba(74, 154, 138, 0.08);
    color: #2f6b60;
  }

  .collage-history {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 18px 22px 40px;
    color: #3d3833;
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
  }

  .collage-history__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px 24px;
    margin-bottom: 18px;
  }

  .collage-history__title {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  /* A scrap torn from the newest collage: the shadow sits on the holder so
     the torn edge the clip cuts still casts one. */
  .collage-history__scrap {
    flex: none;
    display: block;
    width: 46px;
    height: 38px;
    transform: rotate(-6deg);
    filter: drop-shadow(0 2px 3px rgba(61, 56, 51, 0.22));
  }

  .collage-history__scrap-paper {
    display: block;
    width: 100%;
    height: 100%;
    background: #c9a47a;
    clip-path: polygon(
      2% 6%, 18% 1%, 34% 5%, 52% 0%, 71% 4%, 88% 1%, 99% 7%,
      96% 29%, 100% 51%, 97% 74%, 99% 95%, 81% 99%, 63% 95%,
      44% 100%, 26% 96%, 9% 100%, 1% 92%, 4% 70%, 0% 47%, 3% 25%
    );
  }

  .collage-history__scrap-paper img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .collage-history__heading {
    margin: 0;
    font-family: "Lora", Georgia, serif;
    font-size: 26px;
    font-weight: 600;
    line-height: 1.15;
    color: #3d3833;
  }

  .collage-history__summary {
    margin: 4px 0 0;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.02em;
    color: #827a72;
  }

  .collage-history__start {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .collage-history__import {
    padding: 0;
    border: 0;
    background: none;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    font-weight: 400;
    color: #827a72;
    cursor: pointer;
  }

  .collage-history__import:hover {
    color: #3d3833;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .collage-history__import:focus-visible {
    color: #3d3833;
    outline: 2px solid rgba(74, 154, 138, 0.45);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .collage-history__tagline {
    margin: 0;
    font-family: "Lora", Georgia, serif;
    font-size: 11px;
    font-style: italic;
    color: #827a72;
  }

  .collage-history__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 18px;
  }

  .collage-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px;
    border: 1px solid rgba(61, 56, 51, 0.14);
    border-radius: 3px;
    background: #fffdf9;
    box-shadow: 0 4px 14px rgba(61, 56, 51, 0.08);
    transition: box-shadow 140ms ease, border-color 140ms ease;
  }

  .collage-card:hover,
  .collage-card:focus-within {
    border-color: rgba(61, 56, 51, 0.26);
    box-shadow: 0 6px 18px rgba(61, 56, 51, 0.13);
  }

  /* The whole card face is one button that opens the collage. */
  .collage-card__open {
    display: flex;
    flex-direction: column;
    gap: 7px;
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .collage-card__open:focus-visible {
    outline: 2px solid rgba(74, 154, 138, 0.8);
    outline-offset: 3px;
  }

  /* The thumbnail sits on the collage's own paper, set from the record. */
  .collage-card__thumb {
    display: block;
    width: 100%;
    aspect-ratio: 3 / 2;
    object-fit: contain;
  }

  /* A collage stored before its first bake shows a quiet face, not a break. */
  .collage-card__thumb--undrawn {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    border: 1px dashed rgba(61, 56, 51, 0.2);
  }

  .collage-card__title {
    display: block;
    font-family: "Lora", Georgia, serif;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
  }

  .collage-card__meta {
    display: block;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1.7;
    letter-spacing: 0.02em;
    color: #827a72;
  }

  /* The card's tools: a quiet row of the studio's glyphs, clearer on hover
     or focus but always there for the keyboard. */
  .collage-card__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-height: 26px;
    color: #827a72;
    opacity: 0.7;
    transition: opacity 140ms ease;
  }

  .collage-card:hover .collage-card__actions,
  .collage-card:focus-within .collage-card__actions {
    opacity: 1;
  }

  .collage-card__actions .collage-glyph {
    color: inherit;
  }

  .collage-card__actions-gap {
    flex: 1 1 auto;
  }
`;
