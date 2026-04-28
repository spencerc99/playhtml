// ABOUTME: Builds the srcdoc HTML wrapper for a playground iframe — injects
// ABOUTME: importmap, dev panel bottom-position bootstrap, and base CSS reset.

export type IframeTemplateArgs = {
  /** Recipe source. Must be a complete <!doctype html> document. */
  recipeHtml: string;
  /** Resolved playhtml URL (currently always unpkg; the workspace dev shim
      is bypassed because Astro's dev server blocks cross-origin subresource
      requests from sandboxed iframes that lack `allow-same-origin`). */
  playhtmlUrl: string;
  /** Room id the iframe's playhtml should join. */
  roomId: string;
};

// Inlined dev-panel-bottom CSS. Originally lived as a separate stylesheet at
// /docs/playground/dev-panel-bottom.css and was loaded via <link>, but
// Astro's dev server blocks cross-origin subresource fetches from sandboxed
// iframes (Sec-Fetch-Site: cross-site, no-cors). Inlining sidesteps that
// entirely and keeps the iframe self-contained for srcdoc loading.
const DEV_PANEL_BOTTOM_CSS = `
#playhtml-dev-root[data-position="bottom"] .ph-bar {
  top: auto;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100% !important;
  height: 240px;
  border-left: none;
  border-top: 3px solid #3d3833;
  flex-direction: column;
}
#playhtml-dev-root[data-position="bottom"] .ph-bar-content {
  flex: 1;
  min-width: 0;
}
#playhtml-dev-root[data-position="bottom"] .ph-resize-handle {
  width: 100%;
  height: 6px;
  cursor: ns-resize;
  border-right: none;
  border-bottom: 1px solid #8a8279;
  flex-direction: row;
}
#playhtml-dev-root[data-position="bottom"] .ph-resize-handle::after {
  width: 40px;
  height: 2px;
}
#playhtml-dev-root[data-position="bottom"] .ph-trigger {
  bottom: 0;
  right: 16px;
  border-bottom: none;
  border-right: 3px solid;
  border-right-color: #6b6560;
}
`;

/**
 * Build the srcdoc string for the playground iframe.
 *
 * Strategy: the recipe's source is a complete HTML document (the playground
 * authors recipes as full pages, see _starter.ts). We inject our wrappers
 * by string-splicing into the recipe's <head>:
 *
 *   1. Importmap so `import { playhtml } from "playhtml"` works.
 *   2. Inline <style> with dev-panel-bottom override CSS (inlined to avoid
 *      Astro dev-server cross-origin block on sandboxed iframe subresources).
 *   3. A small bootstrap script that overrides playhtml.init's room option
 *      AND sets data-position="bottom" on the dev panel root (and clicks
 *      the trigger to auto-open it) once playhtml mounts.
 */
export function buildIframeSrcdoc(args: IframeTemplateArgs): string {
  const { recipeHtml, playhtmlUrl, roomId } = args;

  // The recipe's <script type="module"> calls `playhtml.init({...})`. We
  // need to override that init's `room` option so the iframe joins the
  // editor's chosen room (private editor room or remix sessionId room)
  // instead of the URL-derived default. We do this by monkey-patching
  // playhtml.init in a script that runs BEFORE the recipe's module script.
  //
  // We also run a MutationObserver to catch the dev panel root the moment
  // playhtml mounts it, set data-position, and auto-open it.
  const bootstrap = `
<script type="importmap">
{
  "imports": {
    "playhtml": ${JSON.stringify(playhtmlUrl)}
  }
}
</script>
<style>${DEV_PANEL_BOTTOM_CSS}</style>
<script type="module">
  // Monkey-patch playhtml.init to inject our roomId. Static import (not
  // dynamic) so the bootstrap's body runs before the recipe's <script
  // type="module"> body — both modules await the same playhtml import,
  // but document order determines which body runs first once the module
  // record resolves. With a static import the patch lands BEFORE the
  // recipe's call to playhtml.init runs.
  import { playhtml } from "playhtml";
  const FORCED_ROOM = ${JSON.stringify(roomId)};
  const originalInit = playhtml.init;
  playhtml.init = function patchedInit(opts) {
    return originalInit.call(this, { ...(opts ?? {}), room: FORCED_ROOM });
  };

  // Watch for the dev panel to mount. When the root appears, set
  // data-position="bottom" so the consumer CSS layout kicks in, then
  // wait for the trigger button to render and click it to auto-open.
  // The two phases need to be separate because in setupDevUI() the root
  // is created first, then the trigger is appended, then the bar is
  // appended — between the root mount and the trigger mount we'd miss
  // the click target if we tried to do both in one tick.
  let positioned = false;
  let opened = false;
  const obs = new MutationObserver(() => {
    const root = document.getElementById("playhtml-dev-root");
    if (!root) return;
    if (!positioned) {
      root.dataset.position = "bottom";
      positioned = true;
    }
    if (!opened) {
      const trigger = root.querySelector(".ph-trigger");
      if (trigger instanceof HTMLElement && trigger.style.display !== "none") {
        trigger.click();
        opened = true;
        obs.disconnect();
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
</script>
`;

  // Splice bootstrap into the recipe's <head>. Recipes are expected to have
  // a <head> tag; if not, fall back to inserting after <html>.
  const headIdx = recipeHtml.search(/<head[^>]*>/i);
  if (headIdx === -1) {
    // No <head> — wrap minimally
    return `<!doctype html><html><head>${bootstrap}</head><body>${recipeHtml}</body></html>`;
  }
  const insertAfter = recipeHtml.indexOf(">", headIdx) + 1;
  return recipeHtml.slice(0, insertAfter) + bootstrap + recipeHtml.slice(insertAfter);
}
