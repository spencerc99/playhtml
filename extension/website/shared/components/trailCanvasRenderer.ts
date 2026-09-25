// ABOUTME: Paints the current SVG trail-path layer into a Canvas surface.
// ABOUTME: Reuses production path attributes so renderer comparisons share geometry and styling.

interface CachedCanvasPath {
  data: string;
  path: Path2D;
}

export interface TrailCanvasViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class TrailCanvasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly paths = new WeakMap<SVGPathElement, CachedCanvasPath>();
  private pixelRatio = 0;
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    this.context = context;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const nextPixelRatio = Math.max(1, pixelRatio);
    if (
      nextWidth === this.width &&
      nextHeight === this.height &&
      nextPixelRatio === this.pixelRatio
    ) {
      return;
    }

    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = nextPixelRatio;
    this.canvas.width = Math.round(nextWidth * nextPixelRatio);
    this.canvas.height = Math.round(nextHeight * nextPixelRatio);
  }

  draw(
    groups: Iterable<SVGGElement>,
    viewport: TrailCanvasViewport,
  ): void {
    const context = this.context;
    const foreignObject = this.canvas.parentElement;
    foreignObject?.setAttribute("x", String(viewport.x));
    foreignObject?.setAttribute("y", String(viewport.y));
    foreignObject?.setAttribute("width", String(viewport.width));
    foreignObject?.setAttribute("height", String(viewport.height));
    this.canvas.style.width = `${viewport.width}px`;
    this.canvas.style.height = `${viewport.height}px`;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const scaleX = (this.width * this.pixelRatio) / viewport.width;
    const scaleY = (this.height * this.pixelRatio) / viewport.height;
    context.setTransform(
      scaleX,
      0,
      0,
      scaleY,
      -viewport.x * scaleX,
      -viewport.y * scaleY,
    );
    context.globalCompositeOperation = "source-over";

    for (const group of groups) {
      const groupOpacity = Number(group.getAttribute("opacity") ?? 1);
      if (groupOpacity <= 0) continue;

      for (const pathElement of group.querySelectorAll<SVGPathElement>("path")) {
        this.drawPath(pathElement, groupOpacity);
      }
    }

    context.globalAlpha = 1;
  }

  private drawPath(pathElement: SVGPathElement, groupOpacity: number): void {
    if (pathElement.style.display === "none") return;
    const data = pathElement.getAttribute("d");
    if (!data) return;

    let cached = this.paths.get(pathElement);
    if (!cached || cached.data !== data) {
      cached = { data, path: new Path2D(data) };
      this.paths.set(pathElement, cached);
    }

    const context = this.context;
    const opacity = Number(pathElement.getAttribute("opacity") ?? 1);
    context.globalAlpha = groupOpacity * opacity;

    const fill = pathElement.getAttribute("fill");
    if (fill && fill !== "none") {
      context.fillStyle = fill;
      context.fill(cached.path);
    }

    const stroke = pathElement.getAttribute("stroke");
    if (stroke && stroke !== "none") {
      context.strokeStyle = stroke;
      context.lineWidth = Number(pathElement.getAttribute("stroke-width") ?? 1);
      context.lineCap = "butt";
      context.lineJoin = "miter";
      context.stroke(cached.path);
    }
  }
}
