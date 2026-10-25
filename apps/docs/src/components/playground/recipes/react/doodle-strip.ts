// ABOUTME: Provides the copy-paste React source for the doodle strip recipe.
// ABOUTME: Strokes stay local on a canvas; only finished doodles go into shared data.
import { doodleStripCss } from "../demo-shared";
import { appShell } from "./app-shell";

export const doodleStripReactSource = `import { useRef, type PointerEvent } from "react";
import { PlayProvider, withSharedState } from "@playhtml/react";

const SIZE = 64;
const MAX_DOODLES = 20;

type Doodle = { id: string; src: string };

const DoodleStrip = withSharedState(
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
      <>
        <canvas
          ref={padRef}
          className="pad"
          width={SIZE}
          height={SIZE}
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={() => (drawing.current = false)}
        />
        <div>
          <button onClick={clearPad}>Clear</button>
          <button onClick={addToRow}>Add to row</button>
        </div>
        <div className="strip">
          {data.doodles.map((doodle) => (
            <img key={doodle.id} src={doodle.src} alt="" />
          ))}
        </div>
      </>
    );
  },
);

${appShell("DoodleStrip", doodleStripCss)}`;
