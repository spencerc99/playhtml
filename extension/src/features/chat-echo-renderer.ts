// ABOUTME: Renders chat-message echo bubbles anchored to a peer's cursor for ~3 seconds.
// ABOUTME: Reads cursor positions from CursorClient.getCursorPresences() and repositions on rAF.

const ECHO_TTL_MS = 3000;
const BUBBLE_OFFSET_X = 12;
const BUBBLE_OFFSET_Y = -28;

interface MinimalCursorClient {
  getCursorPresences(): Map<
    string,
    {
      cursor: { x: number; y: number; pointer: string } | null;
      playerIdentity: { publicKey: string };
    }
  >;
}

interface EchoEntry {
  msg: string;
  color: string;
  expiresAt: number;
  node: HTMLElement;
}

const CSS = `
:host { all: initial; }
.layer {
  position: fixed;
  top: 0; left: 0;
  width: 0; height: 0;
  pointer-events: none;
  z-index: 2147483641;
}
.bubble {
  position: absolute;
  background: #faf7f2;
  border: 1px solid currentColor;
  border-radius: 10px;
  padding: 3px 8px;
  font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
  font-size: 12px;
  white-space: nowrap;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.92;
  transition: opacity 200ms ease;
}
`;

export class ChatEchoRenderer {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private layer: HTMLElement;
  private entries = new Map<string, EchoEntry>();
  private rafId: number | null = null;
  private destroyed = false;

  constructor(private cursorClient: MinimalCursorClient) {
    this.host = document.createElement("div");
    this.host.id = "wewere-chat-echo-host";
    this.host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483641;";
    this.shadow = this.host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    this.shadow.appendChild(styleEl);
    const layer = document.createElement("div");
    layer.className = "layer";
    this.shadow.appendChild(layer);
    this.layer = layer;
    document.body.appendChild(this.host);
  }

  setEcho(pid: string, msg: string, color: string): void {
    if (this.destroyed) return;
    const presences = this.cursorClient.getCursorPresences();
    const peer = presences.get(pid);
    if (!peer || !peer.cursor) {
      const existing = this.entries.get(pid);
      if (existing) {
        existing.node.remove();
        this.entries.delete(pid);
      }
      return;
    }
    const existing = this.entries.get(pid);
    if (existing) {
      existing.node.remove();
      this.entries.delete(pid);
    }
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.dataset.chatEcho = pid;
    bubble.style.color = color;
    bubble.style.borderColor = color;
    bubble.textContent = msg;
    bubble.style.left = `${peer.cursor.x + BUBBLE_OFFSET_X}px`;
    bubble.style.top = `${peer.cursor.y + BUBBLE_OFFSET_Y}px`;
    this.layer.appendChild(bubble);
    const entry: EchoEntry = {
      msg,
      color,
      expiresAt: Date.now() + ECHO_TTL_MS,
      node: bubble,
    };
    this.entries.set(pid, entry);
    this.ensureLoop();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.entries.forEach((e) => e.node.remove());
    this.entries.clear();
    this.host.remove();
  }

  private ensureLoop(): void {
    if (this.rafId != null) return;
    const tick = () => {
      this.rafId = null;
      if (this.destroyed) return;
      const now = Date.now();
      const presences = this.cursorClient.getCursorPresences();
      const expired: string[] = [];
      this.entries.forEach((entry, pid) => {
        if (now >= entry.expiresAt) {
          expired.push(pid);
          return;
        }
        const peer = presences.get(pid);
        if (!peer || !peer.cursor) {
          expired.push(pid);
          return;
        }
        entry.node.style.left = `${peer.cursor.x + BUBBLE_OFFSET_X}px`;
        entry.node.style.top = `${peer.cursor.y + BUBBLE_OFFSET_Y}px`;
      });
      expired.forEach((pid) => {
        const entry = this.entries.get(pid);
        entry?.node.remove();
        this.entries.delete(pid);
      });
      if (this.entries.size > 0) {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
