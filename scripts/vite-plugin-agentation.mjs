// ABOUTME: Vite plugin that adds the Agentation feedback toolbar to every HTML page
// ABOUTME: in dev and on preview deploys (any non-main branch), never on production builds.

const VIRTUAL_ID = "virtual:agentation-toolbar";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const PRODUCTION_BRANCHES = ["main", "master"];

/**
 * Same rule directedit uses: a Cloudflare Pages / Workers Builds deploy whose
 * branch isn't a production branch. `AGENTATION=1|0` forces it either way.
 */
export function isPreviewBuild(env = process.env) {
  if (env.AGENTATION === "0" || env.AGENTATION === "false") return false;
  if (env.AGENTATION === "1" || env.AGENTATION === "true") return true;
  const branch = env.CF_PAGES_BRANCH || env.WORKERS_CI_BRANCH;
  if (branch) return !PRODUCTION_BRANCHES.includes(branch);
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "preview";
  return false;
}

// Mounts into its own root so it never touches the page's React tree.
const MOUNT_CODE = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Agentation } from "agentation";

// directedit's "Edit copy" pill sits in the same bottom-right corner, so lift the
// Agentation toolbar above it. Inline styles from dragging the toolbar still win.
const style = document.createElement("style");
style.textContent =
  'html:has(> directedit-ui) body [class*="styles-module__toolbar___"] { bottom: 4.25rem; }';
document.head.appendChild(style);

const host = document.createElement("div");
host.setAttribute("data-agentation-root", "");
document.body.appendChild(host);
createRoot(host).render(createElement(Agentation));
`;

/** @returns {import("vite").Plugin} */
export default function agentation() {
  let enabled = false;
  return {
    name: "playhtml:agentation",
    configResolved(config) {
      enabled = config.command === "serve" || isPreviewBuild();
    },
    resolveId(id) {
      if (enabled && id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (enabled && id === RESOLVED_ID) return MOUNT_CODE;
    },
    // "pre" so Vite bundles the injected script like any other module script on the page.
    transformIndexHtml: {
      order: "pre",
      handler() {
        if (!enabled) return;
        return [
          {
            tag: "script",
            attrs: { type: "module" },
            children: `import "${VIRTUAL_ID}";`,
            injectTo: "body",
          },
        ];
      },
    },
  };
}
