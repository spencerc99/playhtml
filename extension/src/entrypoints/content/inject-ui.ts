// ABOUTME: Helpers for injecting extension UI into host pages via Shadow DOM.
// ABOUTME: Provides full CSS isolation — host-page styles cannot bleed in or out.

import { createRoot, type Root } from "react-dom/client";
import { createElement, type ComponentType } from "react";

interface ShadowOptions {
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

export interface InjectedReactUI {
  /** Re-render the component with new props. */
  render: (props: Record<string, unknown>) => void;
  /** Unmount the component and remove the host element from the page. */
  destroy: () => void;
  /**
   * The element React renders into, inside the shadow root.
   */
  container: Element;
  /**
   * Sibling element to `container` inside the shadow root, NOT managed by
   * React. Use this as a portal target for modals/overlays that need to
   * escape the main component tree but stay inside the shadow's CSS scope.
   */
  portal: Element;
}

/**
 * Mounts a React component into the page inside a closed Shadow DOM root,
 * fully isolated from host-page styles.
 */
export function injectShadowReact<P extends Record<string, unknown>>(
  component: ComponentType<P>,
  props: P,
  options: ShadowOptions = {}
): InjectedReactUI {
  const { host, shadow } = injectShadow(options);

  const container = document.createElement("div");
  shadow.appendChild(container);

  // Sibling portal node — React doesn't manage this, so child components
  // can safely portal into it (e.g. a modal that needs to escape the main
  // component tree but stay inside the shadow root's CSS scope).
  const portal = document.createElement("div");
  shadow.appendChild(portal);

  const root: Root = createRoot(container);
  root.render(createElement(component, props));

  return {
    render(nextProps) {
      root.render(createElement(component, nextProps as P));
    },
    destroy() {
      root.unmount();
      host.remove();
    },
    container,
    portal,
  };
}
