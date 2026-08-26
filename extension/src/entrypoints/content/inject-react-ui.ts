// ABOUTME: Mounts React components inside extension-owned Shadow DOM roots.
// ABOUTME: Keeps React support separate from the raw all-page injection helper.

import { createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { injectShadow, type ShadowOptions } from "./inject-ui";

export interface InjectedReactUI {
  /** Shadow host attached to the page. */
  host: HTMLElement;
  /** Re-render the component with new props. */
  render: (props: Record<string, unknown>) => void;
  /** Unmount the component and remove the host element from the page. */
  destroy: () => void;
  /** The element React renders into, inside the shadow root. */
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
  options: ShadowOptions = {},
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
    host,
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
