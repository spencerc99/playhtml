// ABOUTME: Prototype of "declarative dragging" on top of playhtml's view API.
// ABOUTME: An element lists the states a drag can reach; the engine figures out the rest.
//
// Idea from "Declarative Dragging" (Horowitz, Blinn, Heer, UIST '26).
// How it works:
//   1. On pointerdown over a `[data-drag="key"]` child, ask `drag()` for the
//      states this drag can reach.
//   2. Render each candidate state in place (synchronously, never painted)
//      and record where the grabbed child lands in each one.
//   3. On every pointermove, pick the state whose landing spot is nearest the
//      pointer (`closest`), or interpolate a number along the sampled path
//      (`vary`). That state is the live preview: rendered locally and shared
//      with everyone through `live`, which is not persisted.
//   4. On release, write the preview once with `setData`.

import { render, type TemplateResult } from "lit-html";
import type { ElementInitializer, ElementUser } from "playhtml";

export type DragSpec<T> =
  | { kind: "closest"; states: T[]; float: boolean }
  | {
      kind: "vary";
      make: (value: number) => T;
      min: number;
      max: number;
      steps: number;
    };

/**
 * Snap to whichever of these states puts the grabbed piece nearest the pointer.
 * By default the piece also floats under the pointer while you drag; pass
 * `{ float: false }` to keep it in place (e.g. inside a rotated parent).
 */
export function closest<T>(
  states: T[],
  { float = true }: { float?: boolean } = {},
): DragSpec<T> {
  return { kind: "closest", states, float };
}

/** Slide a number between min and max so the grabbed piece follows the pointer. */
export function vary<T>(
  make: (value: number) => T,
  { min, max, steps = 64 }: { min: number; max: number; steps?: number },
): DragSpec<T> {
  return { kind: "vary", make, min, max, steps };
}

export interface DraggableConfig<T> {
  defaultData: T;
  /** Pure render from state to template. Mark grabbable children with `data-drag="key"`. */
  view: (args: { data: T; dragging: string | null }) => TemplateResult;
  /** Called when a drag starts. Return the states this drag can reach. */
  drag: (args: { data: T; key: string }) => DragSpec<T>;
}

type Local<T> = { preview: T | null; key: string | null };
type Live<T> = { session: string; preview: T; key: string } | null;

const SESSION = Math.random().toString(36).slice(2);

