import type { PlayHTMLComponents } from "./index";
import { normalizePath } from "@playhtml/common";

// ─── SVG Icons (inline, no dependencies) ───────────────────────────────
const ICONS = {
  logo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  inspect: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12l-8 -8v6h-4v-12h12v-4l8 8"/><path d="M12 12l8 8v-6h4v12h-12v4l-8 -8" transform="translate(0,0)"/></svg>`,
  elements: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  state: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/></svg>`,
  connection: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  crosshair: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
};

// ─── CSS (injected once into the document) ─────────────────────────────
const DEV_STYLES = `
#playhtml-dev-root {
  --ph-bg: rgba(15, 15, 15, 0.95);
  --ph-bg-hover: rgba(255, 255, 255, 0.08);
  --ph-bg-active: rgba(255, 255, 255, 0.14);
  --ph-border: rgba(255, 255, 255, 0.1);
  --ph-text: #e4e4e7;
  --ph-text-muted: #a1a1aa;
  --ph-accent: #a78bfa;
  --ph-accent-hover: #c4b5fd;
  --ph-danger: #f87171;
  --ph-success: #4ade80;
  --ph-info: #60a5fa;
  --ph-radius: 12px;
  --ph-radius-sm: 8px;
  --ph-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --ph-font-mono: "SF Mono", SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;

  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100000;
  font-family: var(--ph-font);
  font-size: 13px;
  line-height: 1.4;
  color: var(--ph-text);
  pointer-events: auto;
}

/* ── Trigger button (collapsed state) ── */
.ph-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--ph-bg);
  border: 1px solid var(--ph-border);
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  color: var(--ph-accent);
  padding: 0;
  margin: 0 auto;
}
.ph-trigger:hover {
  background: var(--ph-bg-hover);
  border-color: var(--ph-accent);
  transform: scale(1.08);
  box-shadow: 0 4px 32px rgba(167, 139, 250, 0.2);
}
.ph-trigger svg {
  width: 18px;
  height: 18px;
}

/* ── Toolbar (expanded state) ── */
.ph-toolbar {
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 0;
}
.ph-toolbar.ph-open {
  display: flex;
}

.ph-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px;
  background: var(--ph-bg);
  border: 1px solid var(--ph-border);
  border-radius: 50px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.ph-bar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--ph-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
  position: relative;
}
.ph-bar-btn svg {
  width: 16px;
  height: 16px;
}
.ph-bar-btn:hover {
  background: var(--ph-bg-hover);
  color: var(--ph-text);
}
.ph-bar-btn.ph-active {
  background: var(--ph-bg-active);
  color: var(--ph-accent);
}
.ph-bar-btn.ph-danger-btn:hover {
  color: var(--ph-danger);
  background: rgba(248, 113, 113, 0.1);
}

.ph-bar-divider {
  width: 1px;
  height: 20px;
  background: var(--ph-border);
  margin: 0 4px;
}

.ph-bar-btn .ph-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  background: var(--ph-bg);
  border: 1px solid var(--ph-border);
  border-radius: 6px;
  font-size: 11px;
  white-space: nowrap;
  color: var(--ph-text);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.ph-bar-btn:hover .ph-tooltip {
  opacity: 1;
}

/* notification dot on icon button */
.ph-bar-btn .ph-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ph-accent);
}

/* ── Panel (slides up above toolbar) ── */
.ph-panel {
  display: none;
  width: 360px;
  max-height: 340px;
  margin-bottom: 8px;
  background: var(--ph-bg);
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius);
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  animation: ph-slide-up 0.15s ease;
}
.ph-panel.ph-panel-open {
  display: block;
}

@keyframes ph-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.ph-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--ph-border);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ph-text-muted);
}
.ph-panel-header-actions {
  display: flex;
  gap: 4px;
}
.ph-panel-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--ph-text-muted);
  cursor: pointer;
  padding: 0;
}
.ph-panel-header-btn:hover {
  background: var(--ph-bg-hover);
  color: var(--ph-text);
}
.ph-panel-header-btn svg {
  width: 14px;
  height: 14px;
}
.ph-panel-body {
  padding: 10px 14px;
  overflow-y: auto;
  max-height: 280px;
}
.ph-panel-body::-webkit-scrollbar {
  width: 4px;
}
.ph-panel-body::-webkit-scrollbar-thumb {
  background: var(--ph-border);
  border-radius: 4px;
}

