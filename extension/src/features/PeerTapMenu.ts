// ABOUTME: On a phone, tapping someone's cursor opens a small card beside it.
// ABOUTME: The card offers Follow (where the page supports it) and the live emotes.

import { injectShadow } from "../entrypoints/content/inject-ui";
import { PHONE_LAYOUT_QUERY } from "../entrypoints/scraps/phoneLayout";
import { ACTIVE_EMOTES } from "./emotes/emotes";
import {
  FIRE_EMOTE_EVENT,
  FOLLOW_AVAILABLE_ATTR,
  FOLLOW_PEER_EVENT,
  type FireEmoteDetail,
  type FollowPeerDetail,
} from "./peerEvents";

interface PeerTapCursorClient {
  getCursorIdAt(
    clientX: number,
    clientY: number,
    slopPx?: number,
  ): string | null;
  getCursorPresences(): Map<
    string,
    {
      cursor: { x: number; y: number } | null;
      playerIdentity?: { playerStyle?: { colorPalette?: string[] } };
    }
  >;
}

const TAP_SLOP_PX = 24;
const TAP_MOVE_PX = 10;
const TAP_MAX_MS = 500;
const CARD_WIDTH = 300;
const DEFAULT_COLOR = "#4a9a8a";

const CSS = `
  .card {
    position: fixed;
    width: ${CARD_WIDTH}px;
    box-sizing: border-box;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: #f8f5ef;
    border: 1px solid rgba(90,78,65,0.18);
    border-radius: 18px;
    box-shadow: 0 12px 34px rgba(61,56,51,0.18);
    color: #3d3833;
    font-family: 'Atkinson Hyperlegible', system-ui, sans-serif;
    pointer-events: auto;
    -webkit-user-select: none;
    user-select: none;
  }
  .who { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; }
  .dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
  .follow {
    min-height: 48px;
    border: 0;
    border-radius: 14px;
    background: #3d3833;
    color: #fffdf9;
    font: 700 16px 'Atkinson Hyperlegible', system-ui, sans-serif;
    cursor: pointer;
  }
  .label {
    font-family: 'Martian Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.06em;
    color: #6f675e;
  }
  .emotes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .emote {
    min-height: 56px;
    border: 1px solid rgba(90,78,65,0.18);
    border-radius: 14px;
    background: #fffdf9;
    color: #3d3833;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font: 400 13px 'Atkinson Hyperlegible', system-ui, sans-serif;
    cursor: pointer;
  }
  .emote-icon { font-family: 'Martian Mono', monospace; font-size: 15px; }
  .ring {
    position: fixed;
    width: 56px;
    height: 56px;
    margin: -28px 0 0 -28px;
    border-radius: 50%;
    border: 2px solid;
    opacity: 0.6;
    pointer-events: none;
  }
`;

function isPhone(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(PHONE_LAYOUT_QUERY).matches
  );
}

export function initPeerTapMenu(deps: {
  cursorClient: PeerTapCursorClient;
  emotesEnabled: boolean;
}): () => void {
  // Built on the first tap so a page that never goes phone-sized (or a phone
  // turned to landscape) carries no extra host until it's needed.
  let ui: { host: HTMLElement; shadow: ShadowRoot } | null = null;
  const getUI = () =>
    (ui ??= injectShadow({
      hostStyle:
        "position:fixed;inset:0;pointer-events:none;z-index:2147483646;",
      css: CSS,
    }));

  let open: { card: HTMLElement; ring: HTMLElement } | null = null;
  let swallowNextClick = false;
  let swallowTimer: ReturnType<typeof setTimeout> | null = null;
  const swallowClick = () => {
    swallowNextClick = true;
    if (swallowTimer) clearTimeout(swallowTimer);
    swallowTimer = setTimeout(() => {
      swallowNextClick = false;
    }, 400);
  };
  let down: { x: number; y: number; t: number } | null = null;

  const close = () => {
    open?.card.remove();
    open?.ring.remove();
    open = null;
  };

  const show = (pid: string, x: number, y: number) => {
    close();
    const canFollow = document.documentElement.hasAttribute(
      FOLLOW_AVAILABLE_ATTR,
    );
    const emotes = deps.emotesEnabled
      ? ACTIVE_EMOTES.filter((e) => e.kind === "solo")
      : [];
    if (!canFollow && emotes.length === 0) return;

    const color =
      deps.cursorClient.getCursorPresences().get(pid)?.playerIdentity
        ?.playerStyle?.colorPalette?.[0] ?? DEFAULT_COLOR;

    const ring = document.createElement("div");
    ring.className = "ring";
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.style.borderColor = color;

    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Someone here");

    const who = document.createElement("div");
    who.className = "who";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = color;
    who.append(dot, "someone here");
    card.append(who);

    if (canFollow) {
      const follow = document.createElement("button");
      follow.type = "button";
      follow.className = "follow";
      follow.textContent = "Follow them";
      follow.addEventListener("click", () => {
        window.dispatchEvent(
          new CustomEvent<FollowPeerDetail>(FOLLOW_PEER_EVENT, {
            detail: { publicKey: pid, color },
          }),
        );
        close();
      });
      card.append(follow);
    }

    if (emotes.length > 0) {
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = "EMOTES";
      const grid = document.createElement("div");
      grid.className = "emotes";
      for (const emote of emotes) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "emote";
        const icon = document.createElement("span");
        icon.className = "emote-icon";
        icon.textContent = emote.icon;
        button.append(icon, emote.label);
        button.addEventListener("click", () => {
          window.dispatchEvent(
            new CustomEvent<FireEmoteDetail>(FIRE_EMOTE_EVENT, {
              detail: { emoteId: emote.id, x, y },
            }),
          );
          close();
        });
        grid.append(button);
      }
      card.append(label, grid);
    }

    getUI().shadow.append(ring, card);
    // Sit under the cursor, or above it when the bottom of the screen is near.
    const margin = 12;
    const left = Math.min(
      Math.max(margin, x - CARD_WIDTH / 2),
      window.innerWidth - CARD_WIDTH - margin,
    );
    const height = card.offsetHeight;
    const below = y + 40;
    const top =
      below + height + margin <= window.innerHeight
        ? below
        : Math.max(margin, y - 40 - height);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    open = { card, ring };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !e.isPrimary) return;
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };

  const onPointerUp = (e: PointerEvent) => {
    const start = down;
    down = null;
    if (!start || e.pointerType !== "touch" || !isPhone()) return;
    // Taps inside the card belong to its buttons.
    if (ui && e.composedPath().includes(ui.host)) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved > TAP_MOVE_PX || e.timeStamp - start.t > TAP_MAX_MS) return;
    const pid = deps.cursorClient.getCursorIdAt(
      e.clientX,
      e.clientY,
      TAP_SLOP_PX,
    );
    if (!pid) {
      if (open) {
        close();
        swallowClick();
      }
      return;
    }
    show(pid, e.clientX, e.clientY);
    if (open) swallowClick();
  };

  // A tap that opens or dismisses the card shouldn't also press whatever
  // link sits under the cursor.
  const onClick = (e: MouseEvent) => {
    if (!swallowNextClick) return;
    swallowNextClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onScroll = () => close();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("keydown", onKeyDown);

  return () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("keydown", onKeyDown);
    if (swallowTimer) clearTimeout(swallowTimer);
    close();
    ui?.host.remove();
  };
}