type Point = { x: number; y: number };

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function draggable<T>(
  config: DraggableConfig<T>,
): ElementInitializer<T, Local<T>, Live<T>> {
  const remotePreview = (users: ElementUser<Live<T>>[]) => {
    const other = users.find((u) => u.live && u.live.session !== SESSION);
    return other?.live ?? null;
  };

  return {
    defaultData: config.defaultData,
    defaultLocalData: { preview: null, key: null },
    live: null,
    view: ({ data, localData, users }) => {
      const remote = remotePreview(users);
      if (localData.preview) {
        return config.view({
          data: localData.preview,
          dragging: localData.key,
        });
      }
      if (remote) {
        return config.view({ data: remote.preview, dragging: remote.key });
      }
      return config.view({ data, dragging: null });
    },
    onMount: ({ getElement, getData, setData, setLocalData, setLive }) => {
      const element = getElement();

      const handleFor = (key: string) =>
        element.querySelector<HTMLElement>(`[data-drag="${CSS.escape(key)}"]`);

      const centerOf = (key: string): Point | null => {
        const handle = handleFor(key);
        if (!handle) return null;
        const box = element.getBoundingClientRect();
        const rect = handle.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2 - box.left,
          y: rect.top + rect.height / 2 - box.top,
        };
      };

      const draw = (state: T, key: string | null) =>
        render(config.view({ data: state, dragging: key }), element);

      // Slide the other pieces from where they were to where they are now.
      const animateFrom = (before: Map<string, DOMRect>, skip: string) => {
        element.querySelectorAll<HTMLElement>("[data-drag]").forEach((el) => {
          const key = el.dataset.drag!;
          const old = before.get(key);
          if (key === skip || !old) return;
          const now = el.getBoundingClientRect();
          const dx = old.left - now.left;
          const dy = old.top - now.top;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
          el.animate(
            [{ translate: `${dx}px ${dy}px` }, { translate: "0px 0px" }],
            { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" },
          );
        });
      };

      const snapshotRects = () => {
        const rects = new Map<string, DOMRect>();
        element.querySelectorAll<HTMLElement>("[data-drag]").forEach((el) => {
          rects.set(el.dataset.drag!, el.getBoundingClientRect());
        });
        return rects;
      };

      const onPointerDown = (event: PointerEvent) => {
        const handle = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-drag]",
        );
        if (!handle || !element.contains(handle) || event.button > 0) return;
        event.preventDefault();
        const key = handle.dataset.drag!;
        const start = plain(getData());
        const spec = config.drag({ data: start, key });

        // Candidate states and the values that produced them (for `vary`).
        const values =
          spec.kind === "vary"
            ? Array.from(
                { length: spec.steps + 1 },
                (_, i) => spec.min + ((spec.max - spec.min) * i) / spec.steps,
              )
            : [];
        const states =
          spec.kind === "vary" ? values.map((v) => spec.make(v)) : spec.states;

        // Speculative rendering: draw each state, note where the piece lands.
        const spots: (Point | null)[] = states.map((state) => {
          draw(state, key);
          return centerOf(key);
        });
        draw(start, key);

        const home = centerOf(key) ?? { x: 0, y: 0 };
        const box = element.getBoundingClientRect();
        const grab = {
          x: event.clientX - box.left - home.x,
          y: event.clientY - box.top - home.y,
        };

        let preview = start;
        element.setPointerCapture(event.pointerId);
        element.classList.add("is-dragging");

        const show = (next: T, float: Point | null) => {
          if (!same(next, preview)) {
            const before = snapshotRects();
            preview = next;
            setLocalData({ preview: next, key });
            setLive({ session: SESSION, preview: next, key });
            draw(next, key);
            animateFrom(before, key);
          }
          const el = handleFor(key);
          if (el) el.style.translate = float ? `${float.x}px ${float.y}px` : "";
        };

        const onMove = (move: PointerEvent) => {
          const rect = element.getBoundingClientRect();
          const target = {
            x: move.clientX - rect.left - grab.x,
            y: move.clientY - rect.top - grab.y,
          };

          if (spec.kind === "closest") {
            let best = 0;
            let bestDist = Infinity;
            spots.forEach((spot, i) => {
              if (!spot) return;
              const d = Math.hypot(spot.x - target.x, spot.y - target.y);
              if (d < bestDist) {
                bestDist = d;
                best = i;
              }
            });
            const spot = spots[best] ?? target;
            // The piece floats under the pointer; everything else shows the
            // state it would drop into.
            show(
              states[best],
              spec.float
                ? { x: target.x - spot.x, y: target.y - spot.y }
                : null,
            );
            return;
          }

          // `vary`: project the pointer onto the path the piece traces as the
          // number changes, then read the number back off that path.
          let bestValue = values[0];
          let bestDist = Infinity;
          for (let i = 0; i < spots.length - 1; i++) {
            const a = spots[i];
            const b = spots[i + 1];
            if (!a || !b) continue;
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const len2 = abx * abx + aby * aby;
            const t =
              len2 === 0
                ? 0
                : Math.max(
                    0,
                    Math.min(
                      1,
                      ((target.x - a.x) * abx + (target.y - a.y) * aby) / len2,
                    ),
                  );
            const px = a.x + abx * t;
            const py = a.y + aby * t;
            const d = Math.hypot(px - target.x, py - target.y);
            if (d < bestDist) {
              bestDist = d;
              bestValue = values[i] + (values[i + 1] - values[i]) * t;
            }
          }
          show(spec.make(bestValue), null);
        };

        const onUp = () => {
          element.removeEventListener("pointermove", onMove);
          element.removeEventListener("pointerup", onUp);
          element.removeEventListener("pointercancel", onUp);
          element.classList.remove("is-dragging");

          const el = handleFor(key);
          if (el && el.style.translate) {
            const [x, y] = el.style.translate.split(" ");
            el.style.translate = "";
            el.animate(
              [{ translate: `${x} ${y ?? "0px"}` }, { translate: "0px 0px" }],
              { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" },
            );
          }
          // One persisted write per drag.
          if (!same(preview, start)) setData(preview);
          setLocalData({ preview: null, key: null });
          setLive(null);
        };

        element.addEventListener("pointermove", onMove);
        element.addEventListener("pointerup", onUp);
        element.addEventListener("pointercancel", onUp);
      };

      element.addEventListener("pointerdown", onPointerDown);
      return () => element.removeEventListener("pointerdown", onPointerDown);
    },
  };
}
