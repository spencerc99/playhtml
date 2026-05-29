// ABOUTME: Wikipedia-specific collaborative browsing features.
// ABOUTME: Link glow visualization, cursor following, and navigation broadcast for article links.

import type { PresenceView } from "@playhtml/common";
import type { CustomSiteDeps } from "./index";
import { FollowManager } from "../features/FollowManager";

export interface WikiPresenceFields {
  navigatingTo?: { url: string; title: string } | null;
  following?: string | null;
  page?: { url: string; title: string; color: string; pid?: string } | null;
}

export type WikiPresenceView = PresenceView & WikiPresenceFields;

const CHAT_PANEL_CSS = `
:host { all: initial; }
.chat-panel {
  width: 240px;
  max-height: 280px;
  background: #faf7f2;
  border: 1px solid rgba(90, 78, 65, 0.2);
  border-radius: 6px;
  box-shadow: 2px 4px 14px rgba(0,0,0,0.1);
  overflow: hidden;
  font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
  font-size: 12px;
  color: #3d3833;
  display: flex;
  flex-direction: column;
  position: relative;
}
.chat-panel::after {
  content: "";
  position: absolute;
  right: 16px;
  bottom: -6px;
  width: 10px; height: 10px;
  background: #faf7f2;
  border-right: 1px solid rgba(90, 78, 65, 0.2);
  border-bottom: 1px solid rgba(90, 78, 65, 0.2);
  transform: rotate(45deg);
}
.chat-titlebar {
  background: rgba(196, 114, 78, 0.08);
  border-bottom: 1px solid rgba(90, 78, 65, 0.1);
  padding: 5px 8px;
  font-size: 11px;
  display: flex; justify-content: space-between; align-items: center;
}
.chat-title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.chat-close {
  background: none; border: none; cursor: pointer;
  color: #8a8279; font-size: 16px; line-height: 1; padding: 0 4px;
  font-weight: 700;
}
.chat-close:hover { color: #3d3833; }
.chat-name-strip {
  padding: 3px 8px;
  border-bottom: 1px solid rgba(90, 78, 65, 0.06);
  font-size: 11px;
  color: #8a8279;
  display: flex; align-items: center; gap: 5px;
}
.chat-name-strip .you-label strong { color: #3d3833; font-weight: 600; }
.chat-name-strip .chat-handle-link {
  color: #3d3833;
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: rgba(91, 141, 184, 0.5);
  text-underline-offset: 2px;
}
.chat-name-strip .chat-handle-link:hover {
  text-decoration-color: #5b8db8;
  color: #5b8db8;
}
.chat-name-strip .chat-name-actions {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 8px;
  flex: 0 0 auto;
}
.chat-name-strip .chat-be-page {
  background: none; border: none; cursor: pointer; padding: 0;
  color: #8a8279; display: inline-flex; align-items: center;
  transition: color 120ms ease;
}
.chat-name-strip .chat-be-page:hover { color: #5b8db8; }
.chat-name-strip .chat-reroll-dice {
  background: none; border: none; cursor: pointer; padding: 0;
  color: #8a8279; display: inline-flex; align-items: center;
  transition: color 120ms ease;
}
.chat-name-strip .chat-reroll-dice:hover { color: #5b8db8; }
.you-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
.chat-body {
  padding: 6px 8px;
  flex: 1 1 auto;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.45;
  min-height: 60px;
  max-height: 180px;
}
.chat-msg { margin-bottom: 3px; word-wrap: break-word; }
.chat-msg-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; vertical-align: middle; margin-right: 4px; }
.chat-msg-who { color: #5a4e41; font-weight: 600; }
a.chat-msg-who {
  text-decoration: underline;
  text-decoration-color: rgba(90, 78, 65, 0.3);
  text-underline-offset: 2px;
  cursor: pointer;
}
a.chat-msg-who:hover { color: #5b8db8; text-decoration-color: #5b8db8; }
.chat-msg-body { color: #3d3833; }

/* Wikipedia hovercard for article-name links */
.wiki-link-wrap { position: relative; }
.wiki-hovercard {
  position: fixed;
  z-index: 2147483646;
  width: 240px;
  max-height: 220px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #faf7f2;
  border: 1px solid rgba(90, 78, 65, 0.25);
  border-radius: 5px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
  color: #3d3833;
  pointer-events: none;
}
.wiki-hovercard__thumb {
  width: 100%;
  height: 96px;
  object-fit: cover;
  display: block;
  border-bottom: 1px solid rgba(90, 78, 65, 0.12);
}
.wiki-hovercard__text { padding: 7px 9px 9px; display: flex; flex-direction: column; gap: 2px; }
.wiki-hovercard__title {
  font-family: "Lora", "Atkinson Hyperlegible", serif;
  font-weight: 700;
  font-size: 12.5px;
}
.wiki-hovercard__desc {
  font-size: 10px;
  color: #8a8279;
  font-style: italic;
}
.wiki-hovercard__extract {
  font-size: 11px;
  line-height: 1.4;
  color: #3d3833;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.chat-error {
  padding: 3px 8px;
  background: rgba(196, 114, 78, 0.08);
  color: #c4724e;
  font-size: 11px;
  border-top: 1px solid rgba(196, 114, 78, 0.2);
}
.chat-input-row {
  border-top: 1px solid rgba(90, 78, 65, 0.1);
  padding: 4px 8px;
  background: #f5f0e8;
  display: flex; align-items: center; gap: 5px;
}
.chat-input-row.has-error { background: rgba(196, 114, 78, 0.05); }
.chat-input {
  flex: 1 1 auto;
  border: none; background: transparent; outline: none;
  font-family: inherit; font-size: 12px; color: #3d3833;
  resize: none;
  min-height: 18px;
  max-height: 60px;
  line-height: 1.4;
}
.chat-input::placeholder { color: #b8b0a6; }
.chat-counter { font-size: 10px; color: #b8b0a6; }
`;

