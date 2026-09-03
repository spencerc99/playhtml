/** View transform, input handling, and URL round-tripping. */

export class Camera {
  cx = 0; cy = 0; k = 1; kFit = 1;
  W = 0; H = 0; dpr = 1;

  constructor(private extent: [number, number, number, number]) {
    this.fit();
  }

  setViewport(w: number, h: number, dpr: number) {
    this.W = w; this.H = h; this.dpr = dpr;
  }

  fit() {
    const [x0, y0, x1, y1] = this.extent;
    this.cx = (x0 + x1) / 2;
    this.cy = (y0 + y1) / 2;
    this.k = 0.94 * Math.min(this.W / (x1 - x0 || 1), this.H / (y1 - y0 || 1));
    if (!Number.isFinite(this.k) || this.k <= 0) this.k = 1;
    this.kFit = this.k;
  }

  toScreenX(x: number) { return (x - this.cx) * this.k + this.W / 2; }
  toScreenY(y: number) { return (y - this.cy) * this.k + this.H / 2; }
  toWorldX(sx: number) { return (sx - this.W / 2) / this.k + this.cx; }
  toWorldY(sy: number) { return (sy - this.H / 2) / this.k + this.cy; }

  zoomAt(sx: number, sy: number, factor: number) {
    const wx = this.toWorldX(sx), wy = this.toWorldY(sy);
    this.k = Math.max(this.kFit * 0.3, Math.min(this.kFit * 20000, this.k * factor));
    this.cx += wx - this.toWorldX(sx);
    this.cy += wy - this.toWorldY(sy);
  }

  /** Visible world rect, padded by `pad` screen px. */
  bounds(pad = 0) {
    return {
      x0: this.toWorldX(-pad), y0: this.toWorldY(-pad),
      x1: this.toWorldX(this.W + pad), y1: this.toWorldY(this.H + pad),
    };
  }

  applyURL(q: URLSearchParams) {
    const at = q.get("at");
    if (!at) return;
    const [x, y, k] = at.split(",").map(Number);
    if ([x, y, k].every(Number.isFinite)) { this.cx = x; this.cy = y; this.k = k; }
  }

  toURLValue() {
    return `${this.cx.toFixed(0)},${this.cy.toFixed(0)},${this.k.toPrecision(4)}`;
  }
}

export function attachControls(
  el: HTMLElement, cam: Camera,
  onChange: () => void,
  onHover: (x: number, y: number) => void,
  onClick: (x: number, y: number) => void,
  /** true while a gesture is in flight, so the caller can draw cheaply */
  onInteract: (active: boolean) => void = () => {},
) {
  let idle: number | undefined;
  const settle = () => {
    clearTimeout(idle);
    idle = window.setTimeout(() => { onInteract(false); onChange(); }, 140);
  };
  let drag: { x: number; y: number; cx: number; cy: number; moved: number } | null = null;

  el.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy, moved: 0 };
    onInteract(true);
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
      cam.cx = drag.cx - dx / cam.k;
      cam.cy = drag.cy - dy / cam.k;
      onChange();
    } else {
      onHover(e.clientX, e.clientY);
    }
  });
  el.addEventListener("pointerup", (e) => {
    const wasDrag = drag && drag.moved > 4;
    drag = null;
    onInteract(false);
    onChange();
    if (!wasDrag) onClick(e.clientX, e.clientY);
  });
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022)));
    onInteract(true);
    onChange();
    settle();
  }, { passive: false });
}

export function flyTo(cam: Camera, x: number, y: number, k: number,
                      onFrame: () => void, done?: () => void) {
  const s = { cx: cam.cx, cy: cam.cy, k: cam.k };
  const t0 = performance.now(), D = 620;
  const step = (now: number) => {
    const u = Math.min(1, (now - t0) / D);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    cam.cx = s.cx + (x - s.cx) * e;
    cam.cy = s.cy + (y - s.cy) * e;
    cam.k = s.k * Math.pow(k / s.k, e);
    onFrame();
    if (u < 1) requestAnimationFrame(step); else done?.();
  };
  requestAnimationFrame(step);
}
