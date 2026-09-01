// ABOUTME: Side view of one carriage window pane you wipe clear with the cursor.
// ABOUTME: Wipes are shared and persistent per pane, fogging back over across days.

import { useCallback, useRef, useState } from "react";
import { usePlayContext, withSharedState } from "@playhtml/react";
import { CommuteSideView } from "./CommuteSideView";
import {
  getExpiredStrokeIds,
  getStrokeOpacity,
  getVisibleStrokes,
  simplifyStrokePoints,
  toPolylinePoints,
  type FoggedStroke,
  type FoggedWindowData,
} from "./foggedWindow";
import type { CommuteBay } from "./commuteBays";
import type { CommuteStop } from "./commuteStops";
import { ProceduralLandscape } from "./landscape";

const PANE_WIDTH = 720;
const PANE_HEIGHT = 420;

interface FoggedWindowPaneProps {
  id: string;
  bay: CommuteBay;
  currentStop: CommuteStop;
  onClose: () => void;
}

function createStrokeId(): string {
  return `stroke-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function describeAge(drawnAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - drawnAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const FoggedWindowPane = withSharedState<
  FoggedWindowData,
  never,
  FoggedWindowPaneProps
>(
  () => ({
    defaultData: {} as FoggedWindowData,
  }),
  ({ data, setData, ref }, props) => {
    const { cursors } = usePlayContext();
    const [now] = useState(() => Date.now());
    const [draft, setDraft] = useState<number[] | null>(null);
    const draftRef = useRef<number[] | null>(null);
    const drawing = useRef(false);
    const surfaceRef = useRef<SVGSVGElement | null>(null);

    const paneStrokes = data[props.bay.id];
    const visibleStrokes = getVisibleStrokes(paneStrokes, now);

    const readPoint = (event: React.PointerEvent): [number, number] | null => {
      const surface = surfaceRef.current;
      if (!surface) return null;
      const bounds = surface.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      return [
        (event.clientX - bounds.left) / bounds.width,
        (event.clientY - bounds.top) / bounds.height,
      ];
    };

    const startWipe = (event: React.PointerEvent) => {
      const point = readPoint(event);
      if (!point) return;
      drawing.current = true;
      draftRef.current = point;
      setDraft(point);
      event.currentTarget.setPointerCapture(event.pointerId);
    };

    const continueWipe = (event: React.PointerEvent) => {
      if (!drawing.current) return;
      const point = readPoint(event);
      if (!point) return;
      const next = draftRef.current ? [...draftRef.current, ...point] : point;
      draftRef.current = next;
      setDraft(next);
    };

    // Committed only on pointer release — an explicit user event, never a
    // reactive callback that re-runs when the shared strokes change.
    const finishWipe = useCallback(() => {
      if (!drawing.current) return;
      drawing.current = false;

      const points = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      if (!points || points.length < 4) return;

      const stroke: FoggedStroke = {
        id: createStrokeId(),
        color: cursors.color || "#4a9a8a",
        drawnAt: Date.now(),
        points: simplifyStrokePoints(points),
      };
      const bayId = props.bay.id;

      setData((current) => {
        if (!current[bayId]) current[bayId] = {};
        current[bayId][stroke.id] = stroke;
        for (const expiredId of getExpiredStrokeIds(
          current[bayId],
          stroke.drawnAt,
        )) {
          delete current[bayId][expiredId];
        }
      });
    }, [cursors.color, props.bay.id, setData]);

    return (
      <section id={props.id} ref={ref}>
        <CommuteSideView
          title="The fogged window"
          caption="drag across the glass · it fogs back over"
          onClose={props.onClose}
        >
          <div className="fogged-window">
            <div className="fogged-window__landscape" aria-hidden>
              <ProceduralLandscape
                seed={props.currentStop.id}
                phase="riding"
                edge="upper"
              />
            </div>
            <svg
              className="fogged-window__glass"
              viewBox={`0 0 ${PANE_WIDTH} ${PANE_HEIGHT}`}
              ref={surfaceRef}
              onPointerDown={startWipe}
              onPointerMove={continueWipe}
              onPointerUp={finishWipe}
              onPointerCancel={finishWipe}
              role="img"
              aria-label={`Fogged glass with ${visibleStrokes.length} wipes from other riders`}
            >
              <defs>
                <mask id={`fog-mask-${props.bay.id}`}>
                  <rect width={PANE_WIDTH} height={PANE_HEIGHT} fill="white" />
                  {visibleStrokes.map((stroke) => (
                    <polyline
                      key={stroke.id}
                      points={toPolylinePoints(
                        stroke.points,
                        PANE_WIDTH,
                        PANE_HEIGHT,
                      )}
                      fill="none"
                      stroke="black"
                      strokeWidth={26}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={getStrokeOpacity(stroke, now)}
                    />
                  ))}
                  {draft && (
                    <polyline
                      points={toPolylinePoints(draft, PANE_WIDTH, PANE_HEIGHT)}
                      fill="none"
                      stroke="black"
                      strokeWidth={26}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </mask>
              </defs>
              <rect
                width={PANE_WIDTH}
                height={PANE_HEIGHT}
                className="fogged-window__condensation"
                mask={`url(#fog-mask-${props.bay.id})`}
              />
              {visibleStrokes.map((stroke) => (
                <polyline
                  key={`edge-${stroke.id}`}
                  points={toPolylinePoints(
                    stroke.points,
                    PANE_WIDTH,
                    PANE_HEIGHT,
                  )}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={getStrokeOpacity(stroke, now) * 0.4}
                />
              ))}
            </svg>
          </div>
          <p className="fogged-window__caption">
            {visibleStrokes.length === 0
              ? "nobody has wiped this pane lately — the glass is yours"
              : `last wiped ${describeAge(
                  visibleStrokes[visibleStrokes.length - 1].drawnAt,
                  now,
                )} · ${visibleStrokes.length} ${
                  visibleStrokes.length === 1 ? "wipe" : "wipes"
                } still showing`}
          </p>
        </CommuteSideView>
      </section>
    );
  },
);