// Human-readable label for the current Wikipedia page, used as the chat
// room title. Handles articles, main page, and namespace pages like
// Special:RecentChanges or Talk:Octopus.
export function wikipediaPageLabel(): string {
  const path = location.pathname;
  // Main page: en.wikipedia.org/, /wiki/Main_Page, /wiki/, /wiki/Wikipedia:Main_Page
  if (path === "/" || path === "/wiki/" || /\/wiki\/(Main_Page|Wikipedia:Main_Page)$/.test(path)) {
    return "Wikipedia home";
  }
  const match = path.match(/\/wiki\/(.+)$/);
  if (match) {
    const raw = decodeURIComponent(match[1]).replace(/_/g, " ");
    // Namespace pages like "Special:RecentChanges" or "Talk:Octopus" — keep the prefix
    return raw;
  }
  // Fallback to <title> with trailing " - Wikipedia" stripped
  const title = document.title.replace(/ - Wikipedia$/, "").trim();
  return title.length > 0 ? title : "Wikipedia";
}

// The current page's article title, but only when it's a real article (so it
// can be offered as a "be this page" handle). null on the main page, namespace
// pages (Special:/Talk:/etc.), and anything that isn't an article.
export function currentWikipediaArticleName(): string | null {
  const path = location.pathname;
  // The main page is a "/wiki/" URL with no namespace colon, so isWikiArticleUrl
  // treats it as an article — exclude it explicitly (matches wikipediaPageLabel).
  if (path === "/" || path === "/wiki/" || /\/wiki\/(Main_Page|Wikipedia:Main_Page)$/.test(path)) {
    return null;
  }
  if (!isWikiArticleUrl(location.href)) return null;
  const match = path.match(/\/wiki\/(.+)$/);
  if (!match) return null;
  return decodeURIComponent(match[1]).replace(/_/g, " ");
}

// True when a keyboard event target is a text input the user is typing into,
// so we don't hijack keys like "/" out from under them.
function isEditableTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