/* ── Element rows ── */
.ph-el-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--ph-radius-sm);
  cursor: pointer;
  transition: background 0.1s;
}
.ph-el-row:hover {
  background: var(--ph-bg-hover);
}
.ph-el-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}
.ph-el-badge.ph-badge-src {
  background: rgba(74, 222, 128, 0.15);
  color: var(--ph-success);
}
.ph-el-badge.ph-badge-ref {
  background: rgba(96, 165, 250, 0.15);
  color: var(--ph-info);
}
.ph-el-id {
  font-family: var(--ph-font-mono);
  font-size: 12px;
  color: var(--ph-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ph-el-path {
  font-size: 11px;
  color: var(--ph-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Info rows (connection panel) ── */
.ph-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--ph-radius-sm);
  margin-bottom: 4px;
  background: rgba(255,255,255,0.03);
}
.ph-info-label {
  font-size: 11px;
  color: var(--ph-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
.ph-info-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--ph-font-mono);
  font-size: 12px;
  color: var(--ph-text);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ph-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--ph-text-muted);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
}
.ph-copy-btn:hover {
  background: var(--ph-bg-hover);
  color: var(--ph-text);
}
.ph-copy-btn svg {
  width: 12px;
  height: 12px;
}

/* ── State panel ── */
.ph-state-entry {
  padding: 6px 8px;
  border-radius: var(--ph-radius-sm);
  margin-bottom: 4px;
  cursor: pointer;
  transition: background 0.1s;
}
.ph-state-entry:hover {
  background: var(--ph-bg-hover);
}
.ph-state-tag {
  font-size: 11px;
  color: var(--ph-accent);
  font-weight: 600;
  margin-bottom: 2px;
}
.ph-state-ids {
  font-family: var(--ph-font-mono);
  font-size: 11px;
  color: var(--ph-text-muted);
}

/* ── Empty state ── */
.ph-empty {
  text-align: center;
  padding: 20px;
  color: var(--ph-text-muted);
  font-size: 12px;
}

/* ── Danger action ── */
.ph-danger-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px;
  margin-top: 8px;
  border: 1px solid rgba(248, 113, 113, 0.2);
  border-radius: var(--ph-radius-sm);
  background: rgba(248, 113, 113, 0.06);
  color: var(--ph-danger);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.ph-danger-action:hover {
  background: rgba(248, 113, 113, 0.12);
  border-color: rgba(248, 113, 113, 0.35);
}
.ph-danger-action svg {
  width: 14px;
  height: 14px;
}

/* ── Inspect mode overlay ── */
.ph-inspect-overlay {
  position: fixed;
  pointer-events: none;
  border: 2px solid var(--ph-accent, #a78bfa);
  background: rgba(167, 139, 250, 0.08);
  border-radius: 4px;
  z-index: 99999;
  display: none;
  transition: all 0.05s ease;
}
.ph-inspect-label {
  position: fixed;
  z-index: 100000;
  display: none;
  padding: 3px 8px;
  background: var(--ph-accent, #a78bfa);
  color: #fff;
  font-family: var(--ph-font-mono, monospace);
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
`;

// ─── Shared Elements Listing ───────────────────────────────────────────
export function listSharedElements() {
  const out: Array<{
    type: "source" | "consumer";
    elementId: string;
    dataSource: string;
    normalized: string;
    permissions?: "read-only" | "read-write";
    element: HTMLElement;
  }> = [];

  document.querySelectorAll("[shared]").forEach((el) => {
    const element = el as HTMLElement;
    const id = element.id;
    if (!id) return;
    const ds = `${window.location.host}${normalizePath(
      window.location.pathname
    )}#${id}`;
    out.push({
      type: "source",
      elementId: id,
      dataSource: ds,
      normalized: ds,
      permissions: element.getAttribute("shared")?.includes("read-only")
        ? "read-only"
        : "read-write",
      element,
    });
  });

  document.querySelectorAll("[data-source]").forEach((el) => {
    const element = el as HTMLElement;
    const raw = element.getAttribute("data-source") || "";
    const [domainAndPath, elementId] = raw.split("#");
    if (!domainAndPath || !elementId) return;
    const firstSlash = domainAndPath.indexOf("/");
    const domain =
      firstSlash === -1 ? domainAndPath : domainAndPath.slice(0, firstSlash);
    const path = firstSlash === -1 ? "/" : domainAndPath.slice(firstSlash);
    const normalized = `${domain}${normalizePath(path)}#${elementId}`;
    out.push({
      type: "consumer",
      elementId,
      dataSource: raw,
      normalized,
      element,
    });
  });

  try {
    console.table(
      out.map((e) => ({
        type: e.type,
        elementId: e.elementId,
        dataSource: e.dataSource,
        normalized: e.normalized,
        permissions: e.permissions || "",
      }))
    );
  } catch {}
  return out;
}

// ─── Helper: create element with classes ───────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classes?: string,
  attrs?: Record<string, string>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classes) e.className = classes;
  if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

