// ABOUTME: Playground preview pane: sandboxed iframe with srcdoc, reload button.
// ABOUTME: Connection / presence / room id are surfaced inside the iframe via the dev panel.
import { useEffect, useRef, useState } from "react";
import { buildIframeSrcdoc } from "./iframe-template";
import { makePlayhtmlModuleUrl } from "./playhtml-module";

export type PreviewProps = {
  source: string;
  roomId: string;
  /** Bumped externally to force a fresh iframe (e.g., reload button). */
  reloadNonce: number;
};

export function Preview(props: PreviewProps) {
  const { source, roomId, reloadNonce } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The built workspace module is encoded as a self-contained data URL so
  // the opaque sandbox can import it without reaching into the parent page.
  const [playhtmlModuleUrl, setPlayhtmlModuleUrl] = useState<string | null>(null);

  useEffect(() => {
    setPlayhtmlModuleUrl(makePlayhtmlModuleUrl());
  }, []);

  // (Re)mount the iframe whenever source, roomId, reloadNonce, or the
  // PlayHTML module URL changes. We replace the iframe element entirely so
  // the old playhtml provider tears down cleanly (per spec §4.9).
  useEffect(() => {
    if (!containerRef.current) return;
    if (!playhtmlModuleUrl) return;

    const iframe = document.createElement("iframe");
    // Sandbox: scripts + popups only, no allow-same-origin. Per spec §4.2
    // — the recipe runs in its own opaque origin so it can't touch the
    // parent. Images load fine cross-origin (the sandbox doesn't gate
    // those); same-origin fetches that the iframe might need (e.g. CSS,
    // assets it expects to live alongside) wouldn't work, but recipes
    // are designed to be self-contained: the iframe template inlines
    // the dev panel's bottom-position CSS and the recipe references all
    // images via absolute https URLs (playhtml.fun-hosted).
    iframe.setAttribute("sandbox", "allow-scripts allow-popups");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.style.background = "#faf7f2";
    iframe.title = "playhtml playground preview";

    iframe.srcdoc = buildIframeSrcdoc({
      recipeHtml: source,
      playhtmlUrl: playhtmlModuleUrl,
      roomId,
    });

    // Clear any previous iframe and append the new one
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(iframe);

    return () => {
      // Remove iframe on unmount (StrictMode double-invoke or component unmount)
      iframe.remove();
    };
  }, [source, roomId, reloadNonce, playhtmlModuleUrl]);

  return (
    <div className="ph-preview-pane">
      <div className="ph-preview-toolbar">
        <span className="ph-preview-toolbar-label">preview</span>
        <span className="ph-preview-toolbar-spacer" />
        <button
          type="button"
          className="ph-preview-reload"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("ph:preview-reload-request"));
          }}
          title="Reload preview"
        >
          ↻
        </button>
      </div>
      <div ref={containerRef} className="ph-preview-iframe-host" />
    </div>
  );
}
