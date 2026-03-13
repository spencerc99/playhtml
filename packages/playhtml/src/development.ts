// ABOUTME: Dev tools UI for playhtml — bottom bar with element inspector, data tree, and connection status.
// ABOUTME: Renders a RollerCoaster Tycoon-inspired toolbar with warm colors, beveled edges, and no rounded corners.

import type { PlayHTMLComponents } from "./index";
import { normalizePath } from "@playhtml/common";

// ─── Logo ────────────────────────────────────────────────────────────────
const LOGO_URL = "https://playhtml.fun/icon.png";

// ─── SVG Icons (inline, no dependencies) ───────────────────────────────
const ICONS = {
  inspect: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  minimize: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>`,
};

// ─── Badge colors per tag type ─────────────────────────────────────────
const BADGE_COLORS: Record<string, string> = {
  "can-move": "#4a9a8a",
  "can-spin": "#5b8db8",
  "can-toggle": "#c4724e",
  "can-grow": "#d4b85c",
  "can-duplicate": "#8a6abf",
  "can-mirror": "#4a9a8a",
  "can-play": "#3d3833",
  "can-hover": "#5b8db8",
};
const BADGE_FALLBACK = "#8a8279";

// ─── CSS (injected once into the document) ─────────────────────────────
const DEV_STYLES = `
#playhtml-dev-root {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100000;
  font-family: 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px;
  line-height: 1.4;
  color: #3d3833;
  pointer-events: none;
}
#playhtml-dev-root * {
  box-sizing: border-box;
}
.ph-trigger {
  pointer-events: auto;
  position: fixed;
  bottom: 0;
  width: 48px;
  height: 120px;
  background: #e8e0d4;
  border: 2px solid;
  border-color: #f5f0e8 #8a8279 #8a8279 #f5f0e8;
  border-bottom: none;
  padding: 6px 6px 4px;
  cursor: grab;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: 100000;
}
.ph-trigger:hover {
  background: #f5f0e8;
}
.ph-trigger.ph-dragging {
  cursor: grabbing;
}
.ph-trigger img {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  filter: drop-shadow(0 0 4px #5b8db8);
}
.ph-trigger-grip {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: center;
  opacity: 0.4;
  flex: 1;
}
.ph-trigger-grip span {
  display: block;
  width: 16px;
  height: 2px;
  background: #8a8279;
}
.ph-bar {
  pointer-events: auto;
  display: none;
  flex-direction: column;
  background: #e8e0d4;
  border-top: 3px solid #3d3833;
  height: 220px;
}
.ph-bar.ph-open {
  display: flex;
}
.ph-bar-main {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.ph-toolbar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  background: linear-gradient(180deg, #ede6da 0%, #d4cfc7 100%);
  border-right: 2px solid #8a8279;
  flex-shrink: 0;
}
.ph-toolbar .ph-logo-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}
.ph-toolbar .ph-logo-btn img {
  width: 28px;
  height: 28px;
  filter: drop-shadow(0 0 4px #5b8db8);
}
.ph-toolbar .ph-divider {
  height: 1px;
  background: #8a8279;
  margin: 2px;
  opacity: 0.4;
}
.ph-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: #e8e0d4;
  border: 2px solid;
  border-color: #f5f0e8 #8a8279 #8a8279 #f5f0e8;
  cursor: pointer;
  color: #3d3833;
  padding: 0;
}
.ph-btn:hover {
  background: #f5f0e8;
}
.ph-btn.ph-active {
  border-color: #8a8279 #f5f0e8 #f5f0e8 #8a8279;
  background: #d4cfc7;
}
.ph-btn svg {
  width: 16px;
  height: 16px;
}
.ph-data {
  flex: 1;
  padding: 6px 10px;
  overflow-y: auto;
  background: #f5f0e8;
  font-size: 12px;
}
.ph-data::-webkit-scrollbar {
  width: 4px;
}
.ph-data::-webkit-scrollbar-thumb {
  background: #d4cfc7;
}
.ph-reset-btn {
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #c4724e;
  cursor: pointer;
  background: #e8e0d4;
  border: 2px solid;
  border-color: #f5f0e8 #8a8279 #8a8279 #f5f0e8;
  padding: 2px 8px;
}
.ph-reset-btn:hover {
  background: #f5f0e8;
}
.ph-reset-btn:active {
  border-color: #8a8279 #f5f0e8 #f5f0e8 #8a8279;
  background: #d4cfc7;
}
.ph-tree-item {
  padding: 3px 0 3px 14px;
  border-left: 1px solid #d4cfc7;
  font-family: 'Martian Mono', 'SF Mono', monospace;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ph-tree-item:hover {
  background: #faf7f2;
}
.ph-tree-toggle {
  color: #8a8279;
  font-size: 10px;
  width: 10px;
  flex-shrink: 0;
  text-align: center;
  user-select: none;
}
.ph-tree-key {
  color: #4a9a8a;
}
.ph-tree-value {
  color: #c4724e;
}
.ph-tree-badge {
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 9px;
  padding: 1px 5px;
  font-weight: 700;
  text-transform: uppercase;
  color: #faf7f2;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}
.ph-tree-el-name {
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 12px;
}
.ph-tree-reset {
  margin-left: auto;
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 10px;
  color: #c4724e;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
  background: none;
  border: none;
  padding: 0;
}
.ph-tree-item:hover > .ph-tree-reset {
  opacity: 1;
}
.ph-tree-children {
  display: none;
}
.ph-tree-children.ph-expanded {
  display: block;
}
.ph-tree-child {
  padding: 2px 0 2px 28px;
  font-family: 'Martian Mono', 'SF Mono', monospace;
  font-size: 11px;
  border-left: 1px solid #d4cfc7;
  margin-left: 14px;
}
.ph-resize-handle {
  height: 6px;
  cursor: ns-resize;
  background: #d4cfc7;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ph-resize-handle::after {
  content: '';
  width: 40px;
  height: 2px;
  background: #8a8279;
  opacity: 0.5;
}
.ph-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 10px;
  background: #d4cfc7;
  border-bottom: 1px solid #8a8279;
  font-family: 'Martian Mono', 'SF Mono', monospace;
  font-size: 12px;
  color: #6b6560;
  flex-shrink: 0;
}
.ph-status .ph-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ph-status .ph-dot.ph-connected {
  background: #4a9a8a;
}
.ph-status .ph-dot.ph-disconnected {
  background: #c4724e;
}
.ph-status .ph-sep {
  color: #b0a99e;
}
.ph-status .ph-minimize-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 20px;
  background: #e8e0d4;
  border: 2px solid;
  border-color: #f5f0e8 #8a8279 #8a8279 #f5f0e8;
  cursor: pointer;
  color: #3d3833;
  padding: 0;
}
.ph-status .ph-minimize-btn:hover {
  background: #f5f0e8;
}
.ph-status .ph-minimize-btn:active {
  border-color: #8a8279 #f5f0e8 #f5f0e8 #8a8279;
  background: #d4cfc7;
}
.ph-status .ph-minimize-btn svg {
  width: 12px;
  height: 12px;
}
.ph-status-field {
  position: relative;
  border: 1px solid #8a8279;
  padding: 2px 8px 2px 8px;
  margin: -2px 0;
  display: inline-flex;
  align-items: center;
}
.ph-status-field-label {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  background: #d4cfc7;
  padding: 0 4px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 700;
  color: #4a9a8a;
  line-height: 1;
  white-space: nowrap;
}
.ph-search-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  align-items: center;
}
.ph-search-input {
  flex: 1;
  padding: 3px 8px;
  font-family: 'Martian Mono', 'SF Mono', monospace;
  font-size: 11px;
  color: #3d3833;
  background: #faf7f2;
  border: 2px solid;
  border-color: #8a8279 #f5f0e8 #f5f0e8 #8a8279;
  outline: none;
}
.ph-search-input::placeholder {
  color: #b0a99e;
}
.ph-search-input:focus {
  border-color: #4a9a8a #d4cfc7 #d4cfc7 #4a9a8a;
}
.ph-tag-filter {
  padding: 3px 6px;
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 11px;
  color: #3d3833;
  background: #e8e0d4;
  border: 2px solid;
  border-color: #f5f0e8 #8a8279 #8a8279 #f5f0e8;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  padding-right: 18px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238a8279'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 5px center;
}
.ph-tag-filter:hover {
  background-color: #f5f0e8;
}
.ph-empty {
  text-align: center;
  padding: 20px;
  color: #8a8279;
  font-size: 12px;
  font-family: 'Atkinson Hyperlegible', sans-serif;
}
.ph-inspect-highlight {
  outline: 2px dashed #4a9a8a;
  outline-offset: 2px;
  position: relative;
}
.ph-inspect-highlight-hover {
  outline-color: #c4724e;
  box-shadow: 0 0 0 4px rgba(196, 114, 78, 0.15);
}
.ph-inspect-selected {
  outline: 2px solid #c4724e;
  outline-offset: 2px;
}
.ph-inspect-label {
  position: absolute;
  top: -18px;
  left: 0;
  background: #4a9a8a;
  color: #faf7f2;
  font-family: 'Martian Mono', monospace;
  font-size: 10px;
  padding: 2px 8px;
  pointer-events: none;
  z-index: 99999;
  white-space: nowrap;
}
.ph-inspect-tooltip {
  position: fixed;
  z-index: 100001;
  background: #3d3833;
  color: #faf7f2;
  border: 2px solid;
  border-color: #6b6560 #3d3833 #3d3833 #6b6560;
  padding: 6px 10px;
  font-family: 'Martian Mono', monospace;
  font-size: 12px;
  min-width: 180px;
  max-width: 300px;
  pointer-events: none;
  display: none;
}
.ph-inspect-tooltip .ph-tt-header {
  margin-bottom: 3px;
  display: flex;
  gap: 6px;
}
.ph-inspect-tooltip .ph-tt-type {
  color: #4a9a8a;
}
.ph-inspect-tooltip .ph-tt-id {
  color: #faf7f2;
}
.ph-inspect-tooltip .ph-tt-row {
  display: flex;
  gap: 4px;
}
.ph-inspect-tooltip .ph-tt-key {
  color: #8a8279;
}
.ph-inspect-tooltip .ph-tt-val {
  color: #c4724e;
}
@keyframes ph-flash {
  0% { outline: 3px solid #d4b85c; outline-offset: 2px; }
  100% { outline: 3px solid transparent; outline-offset: 2px; }
}
.ph-flash {
  animation: ph-flash 0.8s ease-out;
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
  const { elementHandlers } = playhtml;

  // Inject styles
  const styleEl = document.createElement("style");
  styleEl.textContent = DEV_STYLES;
  document.head.appendChild(styleEl);

  // ── State ──
  let inspectMode = false;
  let selectedElementId: string | null = null;
  let hoveredElement: HTMLElement | null = null;
  const inspectLabels: HTMLElement[] = [];

  // ── Root ──
  const root = el("div");
  root.id = "playhtml-dev-root";

  // ── Trigger tab ──
  const trigger = el("div", "ph-trigger");
  const triggerImg = el("img", undefined, {
    src: LOGO_URL,
    alt: "playhtml",
  });
  trigger.appendChild(triggerImg);

  // Grip lines below logo
  const grip = el("div", "ph-trigger-grip");
  for (let i = 0; i < 4; i++) {
    grip.appendChild(document.createElement("span"));
  }
  trigger.appendChild(grip);

  // Center trigger horizontally on mount
  let triggerLeft = window.innerWidth - 48 - 16;
  trigger.style.left = `${triggerLeft}px`;

  // ── Bottom bar ──
  const bar = el("div", "ph-bar");

  // Bar main area (toolbar + data)
  const barMain = el("div", "ph-bar-main");

  // Toolbar column
  const toolbar = el("div", "ph-toolbar");

  // Inspect button (top of toolbar)
  const inspectBtn = el("button", "ph-btn");
  inspectBtn.innerHTML = ICONS.inspect;
  inspectBtn.title = "Inspect";
  toolbar.appendChild(inspectBtn);

  // Spacer pushes logo to bottom
  const toolbarSpacer = el("div");
  toolbarSpacer.style.flex = "1";
  toolbar.appendChild(toolbarSpacer);

  // Logo at bottom of toolbar
  const logoBtn = el("div", "ph-logo-btn");
  const logoImg = el("img", undefined, {
    src: LOGO_URL,
    alt: "playhtml",
  });
  logoBtn.appendChild(logoImg);
  toolbar.appendChild(logoBtn);

  // Data area
  const dataArea = el("div", "ph-data");

  barMain.appendChild(toolbar);
  barMain.appendChild(dataArea);

  // Resize handle at very top of bar
  const resizeHandle = el("div", "ph-resize-handle");
  bar.appendChild(resizeHandle);

  // ── Status line ──
  const status = el("div", "ph-status");

  const dot = el("span", "ph-dot ph-connected");
  status.appendChild(dot);

  const connLabel = document.createTextNode("connected");
  status.appendChild(connLabel);

  const sepClients = el("span", "ph-sep");
  sepClients.textContent = "\u00B7";
  status.appendChild(sepClients);

  // Client count (updated on open)
  const clientCountNode = document.createTextNode("");
  status.appendChild(clientCountNode);

  const sep1 = el("span", "ph-sep");
  sep1.textContent = "\u00B7";
  status.appendChild(sep1);

  // Element count (updated on open)
  const elCountNode = document.createTextNode("");
  status.appendChild(elCountNode);

  function updateStatusCounts() {
    // Client count via awareness
    let clients = 1;
    try {
      const provider = playhtml.cursorClient?.getProvider();
      if (provider) {
        clients = provider.awareness.getStates().size;
      }
    } catch {}
    clientCountNode.textContent = `${clients} client${clients !== 1 ? "s" : ""}`;

    // Element count
    let total = 0;
    elementHandlers.forEach((idMap) => {
      total += idMap.size;
    });
    elCountNode.textContent = `${total} element${total !== 1 ? "s" : ""}`;
  }
  updateStatusCounts();

  const sep2 = el("span", "ph-sep");
  sep2.textContent = "\u00B7";
  status.appendChild(sep2);

  // Room field
  let decodedRoom: string;
  try {
    decodedRoom = decodeURIComponent(playhtml.roomId);
  } catch {
    decodedRoom = playhtml.roomId;
  }
  const roomField = el("span", "ph-status-field");
  const roomFieldLabel = el("span", "ph-status-field-label");
  roomFieldLabel.textContent = "room";
  roomField.appendChild(roomFieldLabel);
  roomField.appendChild(document.createTextNode(decodedRoom));
  status.appendChild(roomField);

  const sep3 = el("span", "ph-sep");
  sep3.textContent = "\u00B7";
  status.appendChild(sep3);

  // Host field
  const hostField = el("span", "ph-status-field");
  const hostFieldLabel = el("span", "ph-status-field-label");
  hostFieldLabel.textContent = "host";
  hostField.appendChild(hostFieldLabel);
  hostField.appendChild(document.createTextNode(playhtml.host));
  status.appendChild(hostField);

  // Minimize button
  const minimizeBtn = el("button", "ph-minimize-btn");
  minimizeBtn.innerHTML = ICONS.minimize;
  minimizeBtn.title = "Minimize";
  status.appendChild(minimizeBtn);

  // Status line above main content
  bar.appendChild(status);
  bar.appendChild(barMain);

  // ── Inspect tooltip (hidden, for later use) ──
  const inspectTooltip = el("div", "ph-inspect-tooltip");

  const ttHeader = el("div", "ph-tt-header");
  const ttType = el("span", "ph-tt-type");
  const ttId = el("span", "ph-tt-id");
  ttHeader.appendChild(ttType);
  ttHeader.appendChild(ttId);
  inspectTooltip.appendChild(ttHeader);

  // ── Assemble root ──
  root.appendChild(trigger);
  root.appendChild(bar);
  root.appendChild(inspectTooltip);
  document.body.appendChild(root);

  // ── Render data tree view ──
  const store = playhtml.syncedStore;
  let searchQuery = "";
  let tagFilter = "";

  function renderDataWalker() {
    dataArea.innerHTML = "";

    // Search + filter + actions bar (single row)
    const searchBar = el("div", "ph-search-bar");

    const searchInput = el("input", "ph-search-input");
    searchInput.type = "text";
    searchInput.placeholder = "Search by element ID...";
    searchInput.value = searchQuery;
    searchInput.oninput = () => {
      searchQuery = searchInput.value;
      renderDataWalker();
    };
    searchBar.appendChild(searchInput);

    // Collect all tag types for the filter dropdown
    const tagTypes = new Set<string>();
    elementHandlers.forEach((_idMap, tagType) => tagTypes.add(tagType));

    if (tagTypes.size > 1) {
      const filterSelect = el("select", "ph-tag-filter");
      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "All types";
      filterSelect.appendChild(allOption);
      tagTypes.forEach((tt) => {
        const opt = document.createElement("option");
        opt.value = tt;
        opt.textContent = tt;
        filterSelect.appendChild(opt);
      });
      filterSelect.value = tagFilter;
      filterSelect.onchange = () => {
        tagFilter = filterSelect.value;
        renderDataWalker();
      };
      searchBar.appendChild(filterSelect);
    }

    const refreshBtn = el("button", "ph-btn");
    refreshBtn.innerHTML = ICONS.refresh;
    refreshBtn.title = "Refresh";
    refreshBtn.style.width = "20px";
    refreshBtn.style.height = "20px";
    refreshBtn.onclick = () => renderDataWalker();
    searchBar.appendChild(refreshBtn);

    const resetAllBtn = el("button", "ph-reset-btn");
    resetAllBtn.textContent = "Reset All";
    resetAllBtn.onclick = () => {
      if (!window.confirm("Reset all playhtml element data?")) return;
      elementHandlers.forEach((_idMap, tagType) => {
        if (store[tagType]) {
          const keys = Object.keys(store[tagType]);
          for (const key of keys) {
            delete store[tagType][key];
          }
        }
      });
      renderDataWalker();
    };
    searchBar.appendChild(resetAllBtn);

    dataArea.appendChild(searchBar);

    // Restore focus to search input after re-render
    requestAnimationFrame(() => {
      if (searchQuery) {
        searchInput.focus();
        searchInput.setSelectionRange(searchQuery.length, searchQuery.length);
      }
    });

    // Check if there are any elements
    let hasElements = false;
    elementHandlers.forEach((idMap) => {
      if (idMap.size > 0) hasElements = true;
    });

    if (!hasElements) {
      const empty = el("div", "ph-empty");
      empty.textContent = "No playhtml elements found.";
      dataArea.appendChild(empty);
    } else {
      // Build tree for each tag type and element
      let matchCount = 0;
      elementHandlers.forEach((idMap, tagType) => {
        // Apply tag filter
        if (tagFilter && tagType !== tagFilter) return;

        idMap.forEach((handler, elementId) => {
          // Apply search filter
          if (searchQuery && !elementId.toLowerCase().includes(searchQuery.toLowerCase())) return;
          matchCount++;
          const row = el("div", "ph-tree-item");
          row.setAttribute("data-element-id", elementId);
          row.setAttribute("data-tag-type", tagType);

          // Toggle triangle
          const toggle = el("span", "ph-tree-toggle");
          toggle.textContent = "\u25B6";

          // Badge
          const badge = el("span", "ph-tree-badge");
          badge.textContent = tagType;
          badge.style.background = BADGE_COLORS[tagType] || BADGE_FALLBACK;

          // Element name
          const elName = el("span", "ph-tree-el-name");
          elName.textContent = `#${elementId}`;
          elName.title = "Click to scroll to element";
          elName.onclick = (e) => {
            e.stopPropagation();
            const target = document.getElementById(elementId);
            if (target) {
              target.scrollIntoView({ behavior: "smooth", block: "center" });
              target.classList.add("ph-flash");
              target.addEventListener(
                "animationend",
                () => target.classList.remove("ph-flash"),
                { once: true }
              );
            }
          };

          // Per-element reset
          const resetBtn = el("button", "ph-tree-reset");
          resetBtn.textContent = "reset";
          resetBtn.onclick = (e) => {
            e.stopPropagation();
            if (store[tagType]) {
              delete store[tagType][elementId];
            }
            renderDataWalker();
          };

          row.appendChild(toggle);
          row.appendChild(badge);
          row.appendChild(elName);
          row.appendChild(resetBtn);

          // Children container (key-value pairs)
          // TODO: make values editable inline (click to edit, enter to save back to store)
          // TODO: add per-key reset and per-nested-level reset (not just per-element)
          const children = el("div", "ph-tree-children");
          const data = handler.data;
          if (data && typeof data === "object") {
            for (const [key, value] of Object.entries(data)) {
              const child = el("div", "ph-tree-child");
              const keySpan = el("span", "ph-tree-key");
              keySpan.textContent = key + ": ";
              const valSpan = el("span", "ph-tree-value");
              valSpan.textContent =
                typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value);
              child.appendChild(keySpan);
              child.appendChild(valSpan);
              children.appendChild(child);
            }
          } else if (data !== undefined && data !== null) {
            const child = el("div", "ph-tree-child");
            const valSpan = el("span", "ph-tree-value");
            valSpan.textContent = String(data);
            child.appendChild(valSpan);
            children.appendChild(child);
          }

          // Toggle expand/collapse
          toggle.onclick = (e) => {
            e.stopPropagation();
            const expanded = children.classList.toggle("ph-expanded");
            toggle.textContent = expanded ? "\u25BC" : "\u25B6";
          };

          dataArea.appendChild(row);
          dataArea.appendChild(children);
        });
      });

      if (matchCount === 0 && (searchQuery || tagFilter)) {
        const noMatch = el("div", "ph-empty");
        noMatch.textContent = "No elements match the current filter.";
        dataArea.appendChild(noMatch);
      }
    }

    // Shared elements section
    const shared = listSharedElements();
    if (shared.length > 0) {
      const dividerEl = document.createElement("hr");
      dividerEl.style.border = "none";
      dividerEl.style.borderTop = "1px solid #d4cfc7";
      dividerEl.style.margin = "6px 0";
      dataArea.appendChild(dividerEl);

      const sharedHeader = el("div", "ph-data-header");
      sharedHeader.textContent = "Shared Elements";
      sharedHeader.style.fontSize = "10px";
      dataArea.appendChild(sharedHeader);

      for (const entry of shared) {
        const row = el("div", "ph-tree-item");

        const badge = el("span", "ph-tree-badge");
        if (entry.type === "source") {
          badge.textContent = "SRC";
          badge.style.background = "#4a9a8a";
        } else {
          badge.textContent = "REF";
          badge.style.background = "#5b8db8";
        }

        const elName = el("span", "ph-tree-el-name");
        elName.textContent = `#${entry.elementId}`;
        elName.title = entry.dataSource;
        elName.onclick = (e) => {
          e.stopPropagation();
          entry.element.scrollIntoView({ behavior: "smooth", block: "center" });
          entry.element.classList.add("ph-flash");
          entry.element.addEventListener(
            "animationend",
            () => entry.element.classList.remove("ph-flash"),
            { once: true }
          );
        };

        row.appendChild(badge);
        row.appendChild(elName);
        dataArea.appendChild(row);
      }
    }
  }

  // ── Open / Close ──
  function open() {
    trigger.style.display = "none";
    bar.classList.add("ph-open");
    updateStatusCounts();
    renderDataWalker();
  }

  function close() {
    trigger.style.display = "";
    bar.classList.remove("ph-open");
    // Exit inspect mode if active
    if (inspectMode) {
      inspectMode = false;
      inspectBtn.classList.remove("ph-active");
      deactivateInspect();
    }
  }

  // ── Trigger drag behavior ──
  let triggerDragStartX = 0;
  let triggerDragStartLeft = 0;
  let triggerDidDrag = false;

  trigger.addEventListener("mousedown", (e: MouseEvent) => {
    triggerDragStartX = e.clientX;
    triggerDragStartLeft = triggerLeft;
    triggerDidDrag = false;
    trigger.classList.add("ph-dragging");

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - triggerDragStartX;
      if (Math.abs(dx) > 5) triggerDidDrag = true;
      triggerLeft = Math.max(0, Math.min(window.innerWidth - 44, triggerDragStartLeft + dx));
      trigger.style.left = `${triggerLeft}px`;
    };

    const onUp = () => {
      trigger.classList.remove("ph-dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!triggerDidDrag) open();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  minimizeBtn.onclick = () => close();

  // ── Resize handle drag behavior ──
  let barHeight = 220;

  resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = barHeight;

    const onMove = (ev: MouseEvent) => {
      const dy = startY - ev.clientY;
      barHeight = Math.max(120, Math.min(500, startHeight + dy));
      bar.style.height = `${barHeight}px`;
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // ── Helpers: find tag type and handler for an element ID ──
  function lookupHandler(elementId: string): { tagType: string; handler: any } | null {
    let result: { tagType: string; handler: any } | null = null;
    elementHandlers.forEach((idMap, tagType) => {
      if (idMap.has(elementId)) {
        result = { tagType, handler: idMap.get(elementId) };
      }
    });
    return result;
  }

  // ── Scroll tree to a specific element row and expand it ──
  function scrollTreeToElement(elementId: string) {
    const row = dataArea.querySelector(
      `.ph-tree-item[data-element-id="${elementId}"]`
    ) as HTMLElement | null;
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // Expand the children container that follows this row
    const children = row.nextElementSibling;
    if (children && children.classList.contains("ph-tree-children")) {
      children.classList.add("ph-expanded");
      const toggle = row.querySelector(".ph-tree-toggle");
      if (toggle) toggle.textContent = "\u25BC";
    }
  }

  // ── Inspect mode: activate / deactivate ──
  function activateInspect() {
    const elements = document.querySelectorAll("[class*='__playhtml-']");
    elements.forEach((domEl) => {
      const htmlEl = domEl as HTMLElement;
      htmlEl.classList.add("ph-inspect-highlight");
      // Inject ID label
      const elId = htmlEl.id;
      if (elId) {
        const label = el("div", "ph-inspect-label");
        label.textContent = `#${elId}`;
        htmlEl.appendChild(label);
        inspectLabels.push(label);
      }
    });
  }

  function deactivateInspect() {
    // Remove highlight classes from all elements
    document
      .querySelectorAll(
        ".ph-inspect-highlight, .ph-inspect-highlight-hover, .ph-inspect-selected"
      )
      .forEach((domEl) => {
        domEl.classList.remove(
          "ph-inspect-highlight",
          "ph-inspect-highlight-hover",
          "ph-inspect-selected"
        );
      });
    // Remove injected labels
    for (const label of inspectLabels) {
      label.remove();
    }
    inspectLabels.length = 0;
    // Hide tooltip
    inspectTooltip.style.display = "none";
    hoveredElement = null;
  }

  // ── Inspect button toggle ──
  inspectBtn.onclick = () => {
    inspectMode = !inspectMode;
    inspectBtn.classList.toggle("ph-active", inspectMode);
    if (inspectMode) {
      activateInspect();
    } else {
      deactivateInspect();
    }
  };

  // ── Mousemove handler: hover highlight and tooltip ──
  document.addEventListener("mousemove", (event) => {
    if (!inspectMode) return;

    const target = (event.target as HTMLElement).closest(
      "[class*='__playhtml-']"
    ) as HTMLElement | null;

    if (target && target !== hoveredElement) {
      // Remove hover from previous
      if (hoveredElement) {
        hoveredElement.classList.remove("ph-inspect-highlight-hover");
      }
      hoveredElement = target;
      target.classList.add("ph-inspect-highlight-hover");

      // Look up handler data
      const elId = target.id;
      const info = elId ? lookupHandler(elId) : null;

      if (info) {
        ttType.textContent = info.tagType;
        ttId.textContent = `#${elId}`;

        // Clear old data rows (everything after the header)
        while (inspectTooltip.childNodes.length > 1) {
          inspectTooltip.removeChild(inspectTooltip.lastChild!);
        }

        // Add data rows
        const data = info.handler.data;
        if (data && typeof data === "object") {
          for (const [key, value] of Object.entries(data)) {
            const ttRow = el("div", "ph-tt-row");
            const ttKey = el("span", "ph-tt-key");
            ttKey.textContent = key + ": ";
            const ttVal = el("span", "ph-tt-val");
            ttVal.textContent =
              typeof value === "object" ? JSON.stringify(value) : String(value);
            ttRow.appendChild(ttKey);
            ttRow.appendChild(ttVal);
            inspectTooltip.appendChild(ttRow);
          }
        }

        // Position tooltip
        const rect = target.getBoundingClientRect();
        const placeAbove = rect.top > 80;
        inspectTooltip.style.left = `${rect.left}px`;
        if (placeAbove) {
          inspectTooltip.style.top = "";
          inspectTooltip.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        } else {
          inspectTooltip.style.bottom = "";
          inspectTooltip.style.top = `${rect.bottom + 4}px`;
        }
        inspectTooltip.style.display = "block";
      }
    } else if (!target) {
      if (hoveredElement) {
        hoveredElement.classList.remove("ph-inspect-highlight-hover");
        hoveredElement = null;
      }
      inspectTooltip.style.display = "none";
    }
  });

  // ── Click handler (capture): select element in inspect mode ──
  document.addEventListener(
    "click",
    (event) => {
      if (!inspectMode) return;

      // Let dev UI clicks through
      const devRoot = document.getElementById("playhtml-dev-root");
      if (devRoot && devRoot.contains(event.target as Node)) return;

      const target = (event.target as HTMLElement).closest(
        "[class*='__playhtml-']"
      ) as HTMLElement | null;

      if (target) {
        event.preventDefault();
        event.stopPropagation();

        // Remove previous selection
        document
          .querySelectorAll(".ph-inspect-selected")
          .forEach((domEl) => domEl.classList.remove("ph-inspect-selected"));

        // Apply selection
        target.classList.add("ph-inspect-selected");
        const elId = target.id;
        selectedElementId = elId || null;

        // Log handler data
        const info = elId ? lookupHandler(elId) : null;
        if (info) {
          console.log(
            `[playhtml inspect] ${info.tagType} #${selectedElementId}`,
            info.handler.data
          );
        }

        // Auto-scroll tree
        if (elId) {
          scrollTreeToElement(elId);
        }
      }
    },
    true
  );
}
