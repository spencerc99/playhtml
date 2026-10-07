// ABOUTME: Shares each reader's current Wikipedia text selection through presence.
// ABOUTME: Renders peer selections without changing article markup or text color.

import type { PresenceAPI, PresenceView } from "@playhtml/common";

const CHANNEL = "selection";
const CONTENT_SELECTOR = "#mw-content-text";
const HIGHLIGHT_PREFIX = "wwo-live-selection-";
const FALLBACK_COLOR = "#8a8279";
const PUBLISH_INTERVAL_MS = 250;

type SelectionPoint = {
  path: number[];
  offset: number;
};

export type LiveSelection = {
  start: SelectionPoint;
  end: SelectionPoint;
};

type HighlightRegistry = {
  delete(name: string): boolean;
  set(name: string, highlight: unknown): void;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

function pathFromRoot(root: Node, node: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parentNode: Node | null = current.parentNode;
    if (!parentNode) return null;
    const index = Array.prototype.indexOf.call(parentNode.childNodes, current);
    if (index < 0) return null;
    path.unshift(index);
    current = parentNode;
  }
  return current === root ? path : null;
}

function nodeFromPath(root: Node, path: number[]): Node | null {
  let current = root;
  for (const index of path) {
    const next = current.childNodes.item(index);
    if (!next) return null;
    current = next;
  }
  return current;
}

function isSelectionPoint(value: unknown): value is SelectionPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as { path?: unknown; offset?: unknown };
  return (
    Array.isArray(point.path) &&
    point.path.length <= 64 &&
    point.path.every(
      (part) => Number.isInteger(part) && part >= 0 && part <= 10_000,
    ) &&
    Number.isInteger(point.offset) &&
    (point.offset as number) >= 0 &&
    (point.offset as number) <= 1_000_000
  );
}

function isLiveSelection(value: unknown): value is LiveSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as { start?: unknown; end?: unknown };
  return isSelectionPoint(selection.start) && isSelectionPoint(selection.end);
}

export function serializeSelectionRange(
  root: Node,
  range: Range,
): LiveSelection | null {
  if (range.collapsed) return null;
  const startPath = pathFromRoot(root, range.startContainer);
  const endPath = pathFromRoot(root, range.endContainer);
  if (!startPath || !endPath) return null;
  return {
    start: { path: startPath, offset: range.startOffset },
    end: { path: endPath, offset: range.endOffset },
  };
}

export function deserializeSelectionRange(
  root: Node,
  value: unknown,
): Range | null {
  if (!isLiveSelection(value)) return null;
  const startNode = nodeFromPath(root, value.start.path);
  const endNode = nodeFromPath(root, value.end.path);
  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, value.start.offset);
    range.setEnd(endNode, value.end.offset);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

function normalizedColor(value: unknown): string {
  if (typeof value !== "string") return FALLBACK_COLOR;
  const probe = document.createElement("span");
  probe.style.color = value;
  return probe.style.color || FALLBACK_COLOR;
}

function highlightRegistry(): HighlightRegistry | null {
  const css = globalThis.CSS as typeof CSS & {
    highlights?: HighlightRegistry;
  };
  return css?.highlights ?? null;
}

function highlightConstructor(): HighlightConstructor | null {
  return (
    (globalThis as typeof globalThis & { Highlight?: HighlightConstructor })
      .Highlight ?? null
  );
}

export class WikipediaLiveSelections {
  private root: HTMLElement | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private highlightNames = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private selectionTimer: number | null = null;
  private lastPublishedSelection: string | null | undefined;

  constructor(
    private presence: PresenceAPI,
    private playerColor: string,
  ) {}

  init(): void {
    this.root = document.querySelector<HTMLElement>(CONTENT_SELECTOR);
    if (!this.root) return;

    this.styleElement = document.createElement("style");
    this.styleElement.id = "wwo-live-selection-styles";
    document.head.appendChild(this.styleElement);
    this.updateStyles([]);

    document.addEventListener("selectionchange", this.handleSelectionChange);
    this.unsubscribe = this.presence.onPresenceChange(CHANNEL, (presences) => {
      this.renderRemoteSelections(presences);
    });
    this.publishSelection();
  }

  destroy(): void {
    if (this.selectionTimer !== null) window.clearTimeout(this.selectionTimer);
    this.selectionTimer = null;
    document.removeEventListener("selectionchange", this.handleSelectionChange);
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.root) this.presence.setMyPresence(CHANNEL, null);
    this.lastPublishedSelection = undefined;
    this.clearRemoteSelections();
    this.styleElement?.remove();
    this.styleElement = null;
    this.root = null;
  }

  private handleSelectionChange = () => {
    if (this.selectionTimer !== null) return;
    this.selectionTimer = window.setTimeout(() => {
      this.selectionTimer = null;
      this.publishSelection();
    }, PUBLISH_INTERVAL_MS);
  };

  private publishSelection(): void {
    if (!this.root) return;
    const selection = window.getSelection();
    const range =
      selection && selection.rangeCount > 0
        ? serializeSelectionRange(this.root, selection.getRangeAt(0))
        : null;
    const serialized = range ? JSON.stringify(range) : null;
    if (serialized === this.lastPublishedSelection) return;
    this.lastPublishedSelection = serialized;
    this.presence.setMyPresence(CHANNEL, range);
  }

  private renderRemoteSelections(presences: Map<string, PresenceView>): void {
    if (!this.root) return;
    this.clearRemoteSelections();
    const registry = highlightRegistry();
    const Highlight = highlightConstructor();
    if (!registry || !Highlight) return;

    const styles: Array<{ name: string; color: string }> = [];
    let index = 0;
    presences.forEach((view) => {
      if (view.isMe) return;
      const range = deserializeSelectionRange(
        this.root!,
        (view as Record<string, unknown>)[CHANNEL],
      );
      if (!range) return;
      const name = `${HIGHLIGHT_PREFIX}${index++}`;
      const color = normalizedColor(
        view.playerIdentity?.playerStyle?.colorPalette?.[0],
      );
      registry.set(name, new Highlight(range));
      this.highlightNames.add(name);
      styles.push({ name, color });
    });
    this.updateStyles(styles);
  }

  private clearRemoteSelections(): void {
    const registry = highlightRegistry();
    if (registry) {
      this.highlightNames.forEach((name) => registry.delete(name));
    }
    this.highlightNames.clear();
    this.updateStyles([]);
  }

  private updateStyles(
    remoteSelections: Array<{ name: string; color: string }>,
  ): void {
    if (!this.styleElement) return;
    const ownColor = normalizedColor(this.playerColor);
    const rules = [
      `#mw-content-text ::selection { background-color: color-mix(in srgb, ${ownColor} 32%, transparent); color: inherit; }`,
      ...remoteSelections.map(
        ({ name, color }) =>
          `::highlight(${name}) { background-color: color-mix(in srgb, ${color} 32%, transparent); color: inherit; }`,
      ),
    ];
    this.styleElement.textContent = rules.join("\n");
  }
}
