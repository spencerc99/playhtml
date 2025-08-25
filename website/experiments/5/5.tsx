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

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): string {
  // Convert hex to RGB first
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  // Then to HSL
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s,
    l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(
    l * 100
  )}%)`;
}

function generateRandomColor(): { hex: string; hsl: string } {
  const hue = Math.floor(Math.random() * 360);
  const saturation = Math.floor(Math.random() * 30) + 70; // 70-100%
  const lightness = Math.floor(Math.random() * 30) + 35; // 35-65%
  return {
    hex: hslToHex(hue, saturation, lightness),
    hsl: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
  };
}

function formatMinuteOfDay(minuteIndex: number): string {
  const hour = Math.floor(minuteIndex / 60);
  const minute = minuteIndex % 60;
  return `${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
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
    const totalColors = useMemo(() => {
      if (!data?.minutes) return 0;
      return data.minutes.reduce(
        (acc, minute) => acc + (minute?.colors?.length || 0),
        0
      );
    }, [data.minutes]);

    const filledMinutes = useMemo(() => {
      if (!data?.minutes) return 0;
      return data.minutes.reduce(
        (acc, minute) => acc + (minute?.colors?.length > 0 ? 1 : 0),
        0
      );
    }, [data.minutes]);

    const progressPercentage = useMemo(() => {
      return (filledMinutes / MINUTES_IN_DAY) * 100;
    }, [filledMinutes]);

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
      // Using mutator form for merge-friendly collaborative edits
      setData((draft) => {
        // Initialize the minute if it's null
        if (draft.minutes[currentMinuteIndex] === null) {
          // For SyncedStore, we need to use splice to properly initialize array elements
          draft.minutes.splice(currentMinuteIndex, 1, {
            colors: [],
            lastChangedTs: Date.now(),
          });
        }

        const currentMinute = draft.minutes[currentMinuteIndex];

        // Ensure colors array exists
        if (!currentMinute.colors) {
          currentMinute.colors = [];
        }

        // Remove oldest color if at max capacity
        if (currentMinute.colors.length >= MAX_COLORS_PER_MINUTE) {
          currentMinute.colors.splice(0, 1);
        }

        // Add new color and update timestamp
        currentMinute.colors.push(color);
        currentMinute.lastChangedTs = Date.now();
      });

      setMyAwareness({ color });
      setCurrentColor(generateRandomColor());
    };

    const renderMinuteBox = (minuteIndex: number) => {
      const minute = data.minutes[minuteIndex];
      const timeLabel = formatMinuteOfDay(minuteIndex);
      const isCurrentMinute = minuteIndex === currentMinuteIndex;
      const pulseColor =
        minute?.colors?.[minute.colors.length - 1] || currentColor.hsl;
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

    const renderGrid = () => {
      const currentHour = Math.floor(currentMinuteIndex / 60);
      const minutesInHour = 60;
      const hoursInDay = 24;

      // Create array of hour indices starting from current hour
      const hourOrder = Array.from(
        { length: hoursInDay },
        (_, i) => (currentHour + i) % hoursInDay
      );

      // Create array of all minute indices in the correct order
      const orderedMinutes = hourOrder.flatMap((hour) =>
        Array.from({ length: minutesInHour }, (_, i) => hour * 60 + i)
      );

      return (
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
                renderMinuteBox(orderedMinutes[i])
              ) : (
                <div key={`empty-${i}`} className="minute-box empty" />
              )
          )}
        </div>
      );
    };

    return (
      <div
        id="main"
        className={isFullscreen ? "fullscreen" : ""}
        style={{
          paddingBottom: isFullscreen ? "0" : "3rem",
        }}
      >
        <div
          className={`experiment-description ${isFullscreen ? "hidden" : ""}`}
        >
          <h1>minute faces (together)</h1>
          <p>
            It is currently {formatMinuteOfDay(currentMinuteIndex)}. Every
            minute can be colored only during that minute.{" "}
            <AnimatedCounter start={0} end={totalColors} duration={1500} />{" "}
            colors have been added.
          </p>
          <div className="progress-section">
            <div className="progress-text">
              <AnimatedCounter start={0} end={filledMinutes} duration={1500} />{" "}
              of {MINUTES_IN_DAY} minutes filled (
              {progressPercentage.toFixed(1)}%)
            </div>
            <div className="timeline-container">
              <div className="timeline-labels">
                <span className="timeline-label">00:00</span>
                <span className="timeline-label">06:00</span>
                <span className="timeline-label">12:00</span>
                <span className="timeline-label">18:00</span>
                <span className="timeline-label">23:59</span>
              </div>
              <div className="timeline-bar">
                {Array.from({ length: MINUTES_IN_DAY }, (_, minuteIndex) => {
                  const minute = data.minutes[minuteIndex];
                  const hasColors = minute?.colors && minute.colors.length > 0;
                  const primaryColor = hasColors
                    ? minute.colors[minute.colors.length - 1]
                    : undefined;

                  return (
                    <div
                      key={minuteIndex}
                      className={`timeline-minute ${
                        minuteIndex === currentMinuteIndex ? "current" : ""
                      }`}
                      style={{
                        background: primaryColor || "rgba(255, 255, 255, 0.1)",
                        opacity: hasColors ? 1 : 0.3,
                      }}
                      title={`${formatMinuteOfDay(minuteIndex)}${
                        hasColors
                          ? ` - ${minute.colors.length} color(s)`
                          : " - empty"
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
          <p>
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
            <input
              type="color"
              className="color-preview"
              value={currentColor.hex}
              onChange={(e) =>
                setCurrentColor({
                  hex: e.target.value,
                  hsl: hexToHsl(e.target.value),
                })
              }
            />
            <div
              style={{
                display: "flex",
                gap: ".5rem",
                alignItems: "center",
              }}
            >
              <button
                className="randomize"
                onClick={() => setCurrentColor(generateRandomColor())}
              >
                🎲
              </button>
              <button
                className="add-color-button"
                onClick={() => addColorToMinute(currentColor.hsl)}
                style={
                  {
                    "--button-color": currentColor.hsl,
                  } as React.CSSProperties
                }
              >
                <span className="button-text">Add Color</span>
              </button>
            </div>
          </div>
        )}

        <div ref={containerRef} className="grid-container">
          {renderGrid()}
        </div>

        <footer className={isFullscreen ? "hidden" : ""}>
          <div>
            sequel to <a href="https://clock.spencer.place">minute faces</a>
          </div>
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

const AnimatedCounter = ({
  start,
  end,
  duration = 1500,
}: {
  start: number;
  end: number;
  duration?: number;
}) => {
  const direction = start < end ? "up" : "down";
  const [counter, setCounter] = useState(start);

  useEffect(() => {
    let startTime: number | null = null;
    const step = (timestamp: number) => {
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
