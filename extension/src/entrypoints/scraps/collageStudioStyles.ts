// ABOUTME: Stylesheet for the scrap collage studio, tray, and history surfaces.
// ABOUTME: Warm paper chrome that stays quiet behind the collaged material.

export const COLLAGE_STUDIO_STYLES = `
  .collage-studio {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 236px minmax(0, 1fr);
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
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 12px 10px 10px;
    gap: 8px;
    border-right: 1px solid rgba(61, 56, 51, 0.12);
  }

  .collage-tray__filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .collage-chip {
    padding: 3px 7px;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 3px;
    background: transparent;
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.03em;
    cursor: pointer;
  }

  .collage-chip:hover {
    border-color: rgba(61, 56, 51, 0.35);
    color: #3d3833;
  }

  .collage-chip--active {
    background: rgba(61, 56, 51, 0.08);
    border-color: rgba(61, 56, 51, 0.4);
    color: #3d3833;
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
    padding: 4px;
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
    width: 100%;
    height: 100%;
    overflow: hidden;
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

  .collage-frame {
    position: relative;
    transform-origin: center;
    background: #fffdf9;
    box-shadow: 0 10px 34px rgba(61, 56, 51, 0.16);
    overflow: hidden;
    touch-action: none;
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

  .collage-crop-overlay {
    position: absolute;
    overflow: hidden;
    background: rgba(61, 56, 51, 0.28);
    cursor: crosshair;
  }

  .collage-crop-selection {
    position: absolute;
    border: 1px dashed #fffdf9;
    background: rgba(255, 253, 249, 0.16);
    pointer-events: none;
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

  .collage-history__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 18px;
  }

  .collage-card {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 9px;
    border: 1px solid rgba(61, 56, 51, 0.14);
    border-radius: 3px;
    background: #fffdf9;
    box-shadow: 0 4px 14px rgba(61, 56, 51, 0.08);
  }

  .collage-card__thumb {
    display: block;
    width: 100%;
    aspect-ratio: 3 / 2;
    object-fit: contain;
    background: #faf9f6;
    cursor: zoom-in;
  }

  .collage-card__title {
    margin: 0;
    font-family: "Lora", Georgia, serif;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
  }

  .collage-card__meta {
    margin: 0;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1.7;
    letter-spacing: 0.02em;
    color: #827a72;
  }

  .collage-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .collage-provenance {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 132px;
    overflow-y: auto;
    border-top: 1px solid rgba(61, 56, 51, 0.1);
  }

  .collage-provenance__entry {
    padding: 4px 0;
    border-bottom: 1px solid rgba(61, 56, 51, 0.07);
    font-size: 12px;
    line-height: 1.4;
  }

  .collage-provenance__link {
    color: #3d3833;
    text-decoration: none;
    border-bottom: 1px solid rgba(61, 56, 51, 0.25);
  }

  .collage-provenance__link:hover {
    border-bottom-color: rgba(61, 56, 51, 0.6);
  }

  .collage-provenance__where {
    display: block;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    letter-spacing: 0.03em;
    color: #827a72;
  }

  .collage-mode-switch {
    display: inline-flex;
    gap: 3px;
    padding: 3px;
    border: 1px solid rgba(61, 56, 51, 0.16);
    border-radius: 4px;
    background: rgba(245, 240, 232, 0.9);
  }
`;
