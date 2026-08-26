// ABOUTME: Helpers for injecting extension UI into host pages via Shadow DOM.
// ABOUTME: Provides full CSS isolation — host-page styles cannot bleed in or out.

export interface ShadowOptions {
  /** Inline CSS for the host element (positioning, z-index). */
  hostStyle?: string;
  /** CSS string to inject into the shadow root. */
  css?: string;
  /**
   * Google Fonts URL to load inside the shadow root. Required because
   * <link> tags in document.head do not cross the shadow boundary.
   */
  fontUrl?: string;
  /** Optional id for the host element (for later lookup/removal). */
  hostId?: string;
}

/**
 * Creates a closed Shadow DOM root attached to a new host element appended to
 * document.body. Use this for raw HTML injection.
 *
 * Returns the host element and shadow root — build your DOM inside shadow.
 * Caller is responsible for removing host from the page when done.
 */
export function injectShadow(options: ShadowOptions = {}): {
  host: HTMLElement;
  shadow: ShadowRoot;
} {
  const { hostStyle, css, fontUrl, hostId } = options;

  const host = document.createElement("div");
  if (hostId) host.id = hostId;
  if (hostStyle) host.style.cssText = hostStyle;

  const shadow = host.attachShadow({ mode: "closed" });

  if (fontUrl) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontUrl;
    shadow.appendChild(link);
  }

  if (css) {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    shadow.appendChild(styleEl);
  }

  document.body.appendChild(host);

  return { host, shadow };
}
