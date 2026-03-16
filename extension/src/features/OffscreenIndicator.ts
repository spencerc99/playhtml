// ABOUTME: Renders a circular indicator at the viewport edge when a tracked cursor is off-screen.
// ABOUTME: Shows direction and color of cursors that are above or below the current viewport.

const PIP_SIZE = 28;
const EDGE_MARGIN = 8;
const H_PAD = 20;

export class OffscreenIndicator {
  private pips = new Map<string, HTMLElement>();

  // Update indicator for a specific cursor.
  // cursorX/cursorY are in client (viewport) coordinates.
  // Returns true if the cursor is off-screen.
  update(id: string, cursorX: number, cursorY: number, color: string): boolean {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const isOffscreen = cursorY < 0 || cursorY > vh;
    if (!isOffscreen) {
      this.remove(id);
      return false;
    }

    let pip = this.pips.get(id);
    if (!pip) {
      pip = this.createPip(color);
      document.body.appendChild(pip);
      this.pips.set(id, pip);
    }

    const atTop = cursorY < 0;
    const clampedX = Math.max(H_PAD, Math.min(vw - H_PAD - PIP_SIZE, cursorX - PIP_SIZE / 2));

    Object.assign(pip.style, {
      left: `${clampedX}px`,
      top: atTop ? `${EDGE_MARGIN}px` : "",
      bottom: atTop ? "" : `${EDGE_MARGIN}px`,
    });

    const arrow = pip.querySelector(".offscreen-arrow") as HTMLElement;
    if (arrow) {
      arrow.style.transform = atTop ? "rotate(180deg)" : "rotate(0deg)";
    }

    return true;
  }

  remove(id: string): void {
    const pip = this.pips.get(id);
    if (pip) {
      pip.remove();
      this.pips.delete(id);
    }
  }

  destroy(): void {
    for (const pip of this.pips.values()) pip.remove();
    this.pips.clear();
  }

  private createPip(color: string): HTMLElement {
    const pip = document.createElement("div");
    Object.assign(pip.style, {
      position: "fixed",
      width: `${PIP_SIZE}px`,
      height: `${PIP_SIZE}px`,
      borderRadius: "50%",
      background: "rgba(250, 247, 242, 0.92)",
      border: `2px solid ${color}`,
      boxShadow: `0 2px 8px rgba(0,0,0,0.1), 0 0 0 1px ${color}30`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "2147483644",
      pointerEvents: "none",
      transition: "left 0.1s ease, top 0.1s ease, bottom 0.1s ease",
    });

    // Arrow pointing toward the cursor (down = cursor is below)
    const arrow = document.createElement("div");
    arrow.className = "offscreen-arrow";
    Object.assign(arrow.style, {
      width: "0",
      height: "0",
      borderLeft: "5px solid transparent",
      borderRight: "5px solid transparent",
      borderTop: `6px solid ${color}`,
    });
    pip.appendChild(arrow);

    return pip;
  }
}
