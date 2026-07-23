// ABOUTME: Playground preview pane: sandboxed iframe with srcdoc, reload button.
// ABOUTME: Connection / presence / room id are surfaced inside the iframe via the dev panel.
import { useEffect, useRef, useState } from "react";
import { buildIframeSrcdoc } from "./iframe-template";
// Vite's `?raw` import reads the file at build/dev time and inlines its
// source as a string. We use it to load the workspace playhtml ESM build
// and hand the iframe a blob: URL pointing at it. This means library
// edits to packages/playhtml/src/* reflect in the iframe after a rebuild
// of the playhtml package (`bun run --cwd packages/playhtml build`).
//
// Why not unpkg: the published version doesn't have this branch's dev
// panel changes (position attribute, console panel). Why not a Vite
// import directly: the iframe is sandboxed without allow-same-origin and
// runs in a different document context, so the parent's already-resolved
// module URLs aren't visible to it. Blob URLs work cross-origin.
//
// The relative path bypasses Vite's `playhtml` alias (which points at
// the source, not the built dist) and reaches the dist file directly.
import playhtmlSource from "../../../../../packages/playhtml/dist/playhtml.es.js?raw";

export type PreviewProps = {
  source: string;
  roomId: string;
  /** Bumped externally to force a fresh iframe (e.g., reload button). */
  reloadNonce: number;
};

export function Preview(props: PreviewProps) {
  const { source, roomId, reloadNonce } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Blob URL pointing at the workspace playhtml ESM source. Created once
  // per Preview lifetime; the iframe template uses it inside its
  // importmap so `import { playhtml } from "playhtml"` resolves here.
  const [playhtmlBlobUrl, setPlayhtmlBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([playhtmlSource], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    setPlayhtmlBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, []);

  // (Re)mount the iframe whenever source, roomId, reloadNonce, or the
  // playhtml blob URL changes. We replace the iframe element entirely so
  // the old playhtml provider tears down cleanly (per spec §4.9).
  useEffect(() => {
    if (!containerRef.current) return;
    if (!playhtmlBlobUrl) return; // Wait for blob URL on first mount

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
      playhtmlUrl: playhtmlBlobUrl,
      roomId,
    });

    // Clear any previous iframe and append the new one
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(iframe);

    return () => {
      // Remove iframe on unmount (StrictMode double-invoke or component unmount)
      iframe.remove();
    };
  }, [source, roomId, reloadNonce, playhtmlBlobUrl]);

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
