// ABOUTME: Experiment 8 - Collaborative grid paper typing interface
// ABOUTME: Every grid cell is filled with typed letters, colored by user
import "./8.scss";
import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState } from "@playhtml/react";

const GRID_COLS = 60;
const GRID_ROWS = 40;
const TOTAL_CELLS = GRID_COLS * GRID_ROWS;

interface CellData {
  letter: string;
  color: string;
  timestamp: number;
}

function generateRandomColor(): string {
  const hue = Math.floor(Math.random() * 360);
  const saturation = Math.floor(Math.random() * 30) + 70; // 70-100%
  const lightness = Math.floor(Math.random() * 30) + 40; // 40-70%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

const Main = withSharedState(
  {
    defaultData: {
      grid: Array(TOTAL_CELLS).fill(null) as (CellData | null)[],
    },
    myDefaultAwareness: undefined as undefined | { color: string; cursorPos: number },
    id: "main",
  },
  ({ data, setData, awareness, setMyAwareness }) => {
    const [myColor] = useState(generateRandomColor());
    const gridRef = useRef<HTMLDivElement>(null);

    // Find the next available cell (first empty cell going left-to-right, top-to-bottom)
    const getNextAvailableCell = (): number => {
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if (!data.grid[i]) {
          return i;
        }
      }
      return TOTAL_CELLS - 1; // Grid is full
    };

    const cursorPosition = getNextAvailableCell();

    // Initialize awareness with color
    useEffect(() => {
      setMyAwareness({ color: myColor, cursorPos: cursorPosition });
    }, [myColor, cursorPosition, setMyAwareness]);

    // Handle keyboard input
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Ignore if user is typing in an input field
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        ) {
          return;
        }

        // Handle backspace - remove the most recent letter
        if (e.key === "Backspace") {
          e.preventDefault();

          // Find the most recently added cell by this user
          let lastIndex = -1;
          let lastTimestamp = 0;

          for (let i = 0; i < TOTAL_CELLS; i++) {
            const cell = data.grid[i];
            if (cell && cell.color === myColor && cell.timestamp > lastTimestamp) {
              lastTimestamp = cell.timestamp;
              lastIndex = i;
            }
          }

          if (lastIndex >= 0) {
            setData((draft) => {
              draft.grid[lastIndex] = null;
            });
          }
          return;
        }

        // Handle printable characters - always add to next available cell
        if (e.key.length === 1) {
          e.preventDefault();
          const char = e.key.toUpperCase();

          // Only add if there's an available cell
          if (cursorPosition < TOTAL_CELLS && !data.grid[cursorPosition]) {
            setData((draft) => {
              draft.grid[cursorPosition] = {
                letter: char,
                color: myColor,
                timestamp: Date.now(),
              };
            });
          }
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [cursorPosition, myColor, setData, data.grid]);

    // Get other users' cursor positions
    const otherCursors = Object.entries(awareness || {})
      .filter(([clientId]) => clientId !== "local")
      .map(([, data]) => data as { color: string; cursorPos: number });

    // Count filled cells
    const filledCells = data.grid.filter((cell) => cell !== null).length;
    const percentageFilled = ((filledCells / TOTAL_CELLS) * 100).toFixed(1);

    return (
      <div id="main">
        <div
          className="color-indicator"
          style={{ backgroundColor: myColor }}
          title="Your color"
        >
          you
        </div>
        <div ref={gridRef} className="grid-container">
          {Array.from({ length: TOTAL_CELLS }, (_, index) => {
            const cell = data.grid[index];
            const isMyCursor = index === cursorPosition;
            const otherUserCursor = otherCursors.find(
              (c) => c.cursorPos === index
            );

            return (
              <div
                key={index}
                className={`grid-cell ${isMyCursor ? "my-cursor" : ""} ${
                  otherUserCursor ? "other-cursor" : ""
                } ${cell ? "filled" : "empty"}`}
                style={{
                  color: cell?.color || "transparent",
                  borderColor: isMyCursor
                    ? myColor
                    : otherUserCursor
                    ? otherUserCursor.color
                    : undefined,
                }}
              >
                {cell?.letter || "\u00A0"}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider>
    <Main />
  </PlayProvider>
);
