// ABOUTME: Shape of the copyable source shown under each live docs demo.
// ABOUTME: Every demo ships a Vanilla HTML version and a React version.

export type DemoSnippet = {
  /** A self-contained HTML fragment: markup, styles, and a module script. */
  html: string;
  /** A React component. Assumes a <PlayProvider> higher in the tree. */
  react: string;
  /** Styles for the React version, shown as a separate block. */
  reactCss?: string;
  /** One line shown above the React code, e.g. how it differs from HTML. */
  reactNote?: string;
};
