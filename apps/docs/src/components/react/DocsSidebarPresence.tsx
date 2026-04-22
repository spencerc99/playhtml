import { useEffect, useRef, useState } from 'react';
import { playhtml } from '@playhtml/react';
import type { CursorPresenceView } from '@playhtml/common';

// Cross-page reader presence for the Starlight sidebar.
//
// When another reader is sitting on a docs page we aren't currently viewing,
// we surface their cursor color as a small ambient pip floating in the
// RIGHT margin of the matching sidebar link. This gives the sidebar a
// subtle "who's where" dimension without introducing a second UI chrome,
// and — critically — without shifting the link text horizontally. Earlier
// iterations injected pips to the LEFT of the label, which read as
// interruptive because the text would jump as readers came and went.
// Anchoring to the right edge with absolute positioning means pip
// presence/absence never reflows the link content; the sidebar label
// stays exactly where the eye expects it.
//
// Rendering strategy:
//
// - The island renders NO visible React children (returns null). All of the
//   DOM it touches lives inside Starlight's sidebar, which is server-
//   rendered markup. We find each <a> whose normalized href matches a
//   page where somebody is currently present, then inject / update a
//   managed <span class="ph-sidebar-pip-stack"> as the LAST child of the
//   link. CSS positions the stack absolutely against the link's right
//   edge, so it floats above the link's right padding and never
//   participates in the text layout.
//
// - Normalization rules match `pageSlug` in enhance-code-blocks.ts: we
//   strip the "/docs" base path, drop trailing slashes, and lowercase.
//   So "/docs/", "/docs", "", "/" all collapse to "/" — the getting-
//   started index — and "/docs/data/events/" collapses to "/data/events".
//
// - The pip stack caps at 3 dots. Past that, we append a "+N" badge so
//   the sidebar doesn't explode when many readers cluster on one page.
//
// - The island must not paint pips on the link the READER is currently
//   viewing, because Starlight already marks it via aria-current. Doubling
//   up creates visual noise on the one row that doesn't need it.
//
// - A MutationObserver on the sidebar DOM catches navigations (Starlight
//   doesn't SPA-navigate, but theme toggles / viewport changes do rewrite
//   the sidebar); we re-decorate whenever the observer fires.

// Shared cap for the number of discrete dots before we fall back to +N.
const MAX_DOTS = 3;

function normalizePath(p: string | undefined | null): string | null {
  if (!p) return null;
  try {
    // Handle absolute URLs (cursor presences sometimes carry a full href
    // when the reader navigated via a raw <a>); pull out the pathname.
    const parsed =
      p.startsWith('http://') || p.startsWith('https://')
        ? new URL(p).pathname
        : p;
    let path = parsed.replace(/\/+$/, '');
    path = path.replace(/^\/docs/, '');
    if (!path) path = '/';
    return path.toLowerCase();
  } catch {
    return null;
  }
}

function sidebarLinks(): HTMLAnchorElement[] {
  // Starlight's sidebar links live inside the `sidebar-pane` region. Scope
  // the query to that container so we don't accidentally decorate header /
  // footer links that happen to share an href.
  const pane =
    document.querySelector<HTMLElement>('.sidebar-pane') ||
    document.querySelector<HTMLElement>('nav.sidebar');
  if (!pane) return [];
  return Array.from(pane.querySelectorAll<HTMLAnchorElement>('a[href]'));
}

function ensurePipStack(link: HTMLAnchorElement): HTMLElement {
  // Managed pip-stack is appended as the link's LAST child. CSS pulls it
  // out of normal flow with `position: absolute` and pins it to the
  // link's right edge, so adding/removing the stack never reflows the
  // label text. Order in the DOM only matters for the absolute fallback
  // case where positioning is somehow disabled — we'd rather pips
  // appear at the end of the line than disrupt the leading text.
  let stack = link.querySelector<HTMLElement>(':scope > .ph-sidebar-pip-stack');
  if (!stack) {
    stack = document.createElement('span');
    stack.className = 'ph-sidebar-pip-stack';
    stack.setAttribute('aria-hidden', 'true');
    link.appendChild(stack);
  }
  return stack;
}

