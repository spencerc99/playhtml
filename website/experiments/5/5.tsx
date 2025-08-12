import "./5.scss";
import React, { useEffect, useMemo, useState, useRef } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState } from "@playhtml/react";

interface Minute {
  colors: string[];
  lastChangedTs: number;
}

const MAX_COLORS_PER_MINUTE = 9;
const MINUTES_IN_DAY = 24 * 60;
const MIN_CELL_WIDTH = 80; // minimum width of each cell in pixels

function formatSeconds(seconds: number): string {
  return seconds.toString().padStart(2, "0");
}

function getSecondsSinceLastUpdate(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / 1000);
}

function generateRandomColor(): string {
  const hue = Math.floor(Math.random() * 360);
  const saturation = Math.floor(Math.random() * 30) + 70; // 70-100%
  const lightness = Math.floor(Math.random() * 30) + 35; // 35-65%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function formatMinuteOfDay(minuteIndex: number): string {
  const hour = Math.floor(minuteIndex / 60);
  const minute = minuteIndex % 60;
  return `${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
}

function createColorBars(colors: string[]): string {
  if (!colors || colors.length === 0) return "#ffffff";
  if (colors.length === 1) return colors[0];

  // Create vertical bars by setting each color to an equal width
  const width = 100 / colors.length;
  const stops = colors.map((color, index) => {
    const start = width * index;
    const end = width * (index + 1);
    return `${color} ${start}%, ${color} ${end}%`;
  });

  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function createColorGrid(colors: string[]): string {
  if (!colors || colors.length === 0) return "#ffffff";
  if (colors.length === 1) return colors[0];

  // For 2-3 colors, make vertical bars
  if (colors.length <= 3) {
    const width = 100 / colors.length;
    const stops = colors.map((color, index) => {
      const start = width * index;
      const end = width * (index + 1);
      return `${color} ${start}%, ${color} ${end}%`;
    });
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }

  // For 4+ colors, create a 3x3 grid using multiple background images
  const gridColors = [...colors];
  while (gridColors.length < 9) {
    gridColors.push(gridColors[gridColors.length - 1]); // Repeat last color to fill grid
  }

  // Create individual color blocks
  const backgrounds = gridColors.map((color, index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    const x1 = (col * 33.333).toFixed(3);
    const x2 = ((col + 1) * 33.333).toFixed(3);
    const y1 = (row * 33.333).toFixed(3);
    const y2 = ((row + 1) * 33.333).toFixed(3);

    return `linear-gradient(${color}, ${color}) ${x1}% ${y1}% / 33.333% 33.333% no-repeat`;
  });

  return backgrounds.join(", ");
}

function calculateGridDimensions(
  windowWidth: number,
  windowHeight: number
): [number, number] {
  // We want to find dimensions that:
  // 1. Fill the screen completely
  // 2. Have cells as close to square as possible
  // 3. Have enough cells for all minutes (1440)
  // 4. Minimize extra empty cells

  const aspectRatio = windowWidth / windowHeight;
  const totalCells = MINUTES_IN_DAY; // 1440

  let bestColumns = 0;
  let bestRows = 0;
  let bestEmptyCells = Infinity;

  // Try different column counts
  for (let cols = 30; cols <= 60; cols++) {
    // Calculate rows needed for this many columns
    const rows = Math.ceil(totalCells / cols);

    // Calculate cell dimensions
    const cellWidth = windowWidth / cols;
    const cellHeight = windowHeight / rows;

    // Calculate how square the cells would be (1.0 = perfect square)
    const cellAspectRatio = Math.abs(cellWidth / cellHeight - 1);

    // Calculate empty cells
    const emptyCells = cols * rows - totalCells;

    // Score this configuration (lower is better)
    const score = emptyCells + cellAspectRatio * 10;

    if (score < bestEmptyCells) {
      bestEmptyCells = score;
      bestColumns = cols;
      bestRows = rows;
    }
  }

  return [bestColumns, bestRows];
}

function calculateNormalGridDimensions(
  containerWidth: number
): [number, number] {
  const minCols = Math.floor(containerWidth / MIN_CELL_WIDTH);

  // Find the best number of columns that will create a perfect rectangle
  for (let cols = minCols; cols <= minCols + 10; cols++) {
    const rows = Math.ceil(MINUTES_IN_DAY / cols);
    if (cols * rows === MINUTES_IN_DAY) {
      return [cols, rows];
    }
  }

  // If no perfect match found, find the closest that minimizes empty cells
  let bestCols = minCols;
  let bestRows = Math.ceil(MINUTES_IN_DAY / minCols);
  let minEmpty = bestCols * bestRows - MINUTES_IN_DAY;

  for (let cols = minCols + 1; cols <= minCols + 10; cols++) {
    const rows = Math.ceil(MINUTES_IN_DAY / cols);
    const empty = cols * rows - MINUTES_IN_DAY;
    if (empty < minEmpty) {
      minEmpty = empty;
      bestCols = cols;
      bestRows = rows;
    }
  }

  return [bestCols, bestRows];
}

function getCurrentMinuteIndex(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isDocumentFullscreen(): boolean {
  return !!(
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).mozFullScreenElement ||
    (document as any).msFullscreenElement
  );
}

function requestFullscreen(element: HTMLElement) {
  if (element.requestFullscreen) {
    element
      .requestFullscreen()
      .catch((err) =>
        console.log("Error attempting to enable fullscreen:", err)
      );
  } else if ((element as any).webkitRequestFullscreen) {
    (element as any).webkitRequestFullscreen();
  } else if ((element as any).msRequestFullscreen) {
    (element as any).msRequestFullscreen();
  }
}

function exitFullscreen() {
  if (isDocumentFullscreen()) {
    if (document.exitFullscreen) {
      document
        .exitFullscreen()
        .catch((err) =>
          console.log("Error attempting to exit fullscreen:", err)
        );
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    } else if ((document as any).msExitFullscreen) {
      (document as any).msExitFullscreen();
    }
  }
}

const Main = withSharedState(
  {
    defaultData: {
      minutes: Array(MINUTES_IN_DAY).fill(null) as Minute[],
    },
    myDefaultAwareness: undefined as undefined | { color: string },
    id: "main",
  },
  ({ data, setData, awareness, setMyAwareness }) => {
    const [currentColor, setCurrentColor] = useState(generateRandomColor());
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [currentSecond, setCurrentSecond] = useState(new Date().getSeconds());
    const [currentMinuteIndex, setCurrentMinuteIndex] = useState(
      getCurrentMinuteIndex()
    );
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [gridDimensions, setGridDimensions] = useState<[number, number]>([
      40, 36,
    ]);
    const currentMinuteRef = useRef<HTMLDivElement>(null);
    const mainRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Track fullscreen changes
    useEffect(() => {
      const handleFullscreenChange = () => {
        setIsFullscreen(isDocumentFullscreen());
      };

      document.addEventListener("fullscreenchange", handleFullscreenChange);
      document.addEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange
      );
      document.addEventListener("mozfullscreenchange", handleFullscreenChange);
      document.addEventListener("MSFullscreenChange", handleFullscreenChange);

      return () => {
        document.removeEventListener(
          "fullscreenchange",
          handleFullscreenChange
        );
        document.removeEventListener(
          "webkitfullscreenchange",
          handleFullscreenChange
        );
        document.removeEventListener(
          "mozfullscreenchange",
          handleFullscreenChange
        );
        document.removeEventListener(
          "MSFullscreenChange",
          handleFullscreenChange
        );
      };
    }, []);

    // Update grid dimensions when window size changes
    useEffect(() => {
      const updateDimensions = () => {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          if (isFullscreen) {
            setGridDimensions(calculateGridDimensions(rect.width, rect.height));
          } else {
            setGridDimensions(calculateNormalGridDimensions(rect.width));
          }
        }
      };

      updateDimensions();
      window.addEventListener("resize", updateDimensions);
      return () => window.removeEventListener("resize", updateDimensions);
    }, [isFullscreen]);

    const toggleFullscreen = async () => {
      try {
        if (!isFullscreen) {
          if (!mainRef.current) {
            console.error("Main element ref not found");
            return;
          }
          await requestFullscreen(mainRef.current);
        } else {
          await exitFullscreen();
        }
      } catch (error) {
        console.error("Error toggling fullscreen:", error);
      }
    };

    // Add debug effect to check ref
    useEffect(() => {
      console.log("Main ref:", mainRef.current);
    }, [mainRef.current]);

    // Scroll helper function
    const scrollToCurrentMinute = (behavior: ScrollBehavior = "smooth") => {
      if (currentMinuteRef.current) {
        const scrollOptions: ScrollIntoViewOptions = {
          behavior,
          block: "center" as const,
        };

        try {
          currentMinuteRef.current.scrollIntoView(scrollOptions);
        } catch (e) {
          // Fallback for browsers that don't support smooth scroll
          currentMinuteRef.current.scrollIntoView({ block: "center" as const });
        }
      }
    };

    // Remove initial scroll effect and keep only the minute change scroll
    useEffect(() => {
      const timer = setInterval(() => {
        const now = new Date();
        const newMinuteIndex = getCurrentMinuteIndex();
        setCurrentSecond(now.getSeconds());

        if (newMinuteIndex !== currentMinuteIndex) {
          setCurrentMinuteIndex(newMinuteIndex);
          setShowColorPicker(false);
          // Use a small delay to ensure DOM updates
          setTimeout(() => scrollToCurrentMinute(), 50);
        }
      }, 1000);

      return () => clearInterval(timer);
    }, [currentMinuteIndex]);

    const addColorToMinute = (color: string) => {
      const newMinutes = [...data.minutes];
      const currentMinute = newMinutes[currentMinuteIndex] || {
        colors: [],
        lastChangedTs: Date.now(),
      };

      let newColors = [...(currentMinute.colors || [])];
      if (newColors.length >= MAX_COLORS_PER_MINUTE) {
        // Remove the oldest color (first in the array) and add the new one
        newColors = newColors.slice(1);
      }
      newColors.push(color);

      newMinutes[currentMinuteIndex] = {
        colors: newColors,
        lastChangedTs: Date.now(),
      };

      setData({ minutes: newMinutes });
      setMyAwareness({ color });
      setCurrentColor(generateRandomColor());
    };

    const renderMinuteBox = (minuteIndex: number) => {
      const minute = data.minutes[minuteIndex];
      const timeLabel = formatMinuteOfDay(minuteIndex);
      const isCurrentMinute = minuteIndex === currentMinuteIndex;
      const pulseColor =
        minute?.colors?.[minute.colors.length - 1] || currentColor;
      const colors = minute?.colors || [];

      const getColorGridClass = (count: number) => {
        switch (count) {
          case 0:
            return "";
          case 1:
            return "full";
          case 2:
          case 3:
          case 5:
            return "vertical-bars";
          case 4:
            return "grid-2x2";
          case 6:
            return "grid-2x3";
          case 7:
            return "grid-3-2-2";
          case 8:
            return "grid-3-3-2";
          case 9:
            return "grid-3x3";
          default:
            return "grid-3x3";
        }
      };

      return (
        <div
          key={minuteIndex}
          ref={isCurrentMinute ? currentMinuteRef : null}
          className={`minute-box ${isCurrentMinute ? "current" : ""}`}
          style={{
            background: colors.length === 0 ? "#ffffff" : undefined,
            color: pulseColor,
          }}
          onClick={() => {
            if (isCurrentMinute) {
              setShowColorPicker(true);
            }
          }}
          title={isCurrentMinute ? "Click to add color!" : timeLabel}
        >
          <div className={`color-grid ${getColorGridClass(colors.length)}`}>
            {colors.map((color, i) => (
              <div
                key={i}
                className="color-cell"
                style={{ background: color }}
              />
            ))}
          </div>
          <span className="time-label">
            {timeLabel}
            {isCurrentMinute && (
              <>
                <span className="seconds">:{formatSeconds(currentSecond)}</span>
                {minute?.lastChangedTs && (
                  <span className="last-update">
                    +{getSecondsSinceLastUpdate(minute.lastChangedTs)}s
                  </span>
                )}
              </>
            )}
          </span>
        </div>
      );
    };

    return (
      <div id="main" className={isFullscreen ? "fullscreen" : ""}>
        <div
          className={`experiment-description ${isFullscreen ? "hidden" : ""}`}
        >
          <h1>minute faces (together)</h1>
          <p>
            It is now {formatMinuteOfDay(currentMinuteIndex)}. Every minute may
            be colored in only during that minute.
            <br />
            <button
              className="scroll-to-now"
              onClick={() => scrollToCurrentMinute()}
            >
              scroll to now
            </button>
            &nbsp;&nbsp;
            <button className="toggle-fullscreen" onClick={toggleFullscreen}>
              view fullscreen
            </button>
          </p>
        </div>

        {showColorPicker && !isFullscreen && (
          <div className="color-picker-container">
            <button
              className="close-button"
              onClick={() => setShowColorPicker(false)}
            >
              ×
            </button>
            <h2>Coloring {formatMinuteOfDay(currentMinuteIndex)}</h2>
            <div
              className="color-preview"
              style={{ background: currentColor }}
              onClick={() => {
                const input = document.querySelector(
                  'input[type="color"]'
                ) as HTMLInputElement;
                input?.click();
              }}
            />
            <div className="color-picker-buttons">
              <button
                className="randomize"
                onClick={() => setCurrentColor(generateRandomColor())}
              >
                🎲
              </button>
              <input
                type="color"
                value={currentColor}
                onChange={(e) => setCurrentColor(e.target.value)}
              />
            </div>
            <button
              className="add-color-button"
              onClick={() => addColorToMinute(currentColor)}
              style={
                {
                  "--button-color": currentColor,
                } as React.CSSProperties
              }
            >
              <span className="button-text">Add Color</span>
            </button>
          </div>
        )}

        <div ref={containerRef} className="grid-container">
          <div
            ref={mainRef}
            className={`all-minutes-grid ${isFullscreen ? "fullscreen" : ""}`}
            style={{
              gridTemplateColumns: `repeat(${gridDimensions[0]}, 1fr)`,
              gridTemplateRows: `repeat(${gridDimensions[1]}, 1fr)`,
            }}
          >
            {Array.from(
              { length: gridDimensions[0] * gridDimensions[1] },
              (_, i) =>
                i < MINUTES_IN_DAY ? (
                  renderMinuteBox(i)
                ) : (
                  <div key={`empty-${i}`} className="minute-box empty" />
                )
            )}
          </div>
        </div>

        <footer className={isFullscreen ? "hidden" : ""}>
          <div>
            <a href="https://playhtml.fun/experiments">playhtml experiment</a>{" "}
            <a href="https://github.com/spencerc99/playhtml/blob/main/website/experiments/5/">
              "05"
            </a>
          </div>
        </footer>
      </div>
    );
  }
);

const AnimatedCounter = ({ start, end, duration = 1500 }) => {
  const direction = start < end ? "up" : "down";
  const [counter, setCounter] = useState(start);

  useEffect(() => {
    let startTime = null;
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const value =
        direction === "up"
          ? Math.floor(progress * (end - start) + start)
          : Math.ceil(start - progress * (start - end));
      setCounter(value);
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(window.requestAnimationFrame(step));
    };
  }, [start, end, duration, direction]);

  return <span>{counter}</span>;
};

// Website with a shared color.
ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider>
    <Main></Main>
  </PlayProvider>
);
