// ABOUTME: Image-to-stroke extraction for the redraw experiment
// ABOUTME: Sobel edge detection plus greedy contour tracing into polylines

export interface Point {
  x: number;
  y: number;
}

export interface ImageStrokes {
  /** Polylines in image-pixel coordinates, longest first. */
  strokes: Point[][];
  width: number;
  height: number;
}

const MIN_STROKE_POINTS = 6;

function toGrayscale(image: ImageData): Float32Array {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3] / 255;
    // Transparent pixels read as white so PNG cutouts trace their silhouette.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = lum * a + 255 * (1 - a);
  }
  return gray;
}

function sobelMagnitude(
  gray: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1] +
        gray[i - width + 1] -
        2 * gray[i - 1] +
        2 * gray[i + 1] -
        gray[i + width - 1] +
        gray[i + width + 1];
      const gy =
        -gray[i - width - 1] -
        2 * gray[i - width] -
        gray[i - width + 1] +
        gray[i + width - 1] +
        2 * gray[i + width] +
        gray[i + width + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

/** From (x, y), find an untraced edge pixel adjacent to it — first in the
 * 8-neighborhood, then in the radius-2 ring so 1px gaps don't break strokes. */
function findNextEdge(
  x: number,
  y: number,
  edge: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
): Point | null {
  for (let radius = 1; radius <= 2; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (edge[ni] && !visited[ni]) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

function tracePath(
  startX: number,
  startY: number,
  edge: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
): Point[] {
  const path: Point[] = [{ x: startX, y: startY }];
  visited[startY * width + startX] = 1;
  let current: Point | null = { x: startX, y: startY };
  while (current) {
    current = findNextEdge(current.x, current.y, edge, visited, width, height);
    if (current) {
      visited[current.y * width + current.x] = 1;
      path.push(current);
    }
  }
  return path;
}

/** Extract drawable strokes from an image: Sobel edges thresholded into a
 * binary map, then greedily walked into polylines. Each seed pixel is traced
 * in both directions so strokes don't get cut in half at their seed. */
export function extractStrokes(
  image: ImageData,
  threshold: number,
  maxStrokes: number,
): ImageStrokes {
  const { width, height } = image;
  const gray = toGrayscale(image);
  const mag = sobelMagnitude(gray, width, height);

  const edge = new Uint8Array(width * height);
  for (let i = 0; i < edge.length; i++) {
    if (mag[i] > threshold) edge[i] = 1;
  }

  const visited = new Uint8Array(width * height);
  const strokes: Point[][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!edge[i] || visited[i]) continue;
      const forward = tracePath(x, y, edge, visited, width, height);
      const backward = tracePath(x, y, edge, visited, width, height);
      // Both traces share the seed point; stitch them into one polyline.
      const path = backward.slice(1).reverse().concat(forward);
      if (path.length >= MIN_STROKE_POINTS) {
        // Halve the point density — 1px steps are far finer than needed.
        strokes.push(path.filter((_, index) => index % 2 === 0));
      }
    }
  }

  strokes.sort((a, b) => b.length - a.length);
  return { strokes: strokes.slice(0, maxStrokes), width, height };
}

/** Load a File into ImageData, downscaled so its longest side is maxSize. */
export function loadImageData(
  file: File,
  maxSize: number,
): Promise<{ imageData: ImageData; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not create canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ imageData: ctx.getImageData(0, 0, width, height), objectUrl });
    };
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = objectUrl;
  });
}
