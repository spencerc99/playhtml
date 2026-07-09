// ABOUTME: A small once-per-session hint near the cursor that teaches the emote shortcut when another cursor is close.
// ABOUTME: Vanilla DOM in the emote shadow root (not React) so it never re-renders the wheel's root.

const HINT_DURATION_MS = 4000;

export class ReactHint {
  private el: HTMLDivElement;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(shadow: ShadowRoot, isMac: boolean) {
    const shortcut = isMac ? "⌘⇧E" : "Ctrl⇧E";
    this.el = document.createElement("div");
    this.el.className = "emote-react-hint";

    const pre = document.createTextNode("press ");
    const kbd = document.createElement("kbd");
    kbd.textContent = shortcut;
    const post = document.createTextNode(" to react");
    this.el.append(pre, kbd, post);

    shadow.appendChild(this.el);
  }

  /** Show the hint near the cursor for a few seconds, then fade out. Idempotent while visible. */
  showAt(pos: { x: number; y: number }): void {
    if (this.hideTimeout !== null) return;
    this.el.style.left = `${pos.x + 20}px`;
    this.el.style.top = `${pos.y + 20}px`;
    this.el.classList.add("visible");
    this.hideTimeout = setTimeout(() => {
      this.el.classList.remove("visible");
      this.hideTimeout = null;
    }, HINT_DURATION_MS);
  }

  destroy(): void {
    if (this.hideTimeout !== null) clearTimeout(this.hideTimeout);
    this.hideTimeout = null;
    this.el.remove();
  }
}
