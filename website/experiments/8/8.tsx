// ABOUTME: Experiment 8 - Collaborative grid paper typing interface
// ABOUTME: Every grid cell is filled with typed letters, colored by user
import "./8.scss";
import React, { useEffect, useLayoutEffect, useState, useRef } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState, usePlayContext } from "@playhtml/react";
import { OnlineNowIndicator } from "../../components/DataModes";
import {
  BOTTOM_BAR_HEIGHT_PX,
  GRID_CELL_SIZE_PX,
  getBottomScrollClearancePx,
  getGridCellCount,
  getGridRowHeightPx,
  getGridWidthPx,
  getRemoteTypingCursors,
  getScrollEndY,
  getTypingCursorPosition,
  isScrollAtEnd,
  shouldPublishTypingAwareness,
  type TypingCursorAwareness,
} from "./layout";

interface CellData {
  letter: string;
  color: string;
  timestamp: number;
}

const Main = withSharedState(
  {
    defaultData: {
      letters: [] as CellData[],
    },
    myDefaultAwareness: undefined as undefined | TypingCursorAwareness,
  },
  ({ data, setData, awareness, myAwareness, setMyAwareness }) => {
    const { cursors } = usePlayContext();
    const myColor = cursors.color;
    const gridRef = useRef<HTMLDivElement>(null);
    const bottomBarRef = useRef<HTMLDivElement>(null);
    const shouldFollowScrollEndRef = useRef(true);
    const [gridDimensions, setGridDimensions] = useState({
      cols: 60,
      rows: 40,
    });
    const [bottomBarHeightPx, setBottomBarHeightPx] =
      useState(BOTTOM_BAR_HEIGHT_PX);

    // Calculate grid dimensions based on window size
    useEffect(() => {
      const calculateDimensions = () => {
        // Use a fixed cell size for square aspect ratio
        // Get value from CSS variable (e.g., "32px" -> 32)
        const cellSizeValue = getComputedStyle(document.body)
          .getPropertyValue("--cell-size")
          .trim();

        const cellWidth = parseFloat(cellSizeValue) || 32; // Fallback to 32 if parsing fails
        const cellHeight = cellWidth; // Match width for square cells
        const cols = Math.floor(window.innerWidth / cellWidth);
        const rows = Math.floor(window.innerHeight / cellHeight);
        setGridDimensions({ cols, rows });
      };

      calculateDimensions();
      window.addEventListener("resize", calculateDimensions);
      return () => window.removeEventListener("resize", calculateDimensions);
    }, []);

    useEffect(() => {
      const bottomBar = bottomBarRef.current;
      if (!bottomBar) return;

      const updateBottomBarHeight = () => {
        const nextHeight = Math.ceil(bottomBar.getBoundingClientRect().height);
        setBottomBarHeightPx((currentHeight) =>
          currentHeight === nextHeight ? currentHeight : nextHeight
        );
      };

      updateBottomBarHeight();

      const resizeObserver = new ResizeObserver(updateBottomBarHeight);
      resizeObserver.observe(bottomBar);
      window.addEventListener("resize", updateBottomBarHeight);

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener("resize", updateBottomBarHeight);
      };
    }, []);

    useEffect(() => {
      const updateScrollEndState = () => {
        shouldFollowScrollEndRef.current = isScrollAtEnd({
          scrollY: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
        });
      };

      updateScrollEndState();
      window.addEventListener("scroll", updateScrollEndState, { passive: true });
      window.addEventListener("resize", updateScrollEndState);

      return () => {
        window.removeEventListener("scroll", updateScrollEndState);
        window.removeEventListener("resize", updateScrollEndState);
      };
    }, []);

    // Minimum cells to fill the page
    const minCells = gridDimensions.cols * gridDimensions.rows;

    const totalCells = getGridCellCount({
      letterCount: data.letters.length,
      minimumCellCount: minCells,
      columnCount: gridDimensions.cols,
    });

    const cursorPosition = getTypingCursorPosition(data.letters.length);

    useLayoutEffect(() => {
      if (!shouldFollowScrollEndRef.current) return;

      window.scrollTo(
        0,
        getScrollEndY({
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
        })
      );
    }, [totalCells, bottomBarHeightPx]);

    useEffect(() => {
      const nextAwareness = { color: myColor, cursorPos: cursorPosition };

      if (
        shouldPublishTypingAwareness({
          current: myAwareness,
          next: nextAwareness,
        })
      ) {
        setMyAwareness(nextAwareness);
      }
    }, [myColor, cursorPosition, myAwareness, setMyAwareness]);

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

        // Handle all printable characters, space, and special characters
        // Accept any single character key
        if (e.key.length === 1) {
          e.preventDefault();
          const char = e.key;

          shouldFollowScrollEndRef.current = isScrollAtEnd({
            scrollY: window.scrollY,
            scrollHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
          });

          setData((draft) => {
            draft.letters.push({
              letter: char,
              color: myColor,
              timestamp: Date.now(),
            });
          });
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [myColor, setData]);

    const otherCursors = getRemoteTypingCursors({
      awareness: awareness || [],
      myAwareness,
    });

    // Get all active players from cursor awareness
    const activePlayers = cursors.allColors.map((color, index) => ({
      color,
      isMe: color === myColor,
    }));

    const [editingName, setEditingName] = useState(false);
    const [nameInput, setNameInput] = useState(cursors.name || "");
    const inputRef = useRef<HTMLInputElement>(null);

    const handleNameSubmit = () => {
      if (nameInput.trim()) {
        window.cursors.name = nameInput.trim();
      }
      setEditingName(false);
    };

    // Update input width to match content
    useEffect(() => {
      if (inputRef.current && editingName) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (context) {
          const styles = window.getComputedStyle(inputRef.current);
          context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
          const text = nameInput || cursors.name || "you";
          const width = context.measureText(text).width;
          // Add some padding for letter-spacing and safety
          inputRef.current.style.width = `${width + 20}px`;
        }
      }
    }, [nameInput, editingName, cursors.name]);

    return (
      <div
        id="experiment-8"
        style={
          {
            "--bottom-scroll-clearance": `${getBottomScrollClearancePx({
              bottomBarHeightPx,
            })}px`,
          } as React.CSSProperties
        }
      >
        <div
          ref={gridRef}
          className="grid-container"
          style={{
            gridTemplateColumns: `repeat(${gridDimensions.cols}, ${GRID_CELL_SIZE_PX}px)`,
            gridAutoRows: `${getGridRowHeightPx({
              cellSizePx: GRID_CELL_SIZE_PX,
            })}px`,
            width: `${getGridWidthPx({
              columnCount: gridDimensions.cols,
              cellSizePx: GRID_CELL_SIZE_PX,
            })}px`,
          }}
        >
          {Array.from({ length: totalCells }, (_, index) => {
            const letter = data.letters[index] || null;
            const isMyCursor = index === cursorPosition;
            const otherUserCursor = otherCursors.find(
              (c) => c.cursorPos === index
            );

            return (
              <div
                key={index}
                className={`grid-cell ${isMyCursor ? "my-cursor" : ""} ${
                  otherUserCursor ? "other-cursor" : ""
                } ${letter ? "filled" : "empty"}`}
                style={{
                  color: letter?.color || "transparent",
                  borderColor: isMyCursor
                    ? myColor
                    : otherUserCursor
                    ? otherUserCursor.color
                    : undefined,
                }}
              >
                {letter?.letter || "\u00A0"}
              </div>
            );
          })}
        </div>

        <div ref={bottomBarRef} className="bottom-bar">
          <div className="active-players">
            {activePlayers.map((player, index) => (
              <div
                key={index}
                className={`player-indicator ${player.isMe ? "me" : ""}`}
                style={{ backgroundColor: player.color }}
              >
                {player.isMe ? (
                  editingName ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onBlur={handleNameSubmit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleNameSubmit();
                        } else if (e.key === "Escape") {
                          setNameInput(cursors.name || "");
                          setEditingName(false);
                        }
                      }}
                      autoFocus
                      className="name-input"
                    />
                  ) : (
                    <span onClick={() => setEditingName(true)}>
                      {cursors.name || "you"}
                    </span>
                  )
                ) : (
                  <span>{"·"}</span>
                )}
              </div>
            ))}
          </div>
          <OnlineNowIndicator />
        </div>
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
    <Main />
  </PlayProvider>
);
