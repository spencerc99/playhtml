// ABOUTME: Builds the srcdoc HTML wrapper for a playground iframe — injects
// ABOUTME: importmap, dev panel bottom-position bootstrap, and base CSS reset.

export type IframeTemplateArgs = {
  /** Recipe source. Must be a complete <!doctype html> document. */
  recipeHtml: string;
  /** Resolved playhtml URL (dev shim or unpkg). */
  playhtmlUrl: string;
  /** Room id the iframe's playhtml should join. */
  roomId: string;
  /** URL of the dev-panel-bottom override stylesheet. */
  devPanelStylesheetUrl: string;
};

/**
 * Build the srcdoc string for the playground iframe.
 *
 * Strategy: the recipe's source is a complete HTML document (the playground
 * authors recipes as full pages, see _starter.ts). We inject our wrappers
 * by string-splicing into the recipe's <head>:
 *
 *   1. Importmap so `import { playhtml } from "playhtml"` works.
 *   2. <link> to dev-panel-bottom.css so the dev panel renders at the bottom.
 *   3. A small bootstrap script that overrides playhtml.init's room option
 *      AND sets data-position="bottom" on the dev panel root (and clicks
 *      the trigger to auto-open it) once playhtml mounts.
 */
export function buildIframeSrcdoc(args: IframeTemplateArgs): string {
  const { recipeHtml, playhtmlUrl, roomId, devPanelStylesheetUrl } = args;

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
<link rel="stylesheet" href="${escapeAttr(devPanelStylesheetUrl)}">
<script type="module">
  // Monkey-patch playhtml.init to inject our roomId. Runs before the
  // recipe's own script imports playhtml (top-level await in the recipe
  // resolves after this module's import side-effects).
  const FORCED_ROOM = ${JSON.stringify(roomId)};
  const mod = await import("playhtml");
  const originalInit = mod.playhtml.init;
  mod.playhtml.init = function patchedInit(opts) {
    return originalInit.call(this, { ...(opts ?? {}), room: FORCED_ROOM });
  };

  // Watch for the dev panel to mount. When it does, set bottom position
  // and auto-open it (click the trigger).
  const obs = new MutationObserver(() => {
    const root = document.getElementById("playhtml-dev-root");
    if (!root) return;
    root.dataset.position = "bottom";
    const trigger = root.querySelector(".ph-trigger");
    if (trigger instanceof HTMLElement && trigger.style.display !== "none") {
      trigger.click();
    }
    obs.disconnect();
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

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
