// ABOUTME: Renders emote animations anchored to a cursor inside the emote shadow root.
// ABOUTME: Mirrors ChatEchoRenderer — position from getCursorPresences, rAF reposition, TTL removal.

import { getEmote } from "./emotes";
import { emoteIconSvg } from "./icons";

export interface CursorSource {
  getCursorPresences(): Map<string, { cursor: { x: number; y: number } | null }>;
}

interface ActiveNode {
  pid: string;
  isMe: boolean;
  node: HTMLElement;
  expiresAt: number;
}

export class EmoteRenderer {
  private layer: HTMLElement;
  private active: ActiveNode[] = [];
  private rafId: number | null = null;
  private destroyed = false;

  constructor(
    shadow: ShadowRoot,
    private cursors: CursorSource,
    private selfCursor: () => { x: number; y: number },
  ) {
    this.layer = document.createElement("div");
    this.layer.style.cssText = "position:fixed;inset:0;pointer-events:none;";
    shadow.appendChild(this.layer);
    this.tick = this.tick.bind(this);
  }

  play(pid: string, emoteId: string, isMe: boolean): void {
    const def = getEmote(emoteId);
    if (!def) return;
    const node = document.createElement("div");
    node.className = `emote-node ${def.keyframe}`;
    node.style.animation = `${def.keyframe} ${def.durationMs}ms ease-out`;
    const glyph = document.createElement("span");
    glyph.className = "emote-glyph";
    // Played emote uses the same ink icon as the wheel. Markup is static
    // (composed from icons.ts constants), so innerHTML is safe here.
    glyph.innerHTML = emoteIconSvg(def.id, 30, "#3d3833", 2.4);
    node.appendChild(glyph);
    this.layer.appendChild(node);
    this.active.push({ pid, isMe, node, expiresAt: Date.now() + def.durationMs });
    this.position();
    setTimeout(() => this.remove(node), def.durationMs);
    this.ensureTicking();
  }

  private remove(node: HTMLElement): void {
    node.remove();
    this.active = this.active.filter((a) => a.node !== node);
    if (this.active.length === 0 && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private ensureTicking(): void {
    if (this.rafId === null && !this.destroyed) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private tick(): void {
    this.position();
    if (this.active.length > 0 && !this.destroyed) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.rafId = null;
    }
  }

  private position(): void {
    const presences = this.cursors.getCursorPresences();
    for (const a of this.active) {
      const pos = a.isMe ? this.selfCursor() : presences.get(a.pid)?.cursor;
      if (!pos) continue;
      a.node.style.left = `${pos.x}px`;
      a.node.style.top = `${pos.y}px`;
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.active.forEach((a) => a.node.remove());
    this.active = [];
    this.layer.remove();
  }
}