// ─── Main Setup ────────────────────────────────────────────────────────
export function setupDevUI(playhtml: PlayHTMLComponents) {
  const { syncedStore: store, elementHandlers } = playhtml;

  // Inject styles
  const styleEl = document.createElement("style");
  styleEl.textContent = DEV_STYLES;
  document.head.appendChild(styleEl);

  // Create root
  const root = el("div");
  root.id = "playhtml-dev-root";

  // ── Inspection overlay elements ──
  const inspectOverlay = el("div", "ph-inspect-overlay");
  const inspectLabel = el("div", "ph-inspect-label");
  document.body.appendChild(inspectOverlay);
  document.body.appendChild(inspectLabel);

  // ── State ──
  let isOpen = false;
  let activePanel: string | null = null;
  let inspectMode = false;

  // ── Trigger (collapsed) ──
  const trigger = el("button", "ph-trigger");
  trigger.innerHTML = ICONS.logo;
  trigger.title = "playhtml dev tools";

  // ── Toolbar (expanded) ──
  const toolbar = el("div", "ph-toolbar");

  // ── Panel container ──
  const panelContainer = el("div");

  // Panels map
  const panels: Record<string, HTMLElement> = {};

  function createPanel(id: string, title: string, headerActions?: HTMLElement[]): { panel: HTMLElement; body: HTMLElement } {
    const panel = el("div", "ph-panel");
    panel.dataset.panelId = id;

    const header = el("div", "ph-panel-header");
    const titleSpan = document.createElement("span");
    titleSpan.textContent = title;
    header.appendChild(titleSpan);

    if (headerActions && headerActions.length > 0) {
      const actions = el("div", "ph-panel-header-actions");
      headerActions.forEach((a) => actions.appendChild(a));
      header.appendChild(actions);
    }

    const body = el("div", "ph-panel-body");
    panel.appendChild(header);
    panel.appendChild(body);
    panels[id] = panel;
    panelContainer.appendChild(panel);
    return { panel, body };
  }

  function togglePanel(id: string) {
    if (activePanel === id) {
      panels[id].classList.remove("ph-panel-open");
      activePanel = null;
      // Deactivate button
      barButtons.forEach((b) => b.classList.remove("ph-active"));
    } else {
      // Close previous
      if (activePanel && panels[activePanel]) {
        panels[activePanel].classList.remove("ph-panel-open");
      }
      panels[id].classList.add("ph-panel-open");
      activePanel = id;
      // Update active button
      barButtons.forEach((b) => {
        b.classList.toggle("ph-active", b.dataset.panel === id);
      });
    }
  }

  function closeAllPanels() {
    Object.values(panels).forEach((p) => p.classList.remove("ph-panel-open"));
    activePanel = null;
    barButtons.forEach((b) => b.classList.remove("ph-active"));
  }

  // ── Bar buttons ──
  const barButtons: HTMLButtonElement[] = [];

  function makeBarBtn(
    iconSvg: string,
    tooltip: string,
    panelId?: string,
    onClick?: () => void
  ): HTMLButtonElement {
    const btn = el("button", "ph-bar-btn");
    btn.innerHTML = iconSvg;
    if (panelId) btn.dataset.panel = panelId;

    const tip = el("span", "ph-tooltip");
    tip.textContent = tooltip;
    btn.appendChild(tip);

    btn.onclick = (e) => {
      e.stopPropagation();
      if (panelId) togglePanel(panelId);
      if (onClick) onClick();
    };
    barButtons.push(btn);
    return btn;
  }

  // ── 1. Inspect button ──
  const inspectBtn = makeBarBtn(ICONS.crosshair, "Inspect", undefined, () => {
    inspectMode = !inspectMode;
    inspectBtn.classList.toggle("ph-active", inspectMode);
    document.body.style.cursor = inspectMode ? "crosshair" : "";
    if (!inspectMode) {
      inspectOverlay.style.display = "none";
      inspectLabel.style.display = "none";
    }
  });

  // ── 2. Elements panel ──
  const refreshElementsBtn = el("button", "ph-panel-header-btn");
  refreshElementsBtn.innerHTML = ICONS.refresh;
  refreshElementsBtn.title = "Refresh";
  const { body: elementsBody } = createPanel("elements", "Elements", [refreshElementsBtn]);

  function renderElements() {
    elementsBody.innerHTML = "";

    // playhtml elements
    const playElements = document.querySelectorAll("[class*='__playhtml-']");
    const sharedItems = listSharedElements();

    if (playElements.length === 0 && sharedItems.length === 0) {
      const empty = el("div", "ph-empty");
      empty.textContent = "No playhtml elements found";
      elementsBody.appendChild(empty);
      return;
    }

    // playhtml capability elements
    const seen = new Set<string>();
    playElements.forEach((pEl) => {
      const htmlEl = pEl as HTMLElement;
      const id = htmlEl.id;
      if (!id || seen.has(id)) return;
      seen.add(id);

      const tagType = Array.from(htmlEl.classList)
        .find((cls) => cls.startsWith("__playhtml-"))
        ?.replace("__playhtml-", "");

      const row = el("div", "ph-el-row");

      const badge = el("span", "ph-el-badge ph-badge-src");
      badge.textContent = tagType || "play";
      badge.style.background = "rgba(167, 139, 250, 0.15)";
      badge.style.color = "var(--ph-accent)";

      const info = el("div");
      const idLine = el("div", "ph-el-id");
      idLine.textContent = `#${id}`;
      info.appendChild(idLine);

      row.appendChild(badge);
      row.appendChild(info);

      row.onmouseenter = () => highlightEl(htmlEl);
      row.onmouseleave = () => hideHighlight();
      row.onclick = () => htmlEl.scrollIntoView({ behavior: "smooth", block: "center" });

      elementsBody.appendChild(row);
    });

    // Shared elements section
    if (sharedItems.length > 0) {
      const divider = el("div");
      divider.style.borderTop = "1px solid var(--ph-border)";
      divider.style.margin = "8px 0";
      elementsBody.appendChild(divider);

      const sectionLabel = el("div");
      sectionLabel.textContent = "Shared Elements";
      sectionLabel.style.fontSize = "11px";
      sectionLabel.style.color = "var(--ph-text-muted)";
      sectionLabel.style.textTransform = "uppercase";
      sectionLabel.style.letterSpacing = "0.5px";
      sectionLabel.style.fontWeight = "600";
      sectionLabel.style.marginBottom = "6px";
      elementsBody.appendChild(sectionLabel);

      sharedItems.forEach((item) => {
        const row = el("div", "ph-el-row");

        const badge = el("span", `ph-el-badge ${item.type === "source" ? "ph-badge-src" : "ph-badge-ref"}`);
        badge.textContent = item.type === "source" ? "SRC" : "REF";

        const info = el("div");
        info.style.overflow = "hidden";
        const idLine = el("div", "ph-el-id");
        idLine.textContent = `#${item.elementId}`;
        const pathLine = el("div", "ph-el-path");
        pathLine.textContent = item.normalized;
        info.appendChild(idLine);
        info.appendChild(pathLine);

        row.appendChild(badge);
        row.appendChild(info);

        row.onmouseenter = () => highlightEl(item.element);
        row.onmouseleave = () => hideHighlight();
        row.onclick = () => item.element.scrollIntoView({ behavior: "smooth", block: "center" });

        elementsBody.appendChild(row);
      });
    }
  }

  refreshElementsBtn.onclick = () => renderElements();
  const elementsBtn = makeBarBtn(ICONS.elements, "Elements", "elements", () => {
    if (activePanel === "elements") renderElements();
  });

  // ── 3. State panel ──
  const { body: stateBody } = createPanel("state", "Synced State");

  function renderState() {
    stateBody.innerHTML = "";

    const tags = Object.keys(store);
    if (tags.length === 0) {
      const empty = el("div", "ph-empty");
      empty.textContent = "No synced state";
      stateBody.appendChild(empty);
      return;
    }

    let totalElements = 0;
    tags.forEach((tag) => {
      const tagData = store[tag];
      if (!tagData) return;
      const ids = Object.keys(tagData);
      if (ids.length === 0) return;
      totalElements += ids.length;

      const entry = el("div", "ph-state-entry");
      const tagLabel = el("div", "ph-state-tag");
      tagLabel.textContent = tag;
      const idsLabel = el("div", "ph-state-ids");
      idsLabel.textContent = ids.join(", ");
      entry.appendChild(tagLabel);
      entry.appendChild(idsLabel);

      entry.onclick = () => {
        const data: Record<string, any> = {};
        ids.forEach((id) => {
          const handler = elementHandlers.get(tag)?.get(id);
          data[id] = handler?.__data ?? tagData[id];
        });
        console.log(`[playhtml] State for "${tag}":`, data);
      };

      stateBody.appendChild(entry);
    });

    // Reset action at bottom
    const resetBtn = el("button", "ph-danger-action");
    resetBtn.innerHTML = `${ICONS.trash} Reset all data`;
    resetBtn.onclick = () => {
      const ids: string[] = [];
      Object.keys(store).forEach((tag) => {
        const tagData = store[tag];
        if (tagData) ids.push(...Object.keys(tagData));
      });
      const warning = ids.length
        ? `Reset ${ids.length} element(s)?\n\n${ids.join(", ")}`
        : "No elements to clear.";
      if (!window.confirm(warning)) return;
      Object.keys(store).forEach((tag) => {
        const tagData = store[tag];
        if (tagData) {
          Object.keys(tagData).forEach((elementId) => {
            delete tagData[elementId];
          });
        }
      });
      renderState();
    };
    stateBody.appendChild(resetBtn);
  }

  const stateBtn = makeBarBtn(ICONS.state, "State", "state", () => {
    if (activePanel === "state") renderState();
  });

  // ── 4. Connection panel ──
  const { body: connBody } = createPanel("connection", "Connection");

  function renderConnection() {
    connBody.innerHTML = "";

    const decodedRoom = (() => {
      try { return decodeURIComponent(playhtml.roomId); } catch { return playhtml.roomId; }
    })();

    const items = [
      { label: "Room", value: decodedRoom },
      { label: "Host", value: playhtml.host },
      { label: "Page", value: window.location.pathname },
    ];

    items.forEach(({ label, value }) => {
      const row = el("div", "ph-info-row");

      const lbl = el("span", "ph-info-label");
      lbl.textContent = label;

      const val = el("span", "ph-info-value");
      const valText = document.createElement("span");
      valText.textContent = value;
      valText.style.overflow = "hidden";
      valText.style.textOverflow = "ellipsis";
      val.appendChild(valText);

      const copyBtn = el("button", "ph-copy-btn");
      copyBtn.innerHTML = ICONS.copy;
      copyBtn.title = "Copy";
      copyBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          copyBtn.style.color = "var(--ph-success)";
          setTimeout(() => (copyBtn.style.color = ""), 600);
        } catch {}
      };
      val.appendChild(copyBtn);

      row.appendChild(lbl);
      row.appendChild(val);
      connBody.appendChild(row);
    });
  }

  const connBtn = makeBarBtn(ICONS.connection, "Connection", "connection", () => {
    if (activePanel === "connection") renderConnection();
  });

  // ── 5. Close button ──
  const closeBtn = el("button", "ph-bar-btn");
  closeBtn.innerHTML = ICONS.close;
  const closeTip = el("span", "ph-tooltip");
  closeTip.textContent = "Minimize";
  closeBtn.appendChild(closeTip);
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    close();
  };

  // ── Assemble bar ──
  const bar = el("div", "ph-bar");
  const divider1 = el("div", "ph-bar-divider");
  const divider2 = el("div", "ph-bar-divider");

  bar.appendChild(inspectBtn);
  bar.appendChild(elementsBtn);
  bar.appendChild(stateBtn);
  bar.appendChild(divider1);
  bar.appendChild(connBtn);
  bar.appendChild(divider2);
  bar.appendChild(closeBtn);

  toolbar.appendChild(panelContainer);
  toolbar.appendChild(bar);

  root.appendChild(trigger);
  root.appendChild(toolbar);
  document.body.appendChild(root);

  // ── Open / Close ──
  function open() {
    isOpen = true;
    trigger.style.display = "none";
    toolbar.classList.add("ph-open");
    renderElements();
    renderState();
    renderConnection();
  }

  function close() {
    isOpen = false;
    toolbar.classList.remove("ph-open");
    closeAllPanels();
    trigger.style.display = "";
    // Exit inspect mode
    if (inspectMode) {
      inspectMode = false;
      inspectBtn.classList.remove("ph-active");
      document.body.style.cursor = "";
      inspectOverlay.style.display = "none";
      inspectLabel.style.display = "none";
    }
  }

  trigger.onclick = () => open();

  // ── Highlight helpers ──
  function highlightEl(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    inspectOverlay.style.display = "block";
    inspectOverlay.style.left = `${rect.left - 2}px`;
    inspectOverlay.style.top = `${rect.top - 2}px`;
    inspectOverlay.style.width = `${rect.width + 4}px`;
    inspectOverlay.style.height = `${rect.height + 4}px`;
    inspectLabel.style.display = "block";
    inspectLabel.style.left = `${rect.left}px`;
    inspectLabel.style.top = `${Math.max(0, rect.top - 26)}px`;
    inspectLabel.textContent = `#${element.id}`;
  }

  function hideHighlight() {
    inspectOverlay.style.display = "none";
    inspectLabel.style.display = "none";
  }

  // ── Inspect mode event listeners ──
  document.addEventListener("mousemove", (event) => {
    if (!inspectMode) return;

    const target = event.target as HTMLElement;
    const playElement = target.closest("[class*='__playhtml-']");

    if (playElement && playElement instanceof HTMLElement) {
      highlightEl(playElement);
    } else {
      hideHighlight();
    }
  });

  document.addEventListener("click", (event) => {
    if (!inspectMode) return;

    const target = event.target as HTMLElement;
    // Don't capture clicks on the dev UI itself
    if (target.closest("#playhtml-dev-root")) return;

    const playElement = target.closest("[class*='__playhtml-']");

    if (playElement && playElement instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();

      const elementId = playElement.id;
      const tagType = Array.from(playElement.classList)
        .find((cls) => cls.startsWith("__playhtml-"))
        ?.replace("__playhtml-", "");

      if (tagType && elementHandlers.has(tagType)) {
        const handler = elementHandlers.get(tagType)!.get(elementId);
        if (handler) {
          console.log(
            `[playhtml] #${elementId} (${tagType}):`,
            handler.__data
          );
        } else {
          console.log(`[playhtml] No handler for #${elementId} (${tagType})`);
        }
      } else {
        console.log(`[playhtml] Element #${elementId} — no data found`);
      }
    }
  });

  // ── Close panel on outside click ──
  document.addEventListener("click", (event) => {
    if (!isOpen) return;
    const target = event.target as HTMLElement;
    if (!target.closest("#playhtml-dev-root")) {
      closeAllPanels();
    }
  });
}