// Matches /wiki/ArticleName but not /wiki/Special: /wiki/Talk: etc.
export function isWikiArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url, location.origin);
    return /\/wiki\//.test(parsed.pathname) && !/\/wiki\/[A-Za-z_]+:/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export async function initWikipedia(deps: CustomSiteDeps): Promise<() => void> {
  const cleanups: (() => void)[] = [];

  // Link glow
  const { LinkGlowManager } = await import("../features/LinkGlowManager");
  const glowManager = new LinkGlowManager(deps.playerColor, deps.createPageData);
  glowManager.init();
  cleanups.push(() => glowManager.destroy());

  // Follow manager
  const followManager = new FollowManager(deps.presence);
  followManager.init();
  cleanups.push(() => followManager.destroy());

  // Wire proximity detection into the cursor client
  if (deps.cursorClient) {
    deps.cursorClient.configure({
      proximityThreshold: 250,
      onProximityEntered: (identity: any, positions: any) => {
        followManager.onProximityEntered(identity, positions);
      },
      onProximityLeft: (connectionId: string) => {
        followManager.onProximityLeft(connectionId);
      },
    });
  }

  // Domain-wide lobby for cross-page awareness
  let lobbyPresence = deps.presence; // fallback to page presence if lobby unavailable
  if (typeof deps.createPresenceRoom === "function") {
    const lobby = deps.createPresenceRoom("lobby");
    lobby.presence.setMyPresence("page", {
      url: location.href,
      title: document.title.replace(/ - Wikipedia$/, ""),
      color: deps.playerColor,
      pid: lobby.presence.getMyIdentity().publicKey,
    });
    lobbyPresence = lobby.presence;
    cleanups.push(() => lobby.destroy());
  }

  // === Tab-focus dimming for remote cursors ===
  // Broadcast our own focused state so peers can dim our cursor when our tab
  // isn't active. Receive peers' focused state and feed it to a getCursorStyle
  // closure that dims unfocused cursors.
  const unfocusedPeers = new Set<string>();

  function broadcastFocused() {
    const focused = document.hasFocus() && document.visibilityState === "visible";
    deps.presence.setMyPresence("focused", focused);
  }

  if (deps.cursorClient) {
    const cursorClient = deps.cursorClient;
    cursorClient.configure({
      getCursorStyle: (presence: any) => {
        const pid = presence?.playerIdentity?.publicKey;
        if (pid && unfocusedPeers.has(pid)) {
          return { opacity: "0.3", filter: "grayscale(0.7)" };
        }
        return {};
      },
    });

    const unsubFocused = deps.presence.onPresenceChange("focused", (presences) => {
      const myPid = deps.presence.getMyIdentity().publicKey;
      unfocusedPeers.clear();
      presences.forEach((view, pid) => {
        if (pid === myPid) return;
        const raw = (view as Record<string, unknown>).focused;
        // Treat missing/undefined as focused (be lenient — peer may not broadcast)
        if (raw === false) unfocusedPeers.add(pid);
      });
      // Re-apply styles so peers that came back into focus get their dim cleared
      // and peers that just blurred get dimmed.
      cursorClient.refreshCursorStyles?.();
    });
    cleanups.push(unsubFocused);

    broadcastFocused();
    window.addEventListener("focus", broadcastFocused);
    window.addEventListener("blur", broadcastFocused);
    document.addEventListener("visibilitychange", broadcastFocused);
    cleanups.push(() => {
      window.removeEventListener("focus", broadcastFocused);
      window.removeEventListener("blur", broadcastFocused);
      document.removeEventListener("visibilitychange", broadcastFocused);
    });
  }

  // === Chat: per-article live chat (manager first, pill wired to it) ===
  const { ChatManager } = await import("../features/ChatManager");
  const { ChatEchoRenderer } = await import("../features/chat-echo-renderer");
  const { injectShadowReact } = await import("../entrypoints/content/inject-ui");
  const { ChatPanel } = await import("../components/ChatPanel");

  const articleTitle = wikipediaPageLabel();
  const chatManager = new ChatManager(
    deps.presence,
    articleTitle,
    currentWikipediaArticleName(),
  );
  await chatManager.init();

  // Ambient presence count + jump-to-someone + chat toggle
  const { PresenceCountPill } = await import("../features/PresenceCountPill");
  const presencePill = new PresenceCountPill(
    deps.presence,
    lobbyPresence,
    () => chatManager.toggle(),
  );
  presencePill.init();
  cleanups.push(() => presencePill.destroy());

  // Mount the chat panel only while open; tear down when closed.
  let panelUI: { render: (props: any) => void; destroy: () => void } | null = null;

  function buildPanelProps() {
    const s = chatManager.getState();
    return {
      messages: s.messages,
      handle: s.handle,
      myColor: s.myColor,
      articleTitle: s.articleTitle,
      currentArticleName: s.currentArticleName,
      sendError: s.sendError,
      focusNonce: s.focusNonce,
      onSend: (text: string) => { chatManager.send(text); },
      onClose: () => { chatManager.close(); },
      onReroll: () => { void chatManager.reroll(); },
      onUsePage: () => { void chatManager.useCurrentPage(); },
      onClearError: () => { chatManager.clearError(); },
    };
  }

  function syncPanel() {
    const state = chatManager.getState();
    if (state.isOpen && !panelUI) {
      panelUI = injectShadowReact(ChatPanel as any, buildPanelProps(), {
        hostId: "wewere-chat-panel-host",
        hostStyle: "position:fixed;bottom:48px;right:16px;z-index:2147483639;",
        css: CHAT_PANEL_CSS,
      });
    } else if (state.isOpen && panelUI) {
      panelUI.render(buildPanelProps());
    } else if (!state.isOpen && panelUI) {
      panelUI.destroy();
      panelUI = null;
    }
  }

  const unsubChat = chatManager.subscribe(() => {
    const state = chatManager.getState();
    presencePill.setChatOpen(state.isOpen);
    presencePill.setChatUnread(state.unread);
    syncPanel();
  });
  cleanups.push(unsubChat);
  cleanups.push(() => {
    panelUI?.destroy();
    panelUI = null;
    chatManager.destroy();
  });

  // "/" opens the chat (or focuses its input if already open) — never closes
  // it. Closing is Esc or the minimize button. Ignored while typing anywhere,
  // including our own chat input, where "/" should just type a slash.
  function onSlashKey(e: KeyboardEvent) {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (isEditableTarget(target)) return;
    // Events originating inside our chat panel's shadow root are retargeted to
    // the shadow host at the document level — guard against that too.
    if (target && target.id === "wewere-chat-panel-host") return;
    e.preventDefault();
    chatManager.openOrFocus();
  }
  document.addEventListener("keydown", onSlashKey);
  cleanups.push(() => document.removeEventListener("keydown", onSlashKey));

  // Cursor-anchored echo bubble for each message
  if (deps.cursorClient) {
    const echoRenderer = new ChatEchoRenderer(deps.cursorClient);
    const unsubEcho = deps.presence.onPresenceChange("chat", (presences) => {
      presences.forEach((view, pid) => {
        const raw = (view as Record<string, unknown>).chat;
        if (!raw || typeof raw !== "object") return;
        const m = raw as Record<string, unknown>;
        if (typeof m.text !== "string" || typeof m.id !== "string") return;
        const color =
          (view as any).playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#c4724e";
        echoRenderer.setEcho(pid, m.text, color);
      });
    });
    cleanups.push(unsubEcho);
    cleanups.push(() => echoRenderer.destroy());
  }

  // Broadcast navigatingTo on Wikipedia article link clicks.
  // Only delay navigation when someone is following — solo users get instant clicks.
  const onClick = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!link || !link.href || link.target === "_blank") return;

    try {
      const url = new URL(link.href);
      if (url.origin !== location.origin) return;
      if (!isWikiArticleUrl(url.href)) return;

      if (followManager.hasFollowers()) {
        // Delay navigation so followers see the navigatingTo awareness update
        e.preventDefault();
        deps.presence.setMyPresence("navigatingTo", {
          url: url.href,
          title: link.textContent?.trim().slice(0, 100) ?? url.pathname,
        });
        setTimeout(() => {
          window.location.href = url.href;
        }, 200);
      }
    } catch { /* ignore invalid URLs */ }
  };
  document.addEventListener("click", onClick, { capture: true });
  cleanups.push(() => document.removeEventListener("click", onClick, { capture: true }));

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
