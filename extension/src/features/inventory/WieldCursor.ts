// ABOUTME: Renders a tiny armed-item icon that follows the cursor (the "wielding" cue).
// ABOUTME: Vanilla DOM inside the shadow root; toggled by the manager's onArmedChange.

export class WieldCursor {
  private el: HTMLDivElement;
  private icon: HTMLDivElement;
  private onMove = (e: PointerEvent) => {
    this.el.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 10}px)`;
  };

  constructor(shadow: ShadowRoot) {
    this.el = document.createElement("div");
    this.el.className = "wwo-wield";
    this.icon = document.createElement("div");
    this.icon.className = "ic";
    this.el.appendChild(this.icon);
    shadow.appendChild(this.el);
  }

  show(iconUrl: string): void {
    this.icon.style.backgroundImage = `url("${iconUrl}")`;
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
