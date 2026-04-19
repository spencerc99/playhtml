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
//
// - Live copy effect: on click we ALSO dispatch a `docs-code-copy` play event
//   with the copier's cursor color + a seeded burst of particles. Every
//   reader — including other pages — subscribes once; when the event arrives
//   and the block is present on the current page, we flash a color-matched
//   glow and spawn a short confetti of packet-rectangles + characters sampled
//   from the copied code text. Both the glow color and the particle layout
//   are carried in the event payload so what the copier sees is exactly what
//   everyone else sees.

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

// Threshold at which the numeric count badge appears alongside the rolling
// row. Below this, the tally itself communicates the count exactly; above
// this, the row keeps rolling for the per-event signal and the badge
// carries the absolute magnitude.
const COUNT_BADGE_THRESHOLD = 26;

// Maximum number of tick elements we keep in the DOM at any time. The
// rolling window only ever shows ~25 visually (the rest are hidden by
// the CSS overflow + fade mask), but we keep a small buffer so the
// fade-out region has elements to paint. Past this we prune the oldest
// (leftmost) ticks; they're already invisible anyway.
const MAX_TICK_DOM_NODES = 35;

// Compact human-readable count formatter: "47", "1.2k", "12k", "1.2M".
// We don't show fractional ks past 9999 because the badge gets too wide.
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.floor(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

// Stamp a tick element. `copyIndex` is the 1-indexed copy number this
// tick represents (1, 2, 3...) — every 5th gets the crossbar class so
// the bundle pattern is locked in at creation time, not derived from
// nth-child position. This is critical for the rolling row: when ticks
// scroll off the left edge, the remaining ticks must keep their
// crossbar/vertical roles to avoid a visible re-layout shimmer.
function makeTick(
  copyIndex: number,
  animated: boolean,
  delayMs: number,
): HTMLElement {
  const tick = document.createElement("span");
  const isCross = copyIndex % 5 === 0;
  let cls = "ph-copy__tick";
  if (isCross) cls += " ph-copy__tick--cross";
  if (animated) cls += " ph-copy__tick--new";
  tick.className = cls;
  if (animated && delayMs > 0) {
    tick.style.setProperty("--ph-tick-delay", `${delayMs}ms`);
  }
  if (animated) {
    // Strip the animation marker after it finishes so re-renders don't
    // accidentally replay it (also helps the browser drop the will-change
    // hint). Long enough for slowest staggered tick: draw 500 + glow 800
    // + max delay 600 ≈ 1400ms, plus a safety buffer.
    window.setTimeout(() => tick.classList.remove("ph-copy__tick--new"), 1600);
  }
  return tick;
}

// Locate (or lazily create) the two structural children of the tally
// container: the count badge on the left, and the rolling tick window
// on the right. Returns both so the caller doesn't re-query.
function ensureTallyParts(container: HTMLElement): {
  badge: HTMLElement;
  window: HTMLElement;
} {
  let badge = container.querySelector<HTMLElement>(":scope > .ph-copy__count");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "ph-copy__count";
    container.appendChild(badge);
  }
  let win = container.querySelector<HTMLElement>(":scope > .ph-copy__tally-window");
  if (!win) {
    win = document.createElement("span");
    win.className = "ph-copy__tally-window";
    container.appendChild(win);
  }
  return { badge, window: win };
}

// Prune oldest tick nodes from the rolling window. They're already
// invisible (clipped by overflow + faded by the mask), but unbounded
// DOM growth on a heavily-copied snippet would be wasteful.
function pruneTickWindow(win: HTMLElement): void {
  while (win.childElementCount > MAX_TICK_DOM_NODES) {
    win.firstElementChild?.remove();
  }
}

// Initial paint — runs once when the element first receives data from
// playhtml. No animations: existing ticks are server-state, not events.
// Renders up to the most recent ~MAX_TICK_DOM_NODES ticks (older copies
// would be invisible anyway in the rolling window).
function renderTallyInitial(container: HTMLElement, wear: number): void {
  container.innerHTML = "";
  const { badge, window: win } = ensureTallyParts(container);

  // Render the most recent ticks. If wear < MAX_TICK_DOM_NODES, render
  // them all starting from copy #1; otherwise render copies
  // (wear - MAX + 1) .. wear so the bundle pattern stays anchored to the
  // actual copy indices.
  const startIdx = Math.max(1, wear - MAX_TICK_DOM_NODES + 1);
  const frag = document.createDocumentFragment();
  for (let i = startIdx; i <= wear; i++) {
    frag.appendChild(makeTick(i, false, 0));
  }
  win.appendChild(frag);

  if (wear >= COUNT_BADGE_THRESHOLD) {
    badge.textContent = `×${formatCount(wear)}`;
    badge.removeAttribute("hidden");
  } else {
    badge.setAttribute("hidden", "");
    badge.textContent = "";
  }

  container.setAttribute("aria-label", `copied ${wear} times`);
}

