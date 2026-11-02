// ABOUTME: Styles for the collage's view toggles, like showing sources, in a small box at the top-right.
// ABOUTME: Shared by the extension studio and the walk collage table, which define the --c-* palette.

export const COLLAGE_VIEW_STYLES = `
  .collage-views {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--c-rule);
    border-radius: 4px;
    background: var(--c-surface);
  }
  .collage-view {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--c-ink);
    font-family: "Martian Mono", monospace;
    font-size: 9.5px;
    cursor: pointer;
  }
  .collage-view:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--c-ink) 24%, transparent);
    background: color-mix(in srgb, var(--c-ink) 7%, transparent);
  }
  .collage-view:disabled {
    color: color-mix(in srgb, var(--c-muted) 55%, transparent);
    cursor: default;
  }
  .collage-view--on {
    border-color: color-mix(in srgb, var(--c-accent) 70%, transparent);
    background: color-mix(in srgb, var(--c-accent) 12%, transparent);
    color: var(--c-accent-ink);
  }
  .collage-view:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 1px;
  }
`;
