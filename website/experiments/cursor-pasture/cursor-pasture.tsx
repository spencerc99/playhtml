// ABOUTME: Entrypoint for the cursor pasture experiment.
// ABOUTME: Manages drawing flow, shared cursor state, and live cursor rendering.
import "./cursor-pasture.scss";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState, usePlayContext } from "@playhtml/react";
import { DrawingCanvas } from "./drawing-canvas";
import { PastureScene } from "./pasture-scene";
import {
  composeSvg,
  cssCursorFromStrokes,
  type CursorDrawing,
  type Stroke,
} from "./svg-utils";

const CursorPasture = withSharedState(
  {
    defaultData: {
      cursors: [] as CursorDrawing[],
    },
  },
  ({ data, setData }) => {
    const {
      hasSynced,
      configureCursors,
      cursorPresences,
      getMyPlayerIdentity,
    } = usePlayContext();
    const [showDrawing, setShowDrawing] = useState(false);
    const [hasCheckedIdentity, setHasCheckedIdentity] = useState(false);

    const myIdentity = hasSynced ? getMyPlayerIdentity() : null;
    const myPublicKey = myIdentity?.publicKey;

    const myCursor = useMemo(
      () => data.cursors.find((c) => c.creatorId === myPublicKey),
      [data.cursors, myPublicKey]
    );

    // Determine which creators are currently online
    const onlineCreatorIds = useMemo(() => {
      const ids = new Set<string>();
      cursorPresences.forEach((presence) => {
        const pk = presence.playerIdentity?.publicKey;
        if (pk) ids.add(pk);
      });
      return ids;
    }, [cursorPresences]);

    // On first load, check if user needs to draw
    useEffect(() => {
      if (!hasSynced || !myPublicKey || hasCheckedIdentity) return;
      setHasCheckedIdentity(true);
      if (!myCursor) {
        setShowDrawing(true);
      }
    }, [hasSynced, myPublicKey, myCursor, hasCheckedIdentity]);

    // Set own CSS cursor when we have a drawing
    useEffect(() => {
      if (myCursor && myCursor.strokes.length > 0) {
        document.body.style.cursor = cssCursorFromStrokes(myCursor.strokes);
      }
      return () => {
        document.body.style.cursor = "";
      };
    }, [myCursor]);

    // Configure custom cursor rendering for other users' live cursors
    useEffect(() => {
      if (!hasSynced) return;

      const cursorsMap = new Map(
        data.cursors.map((c) => [c.creatorId, c])
      );

      configureCursors({
        onCustomCursorRender: (_connectionId, element, playerIdentity) => {
          const publicKey = playerIdentity?.publicKey;
          if (!publicKey) return null;

          const drawing = cursorsMap.get(publicKey);
          if (drawing && drawing.strokes.length > 0) {
            const svg = composeSvg(drawing.strokes, 40);
            element.innerHTML = svg;
            element.style.pointerEvents = "none";
            return element;
          }
          return null;
        },
      });
    }, [hasSynced, data.cursors, configureCursors]);

    const handleDrawingComplete = useCallback(
      (strokes: Stroke[]) => {
        if (!myPublicKey || strokes.length === 0) return;

        setData((draft) => {
          const existingIdx = draft.cursors.findIndex(
            (c) => c.creatorId === myPublicKey
          );
          const newDrawing: CursorDrawing = {
            creatorId: myPublicKey,
            strokes,
            createdAt: Date.now(),
          };
          if (existingIdx >= 0) {
            draft.cursors.splice(existingIdx, 1, newDrawing);
          } else {
            draft.cursors.push(newDrawing);
          }
        });

        setShowDrawing(false);
      },
      [myPublicKey, setData]
    );

    return (
      <div id="pasture">
        <PastureScene
          cursors={data.cursors}
          onlineCreatorIds={onlineCreatorIds}
          myCreatorId={myPublicKey}
        />

        <div className="pasture-ui">
          <div className="online-count">
            {cursorPresences.size} cursor{cursorPresences.size !== 1 ? "s" : ""}{" "}
            roaming
          </div>
          <button
            className="redraw-button"
            onClick={() => setShowDrawing(true)}
          >
            re-draw
          </button>
        </div>

        {showDrawing && (
          <div className="drawing-overlay">
            <div className="drawing-modal">
              <DrawingCanvas
                onComplete={handleDrawingComplete}
                onCancel={myCursor ? () => setShowDrawing(false) : undefined}
                initialStrokes={myCursor?.strokes}
              />
            </div>
          </div>
        )}
      </div>
    );
  }
);

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider
    initOptions={{
      cursors: {
        enabled: true,
      },
    }}
  >
    <CursorPasture />
  </PlayProvider>
);
