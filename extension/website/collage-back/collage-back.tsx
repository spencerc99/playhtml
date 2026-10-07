// ABOUTME: Renders a collage's front and its real back face side by side, with the back-look sliders.
// ABOUTME: Starts from a built-in test collage; drop or pick a .collage.json to tune on a real one.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CollageBackFace } from "@extension/entrypoints/scraps/CollageBackFace";
import { BackLookTuner } from "@extension/entrypoints/scraps/BackLookTuner";
import {
  BACK_LOOK,
  type BackLook,
  type CollageBackContent,
} from "@extension/entrypoints/scraps/collageBack";
import { bakeCollage } from "@extension/entrypoints/scraps/bakeCollage";
import { readCollageFile } from "@extension/entrypoints/scraps/collageFile";
import {
  normalizeStack,
  type BackShows,
  type CollageRecord,
} from "@extension/entrypoints/scraps/collageRecord";
import { testCollage } from "./testCollage";

/** Room kept beside the faces for the page margins and the sliders. */
const BENCH_CHROME = 360;

/** The scale that fits both faces across the window, never above half size. */
function useBenchScale(frameWidth: number): number {
  const fit = () => Math.min(0.5, (window.innerWidth - BENCH_CHROME) / (frameWidth * 2));
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const onResize = () => setScale(fit());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [frameWidth]);
  return scale;
}

/** Just the studio rules the back face relies on, without its 3D turn. */
const BACK_FACE_STYLES = `
  .collage-back { position: relative; overflow: hidden; box-shadow: 0 10px 34px rgba(61, 56, 51, 0.16); }
  .collage-back__text { position: absolute; inset: 0; }
  .collage-back__text--titled .collage-back__title { visibility: hidden; }
  .collage-back__title-field {
    position: absolute; box-sizing: border-box; margin: 0; padding: 0; border: 0;
    outline: none; background: transparent; overflow: hidden; resize: none;
  }
`;

function Face({
  frame,
  scale,
  label,
  children,
}: {
  frame: { width: number; height: number };
  scale: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ marginBottom: 6 }}>{label}</figcaption>
      <div
        style={{
          width: frame.width * scale,
          height: frame.height * scale,
        }}
      >
        <div
          style={{
            width: frame.width,
            height: frame.height,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {children}
        </div>
      </div>
    </figure>
  );
}

function Bench() {
  const [collage, setCollage] = useState<CollageRecord>(testCollage);
  const [front, setFront] = useState<Blob | null>(null);
  const [frontUrl, setFrontUrl] = useState<string | null>(null);
  const [look, setLook] = useState<BackLook>(BACK_LOOK);
  const [problem, setProblem] = useState<string | null>(null);
  const [paperColor, setPaperColor] = useState(collage.paper.color);
  const [title, setTitle] = useState(collage.title);
  // A collage stored before the back could list titles has always shown pieces.
  const [shows, setShows] = useState<BackShows>(collage.backShows ?? "pieces");

  const paper = useMemo(
    () => ({ ...collage.paper, color: paperColor }),
    [collage.paper, paperColor],
  );

  // A collage file carries the picture it was saved with, and its pieces may
  // point at images this page cannot draw, so that picture is used as the
  // front. The test collage is drawn here, so the paper color can be tried.
  useEffect(() => {
    let cancelled = false;
    setProblem(null);
    const draw =
      collage === testCollage || !collage.preview.drawn
        ? bakeCollage({
            frame: collage.frame,
            pieces: collage.pieces,
            paper: paper.color,
            grain: paper.grain,
          })
        : Promise.resolve(collage.preview.image);
    draw
      .then((blob) => {
        if (!cancelled) setFront(blob);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProblem(
            `the front could not be drawn — ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [collage, paper]);

  useEffect(() => {
    if (!front) return;
    const url = URL.createObjectURL(front);
    setFrontUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [front]);

  const content = useMemo<CollageBackContent>(
    () => ({
      title,
      createdAt: collage.createdAt,
      changedAt: collage.updatedAt,
      pieces: normalizeStack(collage.pieces),
      shows,
    }),
    [collage, shows, title],
  );

  const open = useCallback(async (file: File) => {
    try {
      const record = readCollageFile(await file.text());
      setCollage(record);
      setPaperColor(record.paper.color);
      setTitle(record.title);
      setShows(record.backShows ?? "pieces");
    } catch (error) {
      setProblem(
        `${file.name} could not be opened — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  const scale = useBenchScale(collage.frame.width);

  const onProblem = useCallback((text: string) => setProblem(text), []);

  return (
    <main
      style={{ padding: 20, paddingRight: 300, minHeight: "100vh", boxSizing: "border-box" }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) void open(file);
      }}
    >
      <style>{BACK_FACE_STYLES}</style>
      <header
        style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}
      >
        <strong>collage back bench</strong>
        <label>
          open .collage.json{" "}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void open(file);
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setCollage(testCollage);
            setPaperColor(testCollage.paper.color);
            setTitle(testCollage.title);
            setShows(testCollage.backShows ?? "pieces");
          }}
        >
          test collage
        </button>
        <label>
          back lists{" "}
          <select
            value={shows}
            onChange={(event) => setShows(event.target.value as BackShows)}
          >
            <option value="pieces">pieces</option>
            <option value="titles">titles</option>
          </select>
        </label>
        <label>
          front paper{" "}
          <input
            type="color"
            value={paperColor}
            disabled={collage !== testCollage}
            onChange={(event) => setPaperColor(event.target.value)}
          />
        </label>
        <span>or drop a file anywhere</span>
      </header>
      {problem && <p style={{ color: "#b0452c" }}>{problem}</p>}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <Face frame={collage.frame} scale={scale} label="front">
          {frontUrl && (
            <img
              src={frontUrl}
              alt=""
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          )}
        </Face>
        <Face frame={collage.frame} scale={scale} label="back">
          <CollageBackFace
            frame={collage.frame}
            paper={paper}
            content={content}
            look={look}
            front={front}
            showing
            onProblem={onProblem}
            onTitle={setTitle}
          />
        </Face>
      </div>

      <BackLookTuner look={look} onLook={setLook} />
    </main>
  );
}

createRoot(document.getElementById("reactContent")!).render(<Bench />);