// Delta paint — runs on every wear update after the initial render. The
// rolling row IS the per-copy signal: every increment appends a fresh
// tick (with draw-in + glow animation) on the right, existing ticks
// shift left, and the leftmost tick fades out into the window's left-
// edge mask. The tally always feels alive on every copy, no matter how
// high the count climbs.
function bumpTally(container: HTMLElement, wear: number, prev: number): void {
  if (wear === prev) return;
  // Defensive fallback: if wear ever decreases (server reset, stale
  // snapshot), rebuild from scratch rather than try to "un-animate"
  // ticks that already drew in.
  if (wear < prev) {
    renderTallyInitial(container, wear);
    return;
  }

  const { badge, window: win } = ensureTallyParts(container);

  // Append a fresh tick for each new copy, staggered so multi-step
  // increments cascade rather than flashing simultaneously. Each tick
  // knows its own copy index (used to decide crossbar vs vertical), so
  // when older ticks later scroll off the left, the visible bundle
  // pattern stays perfectly aligned — no re-layout shimmer.
  const additions = wear - prev;
  for (let i = 0; i < additions; i++) {
    const copyIndex = prev + 1 + i;
    // Cap per-tick delay so a big batch doesn't take seconds. 600ms
    // total feels lively without dragging.
    const delay = Math.min(i * 80, 600);
    win.appendChild(makeTick(copyIndex, true, delay));
  }
  pruneTickWindow(win);

  // Show the absolute count once the row passes the threshold. The
  // badge updates silently — no bump animation, because the rolling
  // tally is doing the per-event signaling already and a duplicate
  // flourish would feel busy.
  if (wear >= COUNT_BADGE_THRESHOLD) {
    badge.textContent = `×${formatCount(wear)}`;
    badge.removeAttribute("hidden");
  } else {
    badge.setAttribute("hidden", "");
    badge.textContent = "";
  }

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

  // Tally lives INSIDE the bottom meta bar (alongside the copy button)
  // rather than absolutely-positioned in the upper-right corner. The
  // corner placement covered the actual code on short single-line
  // snippets; the meta bar already has horizontal room and a matching
  // background, so the tally slots into it naturally.
  const tally = document.createElement("span");
  tally.className = "ph-copy__tally";
  tally.setAttribute("aria-label", "copied 0 times");

  const meta = document.createElement("div");
  meta.className = "ph-copy__meta";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ph-copy__btn";
  btn.setAttribute("aria-label", "copy code");
  btn.textContent = "copy";
  // DOM order matters here: tally first so it reads left-to-right with
  // the button on the right. The button's `margin-left: auto` (in CSS)
  // pushes it to the meta bar's right edge regardless of whether the
  // tally is currently visible.
  meta.appendChild(tally);
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

    // Broadcast the live copy effect. The listener (registered once below)
    // runs on every client including this one, so we deliberately DON'T
    // trigger the pulse/particles locally — the event path is the single
    // source of truth. This keeps the animation frames in sync: whatever
    // the copier sees is what every other reader sees.
    dispatchCopyEffect(elementId, codeText);

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
  // Track the previous wear value so we can distinguish "first paint from
  // server state" (no animation) from "someone just copied" (per-event
  // bump). Sentinel -1 means we haven't received any data yet.
  let lastWear = -1;
  el.updateElement = ({ data }) => {
    const wear = Number(data?.wear ?? 0);
    wrap.setAttribute("data-wear", String(wear));
    if (lastWear < 0) {
      renderTallyInitial(tally, wear);
    } else {
      bumpTally(tally, wear, lastWear);
    }
    lastWear = wear;
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

// ---------------------------------------------------------------------
// Live copy-effect: shared glow + confetti of packet rectangles and
// characters plucked from the code snippet.
// ---------------------------------------------------------------------

const COPY_EVENT = "docs-code-copy";

// Each particle is a single character plucked from the snippet, flying off
// the page toward (and past) a viewport edge. The motion is intentionally
// page-scale, not local: a copy feels like the snippet is scattering into
// the rest of the document, not puffing out a small halo above the block.
//
// Trajectories are expressed as DIRECTION + SPEED rather than raw pixel
// offsets, so each reader's viewport determines how far the chars travel.
// A reader on a big monitor sees particles fly the full width of their
// screen; a reader on a phone sees them reach their own edges. The
// dispatcher only has to care about "how much of the viewport" each
// particle covers, not absolute math done once and shipped.
type CopyParticle = {
  char: string;
  sx: number; // [0..1] starting position along the top edge of the block
  angleDeg: number; // direction of travel, in CSS angle space (0 = right, 90 = down)
  speed: number; // reach as a multiple of max(viewportWidth, viewportHeight)
  startRot: number;
  endRot: number;
  dur: number; // animation duration in ms
  delay: number; // animation start offset in ms
  scale: number; // final scale multiplier
};

type CopyEventPayload = {
  id: string;
  color: string;
  particles: CopyParticle[];
};

function readCursorColor(): string {
  // Fallback to the hex value of --ph-mustard when cursors haven't
  // initialized yet. We use a concrete hex (not `var(--ph-mustard)`)
  // because this string round-trips through the play event payload and
  // is also written directly onto inline style.color on particles —
  // some browsers refuse `var(...)` references when set imperatively.
  try {
    const c = (window as any).cursors?.color;
    if (typeof c === "string" && c.length > 0) return c;
  } catch {}
  return "#e8a63a";
}

function randInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Always 90° (straight down). Code blocks almost always have more page
// room beneath them (the article continues), and downward-falling chars
// stay in view longer for other readers to notice them. The per-particle
// ±12° fan applied in the burst builder gives the column enough texture
// to feel organic without scattering.
const BASE_ANGLE_DEG = 90;

function pickParticleCount(codeText: string, charPool: string): number {
  // Scale by line count first, then add a small density bonus from total
  // characters. Line count is what the eye uses to judge "how big is
  // this snippet?" — a one-liner should feel obviously different from a
  // 20-line block.
  //
  //   1 line, ~12 chars   → 2 + 0  → 3 (clamped to floor)
  //   1 line, ~60 chars   → 2 + 1  → 3
  //   3 lines, ~80 chars  → 4 + 1  → 5
  //   5 lines, ~200 chars → 6 + 3  → 9
  //   10 lines, ~400 chars→ 11 + 6 → 17
  //   20 lines, ~800 chars→ 21 + 8 → 29 (clamped to cap)
  const lineCount = codeText.split("\n").length;
  const density = Math.min(8, Math.floor(charPool.length / 60));
  const raw = lineCount + density + 1;
  return Math.min(28, Math.max(3, raw));
}

function buildParticleBurst(codeText: string): CopyParticle[] {
  const pool = codeText.replace(/\s+/g, "");
  if (!pool) return [];

  const count = pickParticleCount(codeText, pool);

  const particles: CopyParticle[] = [];
  for (let i = 0; i < count; i++) {
    const char = pool[Math.floor(Math.random() * pool.length)];

    particles.push({
      char,
      // Spread origins across the middle of the block's bottom edge.
      // Avoid the extreme left/right edges so chars don't launch from
      // the block's corner borders.
      sx: randInRange(0.12, 0.88),
      // Tight fan around the (always downward) base angle. ±12° is
      // enough to feel organic (not a hard column of text) without the
      // chars diverging visibly.
      angleDeg: BASE_ANGLE_DEG + randInRange(-12, 12),
      // Reach as a multiple of the bigger viewport dimension. 0.6-1.1
      // guarantees most chars cross or nearly cross the viewport edge
      // before they fade, so "fly off the screen" reads even on wide
      // monitors.
      speed: randInRange(0.6, 1.1),
      startRot: randInRange(-15, 15),
      endRot: randInRange(-360, 360),
      // Durations + staggered delays: each char leaves at a slightly
      // different moment and travels at a slightly different speed, so
      // the gust has internal texture even though everyone shares a
      // direction.
      dur: randInRange(1400, 2400),
      delay: randInRange(0, 260),
      scale: randInRange(0.9, 1.35),
    });
  }
  return particles;
}

function dispatchCopyEffect(elementId: string, codeText: string): void {
  const payload: CopyEventPayload = {
    id: elementId,
    color: readCursorColor(),
    particles: buildParticleBurst(codeText),
  };
  playhtml.dispatchPlayEvent({ type: COPY_EVENT, eventPayload: payload });
}

function spawnParticle(
  origin: { x: number; y: number; width: number },
  viewport: { w: number; h: number },
  p: CopyParticle,
): void {
  const el = document.createElement("span");
  el.className = "ph-copy-particle ph-copy-particle--char";
  el.textContent = p.char;

  // Particles intentionally inherit the document's text color and the
  // code font; they should read as "characters from the snippet falling
  // out of it", not as a colored UI flourish. The copier's cursor color
  // is still expressed via the box pulse on the code block itself.

  const startX = origin.x + (p.sx - 0.5) * origin.width;

  // Convert direction + speed into local pixel offsets. Using each
  // reader's current viewport means every reader gets a "screen-filling"
  // travel regardless of resolution. `reach` is the travel distance;
  // dx/dy are its horizontal/vertical components.
  const maxDim = Math.max(viewport.w, viewport.h);
  const reach = maxDim * p.speed;
  const rad = (p.angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * reach;
  const dy = Math.sin(rad) * reach;

  el.style.left = `${Math.round(startX)}px`;
  el.style.top = `${Math.round(origin.y)}px`;
  el.style.setProperty("--sx", `${p.startRot}deg`);
  el.style.setProperty("--tx", `${Math.round(dx)}px`);
  el.style.setProperty("--ty", `${Math.round(dy)}px`);
  el.style.setProperty("--rot", `${p.endRot}deg`);
  el.style.setProperty("--dur", `${Math.round(p.dur)}ms`);
  el.style.setProperty("--delay", `${Math.round(p.delay)}ms`);
  el.style.setProperty("--scl", `${p.scale.toFixed(2)}`);

  document.body.appendChild(el);

  // Safety net: animationend should fire once the keyframe completes, but
  // some browsers/contexts can swallow it (tab backgrounded, user prefers
  // reduced motion). Setting a timeout slightly longer than dur+delay
  // guarantees the node is removed and we don't leak DOM on heavy pages.
  const cleanup = () => {
    el.removeEventListener("animationend", cleanup);
    el.remove();
  };
  el.addEventListener("animationend", cleanup);
  window.setTimeout(cleanup, p.dur + p.delay + 400);
}

function triggerCopyEffect(payload: CopyEventPayload): void {
  const el = document.getElementById(payload.id);
  if (!(el instanceof HTMLElement)) return;

  // Colored glow — drive via CSS variable so the same keyframe can render
  // any copier's hue without editing the stylesheet. The pulse is removed
  // ~50ms after animation end so a second copy restarts it cleanly.
  el.style.setProperty("--ph-copy-pulse-color", payload.color);
  el.setAttribute("data-pulse", "1");
  window.setTimeout(() => el.setAttribute("data-pulse", "0"), 500);

  // Particles fall from the BOTTOM edge of the block in viewport space.
  // We read the rect right before spawning so the effect lands correctly
  // no matter where the reader has scrolled to. Spawning at the bottom
  // (rather than the top) means the chars travel through the article
  // content beneath the block — never through the block itself — which
  // matches the "they fall out of the snippet" intuition. Viewport
  // dimensions are captured here too so each reader's travel distance is
  // tuned to their own window.
  const rect = el.getBoundingClientRect();
  const origin = {
    x: rect.left + rect.width / 2,
    y: rect.bottom - 4,
    width: Math.min(rect.width, 420),
  };
  const viewport = {
    w: Math.max(window.innerWidth, 320),
    h: Math.max(window.innerHeight, 480),
  };
  payload.particles.forEach((p) => spawnParticle(origin, viewport, p));
}

function registerCopyEventListener(): void {
  // Wait for init to start, same readiness signal used by block handler
  // registration. Avoids the "event not registered" error console log.
  const ready = () => Boolean(playhtml.elementHandlers);
  const attach = () => {
    playhtml.registerPlayEventListener(COPY_EVENT, {
      onEvent: (payload: CopyEventPayload | undefined) => {
        if (!payload || !payload.id) return;
        triggerCopyEffect(payload);
      },
    });
  };
  if (ready()) {
    attach();
    return;
  }
  const interval = window.setInterval(() => {
    if (ready()) {
      window.clearInterval(interval);
      attach();
    }
  }, 150);
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        enhanceAllCodeBlocks();
        registerCopyEventListener();
      },
      { once: true },
    );
  } else {
    enhanceAllCodeBlocks();
    registerCopyEventListener();
  }
}
