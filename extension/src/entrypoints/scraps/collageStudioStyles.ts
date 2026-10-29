// ABOUTME: Stylesheet for the scrap collage studio, tray, and history surfaces.
// ABOUTME: Warm paper chrome that stays quiet behind the collaged material.

import { COLLAGE_PIECE_TOOL_STYLES } from "./collagePieceToolStyles";
import { COLLAGE_VIEW_STYLES } from "./collageViewStyles";
import { EXPORT_MENU_STYLES } from "./exportMenuStyles";
import {
  COLLAGE_MAT_STYLES,
  COLLAGE_SHEET_STYLES,
  PIECE_MATERIAL_STYLES,
} from "./collageSheetStyles";

/** The source labels and piece edges the peek shows, shared with the collage viewer page. */
export const COLLAGE_PEEK_STYLES = `
  /* The peeked piece's own edge, so its label has something to belong to. */
  /* While peeking, a piece and its label share one quiet tint, so the label
     can be matched to its piece where pieces sit close or overlap. */
  .collage-peek-edge {
    position: absolute;
    z-index: 10004;
    border-style: dotted;
    border-color: var(--peek-tint, var(--c-muted));
    transform-origin: center;
    pointer-events: none;
  }

  .collage-peek-edge--on {
    border-style: solid;
  }

  /* On a shared collage the edge is its adder's cursor color, drawn boldly
     so whose is whose reads across the table. */
  .collage-peek-edge--owned {
    border-style: solid;
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
    border: 1px solid var(--peek-tint, color-mix(in srgb, var(--c-ink) 50%, transparent));
    border-left-width: 3px;
    border-radius: 2px;
    background: var(--c-surface);
    color: var(--c-ink);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--c-ink) 18%, transparent);
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    line-height: 1.5;
    letter-spacing: 0.02em;
    pointer-events: none;
    user-select: none;
  }

  /* The same label, floated over the drawer for the scrap under the pointer.
     Fixed, so the drawer's scroll does not clip it. */
  .collage-peek--tray {
    position: fixed;
    z-index: 10010;
    border-left-width: 1px;
  }

  .collage-peek__where {
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }

  /* Who added a scrap, leading its label in their cursor's color. */
  .collage-peek__who {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }

  .collage-peek__dot {
    display: block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
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
    border-top: 1px solid color-mix(in srgb, var(--c-ink) 14%, transparent);
    color: var(--c-muted);
  }

  .collage-peek__line {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

`;

