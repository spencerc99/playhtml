// ABOUTME: Renders a tiny armed-item icon that follows the cursor (the "wielding" cue).
// ABOUTME: Vanilla DOM inside the shadow root; toggled by the manager's onArmedChange.

export class WieldCursor {
  private el: HTMLDivElement;
  private icon: HTMLDivElement;
  private onMove = (e: PointerEvent) => this.positionAt(e.clientX, e.clientY);

  private positionAt(x: number, y: number): void {
    this.el.style.transform = `translate(${x + 12}px, ${y + 10}px)`;
  }

  constructor(shadow: ShadowRoot) {
    this.el = document.createElement("div");
    this.el.className = "wwo-wield";
    this.icon = document.createElement("div");
    this.icon.className = "ic";
    this.el.appendChild(this.icon);
    shadow.appendChild(this.el);
  }

  /** Show the wielded icon, seeded at the last known cursor position so it doesn't flash at (0,0). */
  show(iconUrl: string, at: { x: number; y: number }): void {
    this.icon.style.backgroundImage = `url("${iconUrl}")`;
    this.positionAt(at.x, at.y);
    this.el.classList.add("show");
    window.addEventListener("pointermove", this.onMove);
  }

  hide(): void {
    this.el.classList.remove("show");
    window.removeEventListener("pointermove", this.onMove);
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }
}
