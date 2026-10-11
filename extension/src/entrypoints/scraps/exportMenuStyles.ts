// ABOUTME: Styles for the studio's share-link action and its popover with the link and take-down.
// ABOUTME: Folded into the studio stylesheet, so it uses the studio's --c-* palette.

export const SHARE_CONTROL_STYLES = `
  .collage-share {
    position: relative;
    display: inline-flex;
  }

  .collage-share-popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    z-index: 10002;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 280px;
    padding: 9px 10px;
    border: 1px solid color-mix(in srgb, var(--c-ink) 20%, transparent);
    border-radius: 4px;
    background: var(--c-surface);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--c-ink) 20%, transparent);
  }

  .collage-share-popover p.collage-studio__label {
    margin: 0;
  }

  .collage-share-popover__url {
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

  .collage-share-popover a.collage-action {
    text-decoration: none;
  }
`;
