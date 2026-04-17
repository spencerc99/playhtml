// Progressive enhancement for fenced code blocks.
//
// Wraps every Shiki-rendered `<pre class="astro-code">` in our `.ph-copy`
// chrome (copy button + tally counter), and — once `playhtml` has finished
// its initial sync — registers each block as a vanilla `can-play` element so
// the `wear` counter (tally marks) is shared across every reader.
//
// Design notes:
//
// - SSR-safe: runs on DOMContentLoaded. If JS never loads, readers still see
//   the highlighted `<pre>` with no UI around it — gracefully degrades.
//
// - Stable ids come from a djb2 hash of the raw code text + the page slug.
//   We deliberately don't use DOM position ("first block on the page") as
//   the id because re-ordering the markdown would silently wipe wear data.
//   Hashing the text means edits to the code refresh the counter, which is
//   usually what you want: a tally represents "how many people have copied
//   THIS exact snippet".
//
// - Vanilla API path: we set `element.defaultData`, `element.updateElement`,
//   and the `can-play` attribute on the wrapper, then call
//   `playhtml.setupPlayElement` once init is done. Clicks go through the
//   `ElementHandler.setData` on the registered handler so updates fan out
//   over Yjs like any other shared element.

import { playhtml } from "playhtml";

const WRAPPED = "data-ph-copy-enhanced";
// Version token lets us bump the id namespace in the future (e.g. if we
// change hash buckets or segment by language) without colliding with the
// old bucket of wear data.
const ID_VERSION = "v1";

type WearData = { wear: number };

function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    // eslint-disable-next-line no-bitwise
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  // Unsigned, base36 — short and URL-safe. Good enough for a 32-bit hash:
  // collisions on the same page would require ~65k blocks before birthday
  // bound; in practice a guide has ~20.
  // eslint-disable-next-line no-bitwise
  return (h >>> 0).toString(36);
}

function pageSlug(): string {
  // Strip trailing slash and leading "/docs" so the slug is stable across
  // trailing-slash variants and rebase'd deploys.
  const p = window.location.pathname.replace(/\/+$/, "");
  return p.replace(/^\/docs/, "") || "/";
}

function extractCodeText(pre: HTMLPreElement): string {
  const code = pre.querySelector("code");
  return (code ?? pre).textContent ?? "";
}

function renderTally(container: HTMLElement, wear: number): void {
  // Tally marks are hidden entirely for wear=0 via CSS (avoids an empty
  // rectangle on every block). Once someone copies, we start rendering
  // individual <span class="ph-copy__tick"> children up to a sensible cap.
  const CAP = 30; // past ~30 marks the UI gets noisy; group marks instead
  const displayed = Math.min(wear, CAP);
  // Only rebuild when the visual count actually changed.
  if (container.childElementCount === displayed) return;
  container.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let i = 0; i < displayed; i++) {
    const tick = document.createElement("span");
    tick.className = "ph-copy__tick";
    frag.appendChild(tick);
  }
  container.appendChild(frag);
  container.setAttribute("aria-label", `copied ${wear} times`);
}

interface EnhancedBlock {
  wrap: HTMLElement;
  tally: HTMLElement;
  btn: HTMLButtonElement;
  pre: HTMLPreElement;
  elementId: string;
}

const enhancedBlocks: EnhancedBlock[] = [];

