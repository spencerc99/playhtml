// ABOUTME: Styles for the studio's export menu and share popover, with the shared link and take-down.
// ABOUTME: Folded into the studio stylesheet, so it uses the studio's --c-* palette.

export const EXPORT_MENU_STYLES = `
  /* Share and export, kept on one line together when the bar wraps. */
  .collage-bar__send {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .collage-export {
    position: relative;
    display: inline-flex;
  }

  .collage-export__menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    z-index: 10002;
    display: flex;
    flex-direction: column;
    width: 290px;
    max-width: calc(100vw - 32px);
    padding: 4px 10px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 20%, transparent);
    border-radius: 4px;
    background: var(--c-surface);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--c-ink) 20%, transparent);
  }

  /* On a phone the bar is the screen's width and share sits left of export,
     so both popovers open from the bar's right edge rather than their button's,
     where share's would run off the left side. */
  .collage-studio--phone .collage-bar {
    position: relative;
  }

  .collage-studio--phone .collage-export {
    position: static;
  }

  .collage-studio--phone .collage-export__menu {
    right: 8px;
  }

  .collage-export__section {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 7px 0;
  }

  .collage-export__section + .collage-export__section {
    border-top: 1px solid color-mix(in srgb, var(--c-ink) 12%, transparent);
  }

  .collage-export__section p.collage-studio__label {
    margin: 0;
  }

  .collage-export__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .collage-share {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .collage-share__url {
    box-sizing: border-box;
    width: 100%;
    padding: 4px 6px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 18%, transparent);
    border-radius: 3px;
    background: transparent;
    color: var(--c-ink);
    font-family: "Martian Mono", monospace;
    font-size: 9px;
  }

  .collage-export a.collage-action {
    text-decoration: none;
  }
`;