function renderPipStack(stack: HTMLElement, colors: string[]): void {
  // Only rebuild when something actually changed — reusing the existing
  // DOM keeps CSS transitions intact and avoids churn when awareness
  // updates arrive at 10 Hz.
  const signature = colors.join('|');
  if (stack.dataset.phSig === signature) return;
  stack.dataset.phSig = signature;
  stack.innerHTML = '';

  const shown = colors.slice(0, MAX_DOTS);
  shown.forEach((c) => {
    const pip = document.createElement('span');
    pip.className = 'ph-sidebar-pip';
    pip.style.backgroundColor = c;
    stack.appendChild(pip);
  });
  const extra = colors.length - shown.length;
  if (extra > 0) {
    const badge = document.createElement('span');
    badge.className = 'ph-sidebar-pip-more';
    badge.textContent = `+${extra}`;
    stack.appendChild(badge);
  }
}

function clearPipStack(link: HTMLAnchorElement): void {
  const stack = link.querySelector(':scope > .ph-sidebar-pip-stack');
  if (stack) stack.remove();
}

export function DocsSidebarPresence(): null {
  const [presences, setPresences] = useState<Map<string, CursorPresenceView>>(
    () => new Map(),
  );

  // Subscribe to cursor presence changes — same pattern as DocsPresenceBar.
  // We cache the wiring attempt and retry on an interval so the island is
  // robust against the cursor client being created after the island hydrates.
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    const wire = () => {
      const client = (playhtml as any).cursorClient;
      if (!client) return false;
      setPresences(client.getCursorPresences());
      unsub = client.onCursorPresencesChange(
        (next: Map<string, CursorPresenceView>) => {
          if (cancelled) return;
          setPresences(new Map(next));
        },
      );
      return true;
    };
    if (!wire()) {
      const interval = window.setInterval(() => {
        if (wire()) window.clearInterval(interval);
      }, 250);
      return () => {
        cancelled = true;
        window.clearInterval(interval);
        unsub?.();
      };
    }
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // Track which links we've currently decorated so we can clean up when
  // readers leave (their color no longer appears in the `byPage` map).
  const decoratedRef = useRef<Set<HTMLAnchorElement>>(new Set());

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Group presences by normalized pathname. Skip the reader's own page —
    // Starlight already marks it as aria-current and stacking a pip there
    // would just be noise.
    const ownPath = normalizePath(window.location.pathname);
    const byPage = new Map<string, string[]>();
    presences.forEach((p) => {
      const normalized = normalizePath(p.page);
      if (!normalized) return;
      if (normalized === ownPath) return;
      const color = p.playerIdentity?.playerStyle?.colorPalette?.[0];
      if (!color) return;
      const arr = byPage.get(normalized) ?? [];
      arr.push(color);
      byPage.set(normalized, arr);
    });

    const links = sidebarLinks();
    const touched = new Set<HTMLAnchorElement>();

    links.forEach((link) => {
      const normalized = normalizePath(
        link.getAttribute('href') ?? link.pathname,
      );
      if (!normalized) return;
      const colors = byPage.get(normalized);
      if (colors && colors.length > 0) {
        const stack = ensurePipStack(link);
        renderPipStack(stack, colors);
        touched.add(link);
      } else {
        clearPipStack(link);
      }
    });

    // Clean up decorations on links we no longer touch (e.g. the last
    // reader on some page left; byPage has no entry for it any more).
    decoratedRef.current.forEach((link) => {
      if (!touched.has(link) && link.isConnected) clearPipStack(link);
    });
    decoratedRef.current = touched;
  }, [presences]);

  return null;
}
// Note: we intentionally do NOT install a MutationObserver on the sidebar.
// Our decoration path mutates the sidebar (adding/removing pip stacks), so
// an observer would feedback-loop its own writes. Starlight performs a full
// page load on each link click (no SPA navigation) in this config, so the
// sidebar markup is stable per page load — re-running the effect on
// `presences` changes is sufficient.
