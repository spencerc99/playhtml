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
import {
  canStartIntroScroll,
  getIntroScrollY,
  INTRO_CONTENT_SETTLE_MS,
  INTRO_FADE_DURATION_MS,
  INTRO_SCROLL_DURATION_MS,
} from "./intro";

interface CellData {
  letter: string;
  color: string;
  timestamp: number;
}

type IntroState = "loading" | "scrolling" | "fading" | "hidden";

const PLAYER_COLORS = [
  { name: "red", value: "hsl(0, 70%, 60%)" },
  { name: "orange", value: "hsl(25, 70%, 60%)" },
  { name: "green", value: "hsl(137, 44%, 52%)" },
  { name: "blue", value: "hsl(221, 83%, 53%)" },
  { name: "purple", value: "hsl(267, 70%, 60%)" },
  { name: "pink", value: "hsl(296, 70%, 60%)" },
];

const Main = withSharedState(
  {
    defaultData: {
      letters: [] as CellData[],
    },
    myDefaultAwareness: undefined as undefined | TypingCursorAwareness,
  },
  ({ data, setData, awareness, myAwareness, setMyAwareness }) => {
    const { cursors, isLoading } = usePlayContext();
    const myColor = cursors.color;
    const gridRef = useRef<HTMLDivElement>(null);
    const bottomBarRef = useRef<HTMLDivElement>(null);
    const shouldFollowScrollEndRef = useRef(false);
    const introStartedRef = useRef(false);
    const [gridDimensions, setGridDimensions] = useState({
      cols: 60,
      rows: 40,
    });
    const [hasMeasuredGrid, setHasMeasuredGrid] = useState(false);
    const [hasSettledContent, setHasSettledContent] = useState(false);
    const [introState, setIntroState] = useState<IntroState>("loading");
    const [bottomBarHeightPx, setBottomBarHeightPx] =
      useState(BOTTOM_BAR_HEIGHT_PX);

    useLayoutEffect(() => {
      window.scrollTo(0, 0);
    }, []);

    // Keep the viewport pinned while the loading cover is up so the tall paper
    // can lay out underneath without the user scrolling ahead of the intro.
    useEffect(() => {
      if (introState !== "loading") return;

      const { body, documentElement } = document;
      const previousBodyOverflow = body.style.overflow;
      const previousHtmlOverflow = documentElement.style.overflow;
      body.style.overflow = "hidden";
      documentElement.style.overflow = "hidden";
      window.scrollTo(0, 0);

      return () => {
        body.style.overflow = previousBodyOverflow;
        documentElement.style.overflow = previousHtmlOverflow;
      };
    }, [introState]);

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
        setHasMeasuredGrid(true);
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

    // Wait until synced letter data has been applied and the grid height is
    // quiet. Starting earlier animates a short empty page, then jumps to the
    // real bottom once letters hydrate (can-play setup is a parent effect and
    // may hash the element id asynchronously before applying store data).
    useEffect(() => {
      if (isLoading || !hasMeasuredGrid) {
        setHasSettledContent(false);
        return;
      }

      const settleTimeout = window.setTimeout(() => {
        setHasSettledContent(true);
      }, INTRO_CONTENT_SETTLE_MS);

      return () => {
        window.clearTimeout(settleTimeout);
      };
    }, [isLoading, hasMeasuredGrid, data.letters.length, totalCells]);

    // Leave the loading cover only after content has settled so the scroll
    // animation effect below measures the full paper with overflow unlocked.
    useEffect(() => {
      if (introState !== "loading") return;
      if (
        !canStartIntroScroll({
          isLoading,
          hasMeasuredGrid,
          hasSettledContent,
        })
      ) {
        return;
      }

      setIntroState("scrolling");
    }, [hasMeasuredGrid, hasSettledContent, introState, isLoading]);

    useEffect(() => {
      if (introState !== "scrolling" || introStartedRef.current) return;

      introStartedRef.current = true;

      // Content has settled; capture the destination once so easing stays smooth.
      const destinationY = getScrollEndY({
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
      });
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      const durationMs = reducedMotion ? 0 : INTRO_SCROLL_DURATION_MS;
      let animationFrame = 0;
      let fadeTimeout = 0;
      let startTime: number | undefined;

      const finishIntro = () => {
        window.scrollTo(0, destinationY);
        shouldFollowScrollEndRef.current = true;
        setIntroState("fading");
        fadeTimeout = window.setTimeout(() => {
          shouldFollowScrollEndRef.current = true;
          setIntroState("hidden");
        }, reducedMotion ? 800 : INTRO_FADE_DURATION_MS);
      };

      const animateScroll = (timestamp: number) => {
        startTime ??= timestamp;
        const elapsedMs = timestamp - startTime;
        window.scrollTo(
          0,
          getIntroScrollY({ destinationY, elapsedMs, durationMs })
        );

        if (elapsedMs < durationMs) {
          animationFrame = window.requestAnimationFrame(animateScroll);
          return;
        }

        finishIntro();
      };

      window.scrollTo(0, 0);
      if (reducedMotion) {
        finishIntro();
      } else {
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = window.requestAnimationFrame(animateScroll);
        });
      }

      return () => {
        window.cancelAnimationFrame(animationFrame);
        window.clearTimeout(fadeTimeout);
      };
    }, [introState]);

    useLayoutEffect(() => {
      if (introState !== "hidden") return;
      if (!shouldFollowScrollEndRef.current) return;

      window.scrollTo(
        0,
        getScrollEndY({
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
        })
      );
    }, [totalCells, bottomBarHeightPx, introState]);

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

    const [editingIdentity, setEditingIdentity] = useState(false);
    const [nameInput, setNameInput] = useState(cursors.name || "");
    const inputRef = useRef<HTMLInputElement>(null);

    const handleNameSubmit = () => {
      if (nameInput.trim()) {
        window.cursors.name = nameInput.trim();
      }
    };

    const openIdentityEditor = () => {
      setNameInput(cursors.name || "");
      setEditingIdentity(true);
    };

    // Update input width to match content
    useEffect(() => {
      if (inputRef.current && editingIdentity) {
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
    }, [nameInput, editingIdentity, cursors.name]);

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
        {introState === "loading" && (
          <div
            className="loading-screen"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <p>loading the paper…</p>
          </div>
        )}
        {(introState === "scrolling" || introState === "fading") && (
          <section
            className={`intro-message ${
              introState === "fading" ? "fading" : ""
            }`}
            aria-labelledby="intro-title"
            aria-describedby="intro-description"
          >
            <h1 id="intro-title">single grid paper</h1>
            <p id="intro-description">
              A website where we share a single piece of paper to type on.
              everything you type appears in your color. No backspaces! Have fun
              and be nice
            </p>
          </section>
        )}
        <div
          ref={gridRef}
          className="grid-container"
          aria-hidden={introState === "loading"}
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
                  <>
                    <button
                      type="button"
                      className="player-name"
                      onClick={openIdentityEditor}
                      aria-expanded={editingIdentity}
                      aria-controls="identity-editor"
                    >
                      {cursors.name || "you"}
                    </button>
                    {editingIdentity && (
                      <div id="identity-editor" className="identity-editor">
                        <label htmlFor="identity-name">name</label>
                        <input
                          ref={inputRef}
                          id="identity-name"
                          type="text"
                          value={nameInput}
                          onChange={(e) => setNameInput(e.target.value)}
                          onBlur={handleNameSubmit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleNameSubmit();
                              setEditingIdentity(false);
                            } else if (e.key === "Escape") {
                              setNameInput(cursors.name || "");
                              setEditingIdentity(false);
                            }
                          }}
                          className="name-input"
                        />
                        <span>color</span>
                        <div className="color-options">
                          {PLAYER_COLORS.map((color) => (
                            <button
                              key={color.value}
                              type="button"
                              className="color-option"
                              style={{ backgroundColor: color.value }}
                              onClick={() => {
                                window.cursors.color = color.value;
                              }}
                              aria-label={`Use ${color.name}`}
                              aria-pressed={myColor === color.value}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          className="identity-editor-close"
                          onClick={() => {
                            handleNameSubmit();
                            setEditingIdentity(false);
                          }}
                          aria-label="Close name and color settings"
                        >
                          done
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <span>{"·"}</span>
                )}
              </div>
            ))}
          </div>
          <p className="experiment-attribution">
            this is <a href="/experiments">experiment 8</a> made with{" "}
            <a href="/">playhtml</a>
          </p>
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
