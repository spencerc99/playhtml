// ABOUTME: Interactive bench element for the essay marginalia.
// ABOUTME: Tracks persistent sit count via shared state; tilted cursor on hover, auto-sit once per session.

import { useState, useEffect, useRef } from "react";
import { withSharedState, usePlayContext } from "@playhtml/react";
import styles from "./Bench.module.scss";

interface BenchData {
  sitCount: number;
}

interface BenchProps {
  id: string;
}

const SESSION_KEY = "wewere-bench-sat";

// Generate a tilted cursor SVG that preserves the user's cursor color
function getTiltedCursorUrl(color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(30 12 12)'><path d='M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86h6.3c.45 0 .67-.54.35-.85L5.86 3.21z' fill='${encodeURIComponent(color)}' stroke='white' stroke-width='1'/></g></svg>`;
  return `url("data:image/svg+xml,${svg}") 5 2, pointer`;
}

export const Bench = withSharedState<BenchData, any, BenchProps>(
  () => ({ defaultData: { sitCount: 0 } }),
  ({ data, setData }, props) => {
    const { cursors } = usePlayContext();
    const [hasSat, setHasSat] = useState(false);
    const hasSatRef = useRef(false);

    useEffect(() => {
      const sat = sessionStorage.getItem(SESSION_KEY) === "true";
      setHasSat(sat);
      hasSatRef.current = sat;
    }, []);

    const recordSit = () => {
      if (hasSatRef.current) return;
      hasSatRef.current = true;
      setHasSat(true);
      sessionStorage.setItem(SESSION_KEY, "true");
      setData((draft) => {
        draft.sitCount = (draft.sitCount ?? 0) + 1;
      });
    };

    const cursorColor = cursors.color || "#3d3833";
    const cursorStyle = { cursor: getTiltedCursorUrl(cursorColor) } as React.CSSProperties;

    return (
      <div
        id={props.id}
        className={styles.bench}
        style={cursorStyle}
        onMouseEnter={recordSit}
        onClick={recordSit}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") recordSit();
        }}
      >
        <img
          src="/red-park-bench-face-right.png"
          alt="A red park bench"
          className={styles.benchImg}
          draggable={false}
        />
        <span className={styles.sitCount}>
          {hasSat
            ? `you sat here${data.sitCount > 1 ? ` (${data.sitCount} have sat)` : ""}`
            : data.sitCount === 0
              ? "sit down?"
              : `${data.sitCount} ${data.sitCount === 1 ? "person has" : "people have"} sat here`}
        </span>
      </div>
    );
  },
);
