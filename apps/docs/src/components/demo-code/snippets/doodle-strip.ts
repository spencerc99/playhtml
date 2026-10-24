// ABOUTME: Copyable source for the doodle strip: draw a 64x64 doodle, add it to a shared row.
// ABOUTME: The row keeps the newest 20 doodles as small PNG data URLs.
import { indent } from "../indent";
import type { DemoSnippet } from "../types";

const css = `.pad {
  width: 192px;
  height: 192px;
  border: 1.5px solid #1c1c1c;
  background: white;
  image-rendering: pixelated;
  touch-action: none;
  cursor: crosshair;
}
.strip {
  display: flex;
  gap: 6px;
  min-height: 64px;
  overflow-x: auto;
}
.strip img {
  width: 64px;
  height: 64px;
  border: 1px solid #1c1c1c;
  background: white;
  image-rendering: pixelated;
}`;

export const doodleStripSnippet: DemoSnippet = {
  html: `<canvas id="doodle-pad" class="pad" width="64" height="64"></canvas>
<button id="doodle-clear">Clear</button>
<button id="doodle-add">Add to row</button>
<div id="doodle-strip" class="strip"></div>

<style>
${indent(css)}
</style>

<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";

  const SIZE = 64;
  const MAX_DOODLES = 20;
  const pad = document.getElementById("doodle-pad");
  const pen = pad.getContext("2d");
  pen.lineWidth = 4;
  pen.lineCap = "round";
  pen.lineJoin = "round";

  // Pointer position in canvas pixels (the canvas is drawn 3x larger).
  function toPad(event) {
    const rect = pad.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * SIZE,
      ((event.clientY - rect.top) / rect.height) * SIZE,
    ];
  }

  let drawing = false;
  pad.addEventListener("pointerdown", (event) => {
    drawing = true;
    pad.setPointerCapture(event.pointerId);
    pen.beginPath();
    pen.moveTo(...toPad(event));
    pen.lineTo(...toPad(event)); // a click leaves a dot
    pen.stroke();
  });
  pad.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    pen.lineTo(...toPad(event));
    pen.stroke();
  });
  pad.addEventListener("pointerup", () => (drawing = false));

  const clearPad = () => pen.clearRect(0, 0, SIZE, SIZE);
  document.getElementById("doodle-clear").addEventListener("click", clearPad);

  // The shared row. Only finished doodles are shared, never the strokes.
  const strip = playhtml.register("doodle-strip", {
    defaultData: { doodles: [] },
    update: ({ element, data }) => {
      element.replaceChildren(
        ...data.doodles.map((doodle) => {
          const img = document.createElement("img");
          img.src = doodle.src;
          img.alt = "";
          return img;
        }),
      );
    },
  });

  document.getElementById("doodle-add").addEventListener("click", () => {
    const src = pad.toDataURL("image/png");
    strip.setData((data) => {
      data.doodles.push({ id: crypto.randomUUID(), src });
      // Keep the newest 20. Shared arrays support splice, not shift.
      if (data.doodles.length > MAX_DOODLES) {
        data.doodles.splice(0, data.doodles.length - MAX_DOODLES);
      }
    });
    clearPad();
  });

  playhtml.init();
</script>`,
  react: `import { useRef, type PointerEvent } from "react";
import { withSharedState } from "@playhtml/react";

const SIZE = 64;
const MAX_DOODLES = 20;

type Doodle = { id: string; src: string };

export const DoodleStrip = withSharedState(
  { id: "doodle-strip", defaultData: { doodles: [] as Doodle[] } },
  ({ data, setData }) => {
    const padRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);

    const pen = () => padRef.current!.getContext("2d")!;

    // Pointer position in canvas pixels (the canvas is drawn 3x larger).
    function toPad(event: PointerEvent<HTMLCanvasElement>): [number, number] {
      const rect = event.currentTarget.getBoundingClientRect();
      return [
        ((event.clientX - rect.left) / rect.width) * SIZE,
        ((event.clientY - rect.top) / rect.height) * SIZE,
      ];
    }

    function startStroke(event: PointerEvent<HTMLCanvasElement>) {
      drawing.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      const ctx = pen();
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(...toPad(event));
      ctx.lineTo(...toPad(event)); // a click leaves a dot
      ctx.stroke();
    }

    function continueStroke(event: PointerEvent<HTMLCanvasElement>) {
      if (!drawing.current) return;
      pen().lineTo(...toPad(event));
      pen().stroke();
    }

    const clearPad = () => pen().clearRect(0, 0, SIZE, SIZE);

    // Only finished doodles are shared, never the strokes.
    function addToRow() {
      const src = padRef.current!.toDataURL("image/png");
      setData((draft) => {
        draft.doodles.push({ id: crypto.randomUUID(), src });
        // Keep the newest 20. Shared arrays support splice, not shift.
        if (draft.doodles.length > MAX_DOODLES) {
          draft.doodles.splice(0, draft.doodles.length - MAX_DOODLES);
        }
      });
      clearPad();
    }

    return (
      <div>
        <canvas
          ref={padRef}
          className="pad"
          width={SIZE}
          height={SIZE}
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={() => (drawing.current = false)}
        />
        <button onClick={clearPad}>Clear</button>
        <button onClick={addToRow}>Add to row</button>
        <div className="strip">
          {data.doodles.map((doodle) => (
            <img key={doodle.id} src={doodle.src} alt="" />
          ))}
        </div>
      </div>
    );
  },
);`,
  reactCss: css,
};