export const COLLAGE_STUDIO_STYLES = `
  /* The collage studio's palette: WWO's linen nudged a hair cooler. Every
     surface, rule and ink in the studio and the history reads from these. */
  .collage-studio,
  .collage-history {
    --c-ground: #f6f5f1;
    --c-surface: #efede7;
    --c-frame: #fdfcfa;
    --c-mat: #e6e3dc;
    --c-ink: #3a3734;
    --c-muted: #86807a;
    --c-accent: #4a9a8a;
    --c-accent-ink: #2f6b60;
    --c-rule: #dcd8cf;
  }

  .collage-studio {
    position: absolute;
    inset: 0;
    display: flex;
    background: var(--c-ground);
    color: var(--c-ink);
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
  }

  /* Create mode sits under the page's heading and its browse / create switch. */
  .collage-create-area {
    position: absolute;
    inset: 96px 0 0;
    z-index: 2;
  }

  /* A phone stacks the heading taller, so the list of collages starts lower;
     once a collage is open the heading steps away and the studio takes the
     screen from just under the page links. */
  @media (max-width: 620px) {
    .collage-create-area {
      top: 124px;
    }

    .collage-create-area--studio {
      top: 48px;
    }
  }

  /* On a phone the drawer docks under the collage, so the collage and the
     scraps to add to it are on screen together. */
  .collage-studio--phone {
    flex-direction: column;
  }

  .collage-studio--phone .collage-frame-area {
    order: 0;
  }

  /* Every touch on the stage is the studio's: a drag moves a piece or draws
     a marquee, and two fingers pinch, so the page must not scroll or zoom. */
  .collage-studio--phone .collage-frame-area__stage {
    touch-action: none;
    /* Holding a finger down opens the pieces-here list, not the system's
       text selection or its menu for the picture under it. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }

  /* Each tool beside a piece is big enough for a fingertip. */
  .collage-studio--phone .collage-piece-actions .collage-glyph {
    width: 36px;
    height: 36px;
  }

  .collage-studio--phone .collage-piece-actions__rule {
    height: 22px;
    margin: 0 2px;
  }

  /* The knob under a selection that turns it, on a touch screen. */
  .collage-rotate-stem {
    position: absolute;
    z-index: 10001;
    width: 1.5px;
    margin-left: -0.75px;
    transform-origin: top center;
    background: var(--c-accent);
    pointer-events: none;
  }

  .collage-rotate-knob {
    position: absolute;
    z-index: 10003;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1.5px solid var(--c-accent);
    border-radius: 50%;
    background: var(--c-surface);
    color: var(--c-accent-ink);
    transform-origin: center;
    touch-action: none;
  }

  /* A fingertip takes the knob from well around it. */
  .collage-rotate-knob::after {
    content: "";
    position: absolute;
    inset: -12px;
    border-radius: 50%;
  }

  /* A held finger must not raise the system's copy and look-up menu or
     start selecting text over the collage. */
  .collage-studio--phone .collage-frame-area {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }

  /* A held finger must not raise the system's copy and look-up menu or
     start selecting text over the collage. */
  .collage-studio--phone .collage-frame-area {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }

  /* Two classes, so this outranks the drawer's own side-docked size and
     margin, which come later; otherwise the drawer grows with its scraps
     and buries the collage. */
  .collage-tray.collage-tray--bottom {
    order: 1;
    flex: 0 0 40%;
    margin: 0 8px 8px;
    /* Its filter menus open upward over the collage, so they sit above the
       bars floating at the top of the stage. */
    z-index: 10020;
  }

  /* While the drawer is open on a phone the collage is being filled, so the
     format and export bar steps aside for it; tucking the drawer brings it back. */
  .collage-studio--picking .collage-bar {
    display: none;
  }

  /* No keyboard, so no list of keys. */
  .collage-studio--phone .collage-keys-button {
    display: none;
  }

  .collage-studio--phone .collage-mat__caption {
    bottom: 4px;
    min-width: 0;
  }

  /* When the drawer is raised the frame gets small, so the caption keeps to
     one line inside the mat and trims its end rather than spilling out. */
  .collage-studio--phone .collage-mat__caption .collage-studio__label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .collage-studio--phone .collage-title-input {
    min-width: 0;
  }

  /* Raised, the drawer becomes a sheet: it lifts off the page with rounded
     shoulders and takes most of the screen, and the collage above it shrinks
     to a bare miniature that shows each scrap landing as it is tapped. */
  .collage-tray.collage-tray--bottom.collage-tray--tall {
    flex-basis: 68%;
    margin: 0;
    padding-top: 6px;
    border-width: 1px 0 0;
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -10px 30px color-mix(in srgb, var(--c-ink) 18%, transparent);
  }

  /* Everything around the miniature steps back: the bars, the mat, the
     selection and its tools. */
  .collage-studio--sheet .collage-frame-area__stage {
    background: color-mix(in srgb, var(--c-ink) 6%, var(--c-ground));
  }

  .collage-studio--sheet .collage-stage-top,
  .collage-studio--sheet .collage-views,
  .collage-studio--sheet .collage-piece-actions,
  .collage-studio--sheet .collage-mat__caption,
  .collage-studio--sheet .collage-selection-edge,
  .collage-studio--sheet .collage-handle,
  .collage-studio--sheet .collage-grip,
  .collage-studio--sheet .collage-rotate-knob,
  .collage-studio--sheet .collage-rotate-stem {
    visibility: hidden;
  }

  .collage-studio--sheet .collage-mat {
    background: transparent;
    box-shadow: none;
  }

  /* Laid over the whole miniature, so a tap there lowers the sheet rather
     than moving a piece it cannot see the handles of. */
  .collage-sheet-peek {
    position: absolute;
    inset: 0;
    z-index: 10010;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0 0 4px;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .collage-sheet-peek__label {
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--c-ground) 85%, transparent);
    color: var(--c-muted);
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.04em;
  }

  /* The grab bar at the top of a docked drawer: flick it up or down, or tap
     it to raise and lower the drawer. */
  /* Tall enough for a thumb to land on without aiming; the bar drawn in it
     stays small. */
  .collage-tray__handle {
    flex: 0 0 auto;
    align-self: center;
    /* Far wider and taller than the bar it draws, so a thumb finds it. */
    width: min(100%, 220px);
    height: 30px;
    margin: -10px 0 -4px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: grab;
    touch-action: none;
  }

  .collage-tray__handle::before {
    content: "";
    display: block;
    width: 36px;
    height: 4px;
    margin: 0 auto;
    border-radius: 2px;
    background: color-mix(in srgb, var(--c-ink) 22%, transparent);
  }

  .collage-tray--bottom .collage-tray__rail {
    touch-action: none;
  }

  .collage-tray.collage-tray--bottom.collage-tray--tucked {
    flex: 0 0 auto;
    padding: 6px;
  }

  .collage-tray--bottom .collage-tray__rail {
    width: 100%;
    height: auto;
    padding: 10px;
    font-size: 10px;
    writing-mode: horizontal-tb;
  }

${COLLAGE_PIECE_TOOL_STYLES}
  .collage-tray {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin: 10px 0 10px 10px;
    padding: 10px 8px 8px;
    gap: 6px;
    background: var(--c-surface);
    border: 1px solid var(--c-rule);
    border-radius: 2px;
  }

  .collage-tray__count {
    margin: 0;
  }

  .collage-tray__reset {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--c-accent-ink);
    font: inherit;
    letter-spacing: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .collage-tray__reset:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--c-accent) 45%, transparent);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .collage-tray__tuck {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--c-ink) 18%, transparent);
    border-radius: 999px;
    background: transparent;
    color: var(--c-muted);
    font-family: "Martian Mono", monospace;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease;
  }

  .collage-tray__tuck:hover {
    border-color: color-mix(in srgb, var(--c-ink) 38%, transparent);
    color: var(--c-ink);
  }

  .collage-tray__tuck:focus-visible {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-accent) 16%, transparent);
  }

  .collage-tray__rail {
    flex: 0 0 auto;
    border: 1px solid color-mix(in srgb, var(--c-ink) 18%, transparent);
    border-radius: 3px;
    background: transparent;
    color: var(--c-muted);
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
    background: color-mix(in srgb, var(--c-accent) 25%, transparent);
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
    border-color: color-mix(in srgb, var(--c-ink) 28%, transparent);
    background: color-mix(in srgb, var(--c-ink) 5%, transparent);
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
    background-color: var(--c-surface);
    background-image:
      linear-gradient(45deg, color-mix(in srgb, var(--c-ink) 7%, transparent) 25%, transparent 25%),
      linear-gradient(-45deg, color-mix(in srgb, var(--c-ink) 7%, transparent) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--c-ink) 7%, transparent) 75%),
      linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--c-ink) 7%, transparent) 75%);
    background-size: 12px 12px;
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  }

  /* A small thing gets a plain box so it is legible without being blown up. */
  .collage-tray__thumb--small {
    border: 1px solid color-mix(in srgb, var(--c-ink) 16%, transparent);
  }

  /*
   * A button sits on the paper, but plenty of them are white on white, so the
   * patch keeps a hairline edge — otherwise the scrap is invisible in the
   * drawer even though it is really there.
   */
  .collage-tray__thumb--paper {
    border: 1px solid color-mix(in srgb, var(--c-ink) 10%, transparent);
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
    color: var(--c-muted);
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  .collage-leave:hover,
  .collage-leave:focus-visible {
    color: var(--c-ink);
  }

  .collage-tools {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 4px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 16%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--c-surface) 94%, transparent);
  }

  /* The document's own settings, opposite the studio tools. */
  .collage-format {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .collage-paper-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .collage-paper-button__swatch {
    width: 10px;
    height: 10px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 35%, transparent);
    border-radius: 2px;
  }

  .collage-paper-popover {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    z-index: 10002;
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 232px;
    padding: 9px 10px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 20%, transparent);
    border-radius: 4px;
    background: var(--c-surface);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--c-ink) 20%, transparent);
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
    border: 1px solid color-mix(in srgb, var(--c-ink) 28%, transparent);
    border-radius: 3px;
    cursor: pointer;
  }

  .collage-swatch--on {
    outline: 1px solid var(--c-accent-ink);
    outline-offset: 1px;
  }

  /* The custom color: a rainbow swatch, so it reads as a picker. */
  .collage-color-picker {
    position: relative;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    background: linear-gradient(
      135deg,
      #e94b4b,
      #f0b03c,
      #e7e046,
      #5cc96b,
      #4bb8e9,
      #6a6ae9,
      #c45ce0
    );
  }

  .collage-color-picker:focus-within {
    outline: 1px solid var(--c-accent-ink);
    outline-offset: 1px;
  }

  .collage-color-picker__chosen {
    width: 8px;
    height: 8px;
    border: 1px solid rgba(255, 255, 255, 0.9);
    border-radius: 2px;
  }

  /* The real input covers the swatch so a click anywhere opens the picker. */
  .collage-color-picker input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
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
    accent-color: var(--c-accent);
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
    flex: 1 1 auto;
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
    overflow: hidden;
    /* A marquee or a handle drag sweeps across the stage; it must not pick up
       the readout or the bars' labels as selected text on the way. */
    user-select: none;
  }

${COLLAGE_SHEET_STYLES}
  .collage-frame--drop-target {
    box-shadow: 0 10px 34px color-mix(in srgb, var(--c-ink) 16%, transparent), inset 0 0 0 2px color-mix(in srgb, var(--c-accent) 50%, transparent);
  }

${PIECE_MATERIAL_STYLES}
  /* The edge of the selected piece, or of the box around several: a plain
     teal line two screen pixels wide, kept that weight through the frame's
     zoom. It is drawn as an inset shadow because the browser rounds a
     border's width to whole pixels before the zoom applies, which would
     leave the line thinner or thicker than two pixels on screen. */
  .collage-selection-edge {
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 calc(2px / var(--collage-zoom)) var(--c-accent);
    pointer-events: none;
  }

  /* A finger needs far more room than a cursor: the handle grows a little and
     takes presses from well around it, with nothing drawn there. */
  @media (pointer: coarse) {
    .collage-handle {
      width: 18px;
      height: 18px;
      margin: -9px 0 0 -9px;
    }

    .collage-handle::after {
      content: "";
      position: absolute;
      inset: -16px;
    }
  }

  /* A corner handle held at the edge of the view because its corner is out
     of sight; it still drags that corner. */
  .collage-handle--pinned {
    border-style: dashed;
    background: #eef6f4;
  }

  /* An invisible grip around the selection: along an edge it scales, just
     past a corner it turns. Only its cursor says which. */
  .collage-grip {
    position: absolute;
    transform-origin: center;
    background: transparent;
    touch-action: none;
  }

  /* Small readout that rides above a piece during a modal rotate or scale. */
  .collage-readout {
    position: absolute;
    margin: 0;
    padding: 2px 6px;
    z-index: 10002;
    transform-origin: center bottom;
    border: 1px solid color-mix(in srgb, var(--c-ink) 20%, transparent);
    border-radius: 3px;
    background: var(--c-surface);
    color: var(--c-ink);
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
    border-color: color-mix(in srgb, var(--c-ink) 32%, transparent);
    transform-origin: center;
    pointer-events: none;
  }

  /* Each piece inside a selection of several, traced lightly under the box
     that holds them all. */
  .collage-piece-member {
    position: absolute;
    z-index: 9999;
    border-style: solid;
    border-color: color-mix(in srgb, var(--c-accent) 85%, transparent);
    transform-origin: center;
    pointer-events: none;
  }

  /* The area a drag across bare paper is sweeping. */
  .collage-snap-guide {
    position: absolute;
    z-index: 10003;
    background: var(--c-accent);
    pointer-events: none;
  }

  .collage-marquee {
    position: absolute;
    z-index: 10003;
    border-style: solid;
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) 8%, transparent);
    pointer-events: none;
  }

  /* A ring under a finger that has rested long enough: dragging from bare
     paper now draws a box, and lifting from a piece lists the pieces there. */
  .collage-hold-mark {
    position: absolute;
    z-index: 10003;
    border-style: solid;
    border-color: var(--c-accent);
    border-radius: 50%;
    background: color-mix(in srgb, var(--c-accent) 12%, transparent);
    transform: translate(-50%, -50%);
    pointer-events: none;
    animation: collage-hold-mark 180ms ease-out;
  }

  @keyframes collage-hold-mark {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.4);
    }
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
    border: 1px solid color-mix(in srgb, var(--c-ink) 20%, transparent);
    border-radius: 4px;
    background: var(--c-surface);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--c-ink) 22%, transparent);
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
  }

  .collage-here__pick {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    align-items: center;
    gap: 7px;
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .collage-here__pick:disabled {
    cursor: default;
  }

  .collage-here__row--locked .collage-here__thumb,
  .collage-here__row--locked .collage-here__what {
    opacity: 0.55;
  }

  /* The lock only shows on the row being pointed at, and on locked rows. */
  .collage-here__lock {
    flex: none;
    opacity: 0;
  }

  .collage-here__row:hover .collage-here__lock,
  .collage-here__row--locked .collage-here__lock,
  .collage-here__lock:focus-visible {
    opacity: 1;
  }

  .collage-here__row:hover {
    border-color: color-mix(in srgb, var(--c-ink) 20%, transparent);
    background: color-mix(in srgb, var(--c-ink) 6%, transparent);
  }

  .collage-here__row--on {
    border-color: color-mix(in srgb, var(--c-accent) 70%, transparent);
    background: color-mix(in srgb, var(--c-accent) 10%, transparent);
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
    border: 1px solid color-mix(in srgb, var(--c-ink) 16%, transparent);
    border-radius: 2px;
    background: var(--c-frame);
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
    color: var(--c-ink);
  }

  .collage-here__where {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--c-muted);
  }

${COLLAGE_PEEK_STYLES}
  /* Where the save button used to be: a quiet word on how the work stands. */
  .collage-standing {
    margin: 0;
    padding: 0 4px;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.03em;
    color: var(--c-muted);
    white-space: nowrap;
  }

  .collage-standing--problem {
    color: #c4724e;
  }

  /* A cut that is still being computed, and one that could not be read. */
  .collage-piece__pending {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--c-ink) 6%, transparent),
      color-mix(in srgb, var(--c-ink) 6%, transparent) 4px,
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
    border: 1px solid color-mix(in srgb, var(--c-ink) 20%, transparent);
    border-radius: 4px;
    background: var(--c-surface);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--c-ink) 20%, transparent);
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
    color: var(--c-muted);
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
    color: var(--c-muted);
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
    color: var(--c-ink);
  }

  .collage-keys__what {
    color: var(--c-muted);
  }

  .collage-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-top: 3px double var(--c-rule);
  }

  .collage-bar__spacer {
    flex: 1 1 auto;
  }

  /* Stands where the title was, at the title field's height, so turning over
     never changes the bar's height or the frame's zoom. */
  .collage-bar__turned {
    display: inline-flex;
    align-items: center;
    min-height: 29px;
  }

  .collage-action {
    padding: 4px 9px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 22%, transparent);
    border-radius: 3px;
    background: transparent;
    color: var(--c-ink);
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.04em;
    cursor: pointer;
  }

  .collage-action:hover:not(:disabled) {
    background: color-mix(in srgb, var(--c-ink) 7%, transparent);
  }

  .collage-action:disabled {
    color: color-mix(in srgb, var(--c-muted) 60%, transparent);
    border-color: color-mix(in srgb, var(--c-ink) 12%, transparent);
    cursor: default;
  }

  .collage-action--primary {
    border-color: color-mix(in srgb, var(--c-accent) 70%, transparent);
    color: var(--c-accent-ink);
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
    border-top-color: color-mix(in srgb, var(--c-ink) 12%, transparent);
    background: color-mix(in srgb, var(--c-accent) 8%, transparent);
    color: var(--c-accent-ink);
  }

  .collage-history {
    background: var(--c-ground);
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 18px 22px 40px;
    color: var(--c-ink);
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
    filter: drop-shadow(0 2px 3px color-mix(in srgb, var(--c-ink) 22%, transparent));
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
    color: var(--c-ink);
  }

  .collage-history__summary {
    margin: 4px 0 0;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.02em;
    color: var(--c-muted);
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
    color: var(--c-muted);
    cursor: pointer;
  }

  .collage-history__import:hover {
    color: var(--c-ink);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .collage-history__import:focus-visible {
    color: var(--c-ink);
    outline: 2px solid color-mix(in srgb, var(--c-accent) 45%, transparent);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .collage-history__tagline {
    margin: 0;
    font-family: "Lora", Georgia, serif;
    font-size: 11px;
    font-style: italic;
    color: var(--c-muted);
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
    border: 1px solid color-mix(in srgb, var(--c-ink) 14%, transparent);
    border-radius: 3px;
    background: var(--c-frame);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--c-ink) 8%, transparent);
    transition: box-shadow 140ms ease, border-color 140ms ease;
  }

  .collage-card:hover,
  .collage-card:focus-within {
    border-color: color-mix(in srgb, var(--c-ink) 26%, transparent);
    box-shadow: 0 6px 18px color-mix(in srgb, var(--c-ink) 13%, transparent);
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
    outline: 2px solid color-mix(in srgb, var(--c-accent) 80%, transparent);
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
    border: 1px dashed color-mix(in srgb, var(--c-ink) 20%, transparent);
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
    color: var(--c-muted);
  }

  /* The card's tools: a quiet row of the studio's glyphs, clearer on hover
     or focus but always there for the keyboard. */
  .collage-card__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-height: 26px;
    color: var(--c-muted);
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

  .collage-history__new {
    display: flex;
    gap: 8px;
  }

  .collage-action--together {
    border-color: var(--c-accent);
    color: var(--c-accent-ink);
  }

  /* A collage made with others: tape across the top, an accent edge, and a
     tag in everyone's colors, so it reads as shared at a glance. */
  .collage-card--shared {
    position: relative;
    border-color: color-mix(in srgb, var(--c-accent) 55%, transparent);
  }

  .collage-card--shared::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -7px;
    width: 54px;
    height: 15px;
    transform: translateX(-50%) rotate(-2deg);
    background: color-mix(in srgb, var(--c-accent) 30%, #fff);
    opacity: 0.85;
    pointer-events: none;
  }

  .collage-card__thumb--shared {
    position: relative;
    overflow: hidden;
    background: var(--c-frame);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c-ink) 8%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .collage-card__thumb--shared img {
    position: absolute;
    object-fit: cover;
    box-shadow: 0 1px 3px color-mix(in srgb, var(--c-ink) 20%, transparent);
  }

  .collage-card__shared-tag {
    position: absolute;
    left: 6px;
    top: 6px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 7px 2px 4px;
    border: 1px solid color-mix(in srgb, var(--c-accent) 45%, transparent);
    border-radius: 999px;
    background: var(--c-frame);
    color: var(--c-accent-ink);
    font-family: "Martian Mono", monospace;
    font-size: 9px;
  }

  .collage-card__shared-dots {
    display: inline-flex;
  }

  .collage-card__shared-dots i {
    width: 12px;
    height: 12px;
    margin-left: -4px;
    border: 1.5px solid var(--c-frame);
    border-radius: 50%;
    box-sizing: border-box;
  }

  .collage-card__shared-dots i:first-child {
    margin-left: 0;
  }

  .collage-card__away {
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    font-weight: 400;
    color: var(--c-muted);
  }

  .collage-card__with {
    display: block;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.02em;
    color: var(--c-accent-ink);
  }

${COLLAGE_MAT_STYLES}
  /* Views sit at the top-right: the back, and where the pieces came from. */
${COLLAGE_VIEW_STYLES}
${EXPORT_MENU_STYLES}
  .collage-setting:focus-visible,
  .collage-keys-button:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 1px;
  }

  /* Size and paper, quiet in the bottom bar. */
  .collage-setting {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--c-rule);
    border-radius: 3px;
    background: var(--c-frame);
    color: var(--c-ink);
    font-family: "Martian Mono", monospace;
    font-size: 9.5px;
    cursor: pointer;
  }
  .collage-setting:hover,
  .collage-setting--open {
    border-color: var(--c-muted);
  }
  .collage-setting__caret {
    color: var(--c-muted);
    font-size: 8px;
  }

  .collage-keys-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--c-ink);
    font-family: "Martian Mono", monospace;
    font-size: 9.5px;
    cursor: pointer;
  }
  .collage-keys-button:hover,
  .collage-keys-button--on {
    border-color: var(--c-rule);
    background: var(--c-surface);
  }
`;