function enhanceBlock(pre: HTMLPreElement): EnhancedBlock | null {
  if (pre.hasAttribute(WRAPPED)) return null;
  pre.setAttribute(WRAPPED, "1");

  const codeText = extractCodeText(pre);
  const slug = pageSlug();
  const elementId = `ph-copy-${ID_VERSION}-${djb2(slug + "|" + codeText)}`;

  const wrap = document.createElement("div");
  wrap.className = "ph-copy";
  wrap.id = elementId;
  wrap.setAttribute("can-play", "");
  wrap.setAttribute("data-wear", "0");
  wrap.setAttribute("data-pulse", "0");

  const frame = document.createElement("div");
  frame.className = "ph-copy__frame";

  const parent = pre.parentElement;
  if (!parent) return null;
  parent.insertBefore(wrap, pre);
  wrap.appendChild(frame);
  frame.appendChild(pre);

  const tally = document.createElement("span");
  tally.className = "ph-copy__tally";
  tally.setAttribute("aria-label", "copied 0 times");
  wrap.appendChild(tally);

  const meta = document.createElement("div");
  meta.className = "ph-copy__meta";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ph-copy__btn";
  btn.setAttribute("aria-label", "copy code");
  btn.textContent = "copy";
  meta.appendChild(btn);
  wrap.appendChild(meta);

  btn.addEventListener("click", async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(codeText);
      }
    } catch {
      // Clipboard may be unavailable; fall through so the pulse + wear bump
      // still register the copy intent.
    }
    wrap.setAttribute("data-pulse", "1");
    window.setTimeout(() => wrap.setAttribute("data-pulse", "0"), 450);

    // Bump shared wear. The updateElement callback registered below will
    // run on this client as well as every other reader's, so we don't need
    // to update the DOM optimistically.
    const handler = playhtml.elementHandlers?.get("can-play")?.get(elementId);
    if (!handler) {
      // playhtml hasn't finished syncing yet — rare, because the button
      // only mounts after DOMContentLoaded and sync usually lands in tens
      // of ms. Silently no-op rather than forking the rendering path.
      return;
    }
    const current = (handler as unknown as { _data?: WearData })._data;
    const next = (current?.wear ?? 0) + 1;
    handler.setData({ wear: next });
  });

  // Attach the vanilla-API properties playhtml reads off the DOM element
  // inside `setupPlayElement`. These have to be set BEFORE the setup call.
  const el = wrap as HTMLElement & {
    defaultData?: WearData;
    updateElement?: (data: { data: WearData }) => void;
  };
  el.defaultData = { wear: 0 };
  el.updateElement = ({ data }) => {
    const wear = Number(data?.wear ?? 0);
    wrap.setAttribute("data-wear", String(wear));
    renderTally(tally, wear);
  };

  return { wrap, tally, btn, pre, elementId };
}

async function registerWithPlayhtml(block: EnhancedBlock): Promise<void> {
  // Wait for playhtml.init() to finish. `setupPlayElement` is a no-op on
  // elements before the initial sync completes, so we need init to resolve
  // first. The HeadOverride.astro boot function kicks off init on window
  // load; by DOMContentLoaded this promise may or may not exist yet, so
  // we poll briefly.
  //
  // (playhtml exposes `hasInitialized` via its global but not via the
  // singleton export, so we poke at the internal handler map as a readiness
  // signal instead. Once `elementHandlers` is non-null, init has started
  // setting up tags and setupPlayElement is safe to call.)
  const ready = () => Boolean(playhtml.elementHandlers);
  if (!ready()) {
    await new Promise<void>((resolve) => {
      const interval = window.setInterval(() => {
        if (ready()) {
          window.clearInterval(interval);
          resolve();
        }
      }, 150);
    });
  }
  try {
    playhtml.setupPlayElement(block.wrap, { ignoreIfAlreadySetup: true });
  } catch (err) {
    console.warn("[docs] Failed to register code-block wear handler", err);
  }
}

export function enhanceAllCodeBlocks(): void {
  if (typeof document === "undefined") return;
  const blocks = document.querySelectorAll<HTMLPreElement>(
    "main pre.astro-code, article pre.astro-code",
  );
  blocks.forEach((pre) => {
    const enhanced = enhanceBlock(pre);
    if (!enhanced) return;
    enhancedBlocks.push(enhanced);
    void registerWithPlayhtml(enhanced);
  });
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhanceAllCodeBlocks, {
      once: true,
    });
  } else {
    enhanceAllCodeBlocks();
  }
}
