// ABOUTME: Renders a ghost of YOUR OWN cursor doing an emote gesture, and hides the OS cursor while it plays.
// ABOUTME: Self-only — peers animate their own real cursor node via cursorClient.triggerCursorAnimation, so no ghost is needed there.

import { getEmote } from "./emotes";

const GHOST_SIZE = 32;
const GHOST_OFFSET = GHOST_SIZE / 2;

export function cursorSvg(fill: string): string {
  return `<svg height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg" style="pointer-events:none;display:block;">
  <g fill="none" fill-rule="evenodd" transform="translate(10 7)">
    <path d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z" fill="#fff"/>
    <path d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z" fill="${fill}"/>
  </g>
</svg>`;
}

interface ActiveGhost {
  node: HTMLElement;
  timeoutId: ReturnType<typeof setTimeout>;
  armMoveId: ReturnType<typeof setTimeout>;
  onMove: () => void;
}

// Ignore mouse movement for this long after the emote starts, so the
// involuntary twitch right after firing doesn't instantly revert it. A
// deliberate move after the grace period cuts the emote short.
const MOVE_REVERT_GRACE_MS = 450;

const HIDE_CURSOR_STYLE_ID = "wwo-emote-hide-cursor";

// Hide the OS cursor via a stylesheet rule, not an inline style: playhtml
// re-writes documentElement.style.cursor (inline, no !important) on every
// mousemove, so an inline "none" loses. A stylesheet !important rule wins over
// playhtml's inline writes and keeps the real cursor hidden while our ghost plays.
function hideOsCursor(): void {
  if (document.getElementById(HIDE_CURSOR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIDE_CURSOR_STYLE_ID;
  style.textContent = "html, html * { cursor: none !important; }";
  document.head.appendChild(style);
}

function showOsCursor(): void {
  document.getElementById(HIDE_CURSOR_STYLE_ID)?.remove();
}

export class EmoteGhostRenderer {
  private active: ActiveGhost | null = null;

  constructor(
    private selfCursor: () => { x: number; y: number },
    private selfColor: () => string,
  ) {}

  /** Play an emote on a ghost copy of your own cursor at your current position. */
  play(emoteId: string): void {
    const def = getEmote(emoteId);
    if (!def) return;

    const pos = this.selfCursor();
    this.clear();

    const node = document.createElement("div");
    node.className = `emote-ghost cursor-gesture-${emoteId}`;
    node.style.cssText = `position:fixed;left:${pos.x - GHOST_OFFSET}px;top:${
      pos.y - GHOST_OFFSET
    }px;pointer-events:none;z-index:2147483646;opacity:1;`;
    node.innerHTML = cursorSvg(this.selfColor());

    const cleanup = () => this.clear();
    node.addEventListener("animationend", cleanup);
    document.body.appendChild(node);
    hideOsCursor();

    const timeoutId = setTimeout(cleanup, def.durationMs);

    // Let a deliberate mouse move cut the emote short — but only after a grace
    // period, so the twitch right after firing doesn't kill it instantly.
    const onMove = cleanup;
    const armMoveId = setTimeout(() => {
      window.addEventListener("mousemove", onMove, { once: true });
    }, MOVE_REVERT_GRACE_MS);

    this.active = { node, timeoutId, armMoveId, onMove };
  }

  destroy(): void {
    this.clear();
  }

  private clear(): void {
    if (!this.active) return;
    clearTimeout(this.active.timeoutId);
    clearTimeout(this.active.armMoveId);
    window.removeEventListener("mousemove", this.active.onMove);
    this.active.node.remove();
    showOsCursor();
    this.active = null;
  }
}
