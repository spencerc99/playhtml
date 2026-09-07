// ABOUTME: Shows the participant's own cursor locally for installation displays.
// ABOUTME: Follows profile settings without joining rooms or publishing pointer movement.

import browser from "webextension-polyfill";
import { CursorSvg } from "../../components/icons";
import { INSTALLATION_MODE_KEY } from "../../features/installationMode";
import { PLAYER_IDENTITY_STORAGE_KEY } from "../../storage/playerIdentity";
import { injectShadowReact, type InjectedReactUI } from "./inject-ui";

export function initInstallationCursor(): () => void {
  let disposed = false;
  let revision = 0;
  let ui: InjectedReactUI | null = null;
  const shadowStyles = new Map<ShadowRoot, HTMLStyleElement>();
  const hide = () => {
    if (ui) ui.host.style.visibility = "hidden";
    document.documentElement.removeAttribute("data-wwo-installation-cursor");
    for (const style of shadowStyles.values()) {
      if (style.sheet) style.sheet.disabled = true;
    }
  };
  const remove = () => {
    hide();
    ui?.destroy();
    ui = null;
    for (const style of shadowStyles.values()) style.remove();
    shadowStyles.clear();
  };
  const move = (event: PointerEvent) => {
    if (!ui || event.pointerType === "touch") return;
    const path = event.composedPath();
    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue;
      // Extension APIs can identify closed roots without modifying their contents.
      const root =
        node.shadowRoot ??
        (typeof chrome !== "undefined" && chrome.dom?.openOrClosedShadowRoot
          ? chrome.dom.openOrClosedShadowRoot(node)
          : (
              node as HTMLElement & {
                openOrClosedShadowRoot?: ShadowRoot | null;
              }
            ).openOrClosedShadowRoot);
      // Opaque custom elements retain their native pointer on browsers without
      // closed-root access, since their internal cursor styles cannot be checked.
      if (root?.mode === "closed" || (!root && node.localName.includes("-"))) {
        hide();
        return;
      }
    }
    for (const node of path) {
      if (!(node instanceof ShadowRoot)) continue;
      let style = shadowStyles.get(node);
      if (!style?.isConnected) {
        style = document.createElement("style");
        style.textContent = "* { cursor: none !important; }";
        node.append(style);
        shadowStyles.set(node, style);
      }
      if (style.sheet?.disabled) style.sheet.disabled = false;
    }
    for (const [root, style] of shadowStyles) {
      if (!root.host.isConnected) {
        style.remove();
        shadowStyles.delete(root);
      }
    }
    if (
      !document.documentElement.hasAttribute("data-wwo-installation-cursor")
    ) {
      document.documentElement.setAttribute("data-wwo-installation-cursor", "");
    }
    // A page can override even an injected rule, for example with inline
    // !important styles. Keep one native cursor if suppression did not apply.
    if (
      path[0] instanceof Element &&
      getComputedStyle(path[0]).cursor !== "none"
    ) {
      hide();
      return;
    }
    ui.host.style.transform = `translate(${event.clientX - 12}px, ${event.clientY - 8.4}px)`;
    ui.host.style.visibility = "visible";
  };
  const leave = (event: PointerEvent) => {
    if (
      event.relatedTarget === null ||
      event.relatedTarget instanceof HTMLIFrameElement
    )
      hide();
  };
  const visibility = () => {
    if (document.hidden) hide();
  };

  const refresh = async () => {
    const currentRevision = ++revision;
    try {
      const stored = await browser.storage.local.get(INSTALLATION_MODE_KEY);
      if (disposed || currentRevision !== revision) return;
      if (stored[INSTALLATION_MODE_KEY] !== true) {
        remove();
        return;
      }
      const identity = await browser.runtime.sendMessage({
        type: "GET_PUBLIC_PLAYER_IDENTITY",
      });
      if (disposed || currentRevision !== revision) return;
      const color = identity?.playerStyle?.colorPalette?.[0];
      if (typeof color !== "string" || !CSS.supports("color", color)) {
        remove();
        return;
      }
      if (ui) {
        ui.render({ size: 32, color });
      } else {
        ui = injectShadowReact(
          CursorSvg,
          { size: 32, color },
          {
            hostId: "wwo-installation-cursor",
            hostStyle:
              "all:initial;position:fixed;top:0;left:0;width:32px;height:32px;pointer-events:none;z-index:2147483647;visibility:hidden;",
            css: "svg { display:block; filter:drop-shadow(1px 0 0 white) drop-shadow(-1px 0 0 white) drop-shadow(0 1px 0 white) drop-shadow(0 -1px 0 white) drop-shadow(1px 2px 1px #0006); }",
          },
        );
        ui.host.setAttribute("aria-hidden", "true");
      }
    } catch (error) {
      if (disposed || currentRevision !== revision) return;
      remove();
      console.error(
        "[we-were-online] Could not load installation cursor:",
        error,
      );
    }
  };
  const onStorage = (
    changes: Record<string, browser.Storage.StorageChange>,
    area: string,
  ) => {
    if (
      area === "local" &&
      (changes[INSTALLATION_MODE_KEY] || changes[PLAYER_IDENTITY_STORAGE_KEY])
    ) {
      void refresh();
    }
  };
  browser.storage.onChanged.addListener(onStorage);
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerout", leave, true);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("blur", hide);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", refresh);
  void refresh();

  return () => {
    disposed = true;
    revision++;
    remove();
    browser.storage.onChanged.removeListener(onStorage);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerout", leave, true);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("blur", hide);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", refresh);
  };
}
