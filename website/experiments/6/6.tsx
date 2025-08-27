import "./6.scss";
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useContext,
  useCallback,
} from "react";
import ReactDOM from "react-dom/client";
import {
  PlayProvider,
  withSharedState,
  PlayContext,
  usePlayContext,
} from "@playhtml/react";

interface DeviceInfo {
  userAgent: string;
  pixelRatio: number;
  platform: string;
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  deviceType?: string;
  language?: string;
  timezone?: string;
}

interface ScreenSize {
  width: number;
  height: number;
  count: number;
  timestamps: number[];
  deviceInfo: DeviceInfo;
  lastSeen: number;
}

interface ScreenSizeData {
  sizes: Record<string, ScreenSize>;
}

// Generate descriptive screen size names
function getScreenSizeName(width: number, height: number): string {
  const area = width * height;
  const aspectRatio = (width / height).toFixed(2);

  if (area < 500000) {
    return "MOBILE";
  } else if (area < 1000000) {
    return "TABLET";
  } else if (area < 2000000) {
    return "LAPTOP";
  } else {
    return "DESKTOP";
  }
}

// Josef Albers inspired color palette
const ALBERS_COLORS = [
  "#FF6B35", // Orange
  "#F7931E", // Yellow-orange
  "#FFD23F", // Yellow
  "#06FFA5", // Green
  "#118AB2", // Blue
  "#073B4C", // Dark blue
  "#EF476F", // Pink
  "#B7094C", // Dark pink
  "#A663CC", // Purple
  "#4E148C", // Dark purple
  "#2E86AB", // Light blue
  "#A23B72", // Burgundy
];

function getCurrentDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent;

  // Parse browser info
  let browser = "Unknown";
  let browserVersion = "";

  if (ua.includes("Chrome") && !ua.includes("Edg")) {
    browser = "Chrome";
    browserVersion = ua.match(/Chrome\/([0-9.]+)/)?.[1] || "";
  } else if (ua.includes("Firefox")) {
    browser = "Firefox";
    browserVersion = ua.match(/Firefox\/([0-9.]+)/)?.[1] || "";
  } else if (ua.includes("Safari") && !ua.includes("Chrome")) {
    browser = "Safari";
    browserVersion = ua.match(/Version\/([0-9.]+)/)?.[1] || "";
  } else if (ua.includes("Edg")) {
    browser = "Edge";
    browserVersion = ua.match(/Edg\/([0-9.]+)/)?.[1] || "";
  }

  // Parse OS info
  let os = "Unknown";
  let osVersion = "";

  if (ua.includes("Windows")) {
    os = "Windows";
    osVersion = ua.match(/Windows NT ([0-9.]+)/)?.[1] || "";
  } else if (ua.includes("Mac OS X")) {
    os = "macOS";
    osVersion = ua.match(/Mac OS X ([0-9_]+)/)?.[1]?.replace(/_/g, ".") || "";
  } else if (ua.includes("Linux")) {
    os = "Linux";
  } else if (ua.includes("iPhone")) {
    os = "iOS";
    osVersion = ua.match(/OS ([0-9_]+)/)?.[1]?.replace(/_/g, ".") || "";
  } else if (ua.includes("Android")) {
    os = "Android";
    osVersion = ua.match(/Android ([0-9.]+)/)?.[1] || "";
  }

  // Determine device type
  let deviceType = "Desktop";
  if (ua.includes("Mobile") || ua.includes("iPhone")) {
    deviceType = "Mobile";
  } else if (ua.includes("Tablet") || ua.includes("iPad")) {
    deviceType = "Tablet";
  }

  return {
    userAgent: ua,
    pixelRatio: window.devicePixelRatio || 1,
    platform: navigator.platform || "Unknown",
    browser: browser !== "Unknown" ? browser : undefined,
    browserVersion: browserVersion ? browserVersion.split(".")[0] : undefined, // Just major version
    os: os !== "Unknown" ? os : undefined,
    osVersion: osVersion
      ? osVersion.split(".").slice(0, 2).join(".")
      : undefined, // Major.minor
    deviceType: deviceType !== "Desktop" ? deviceType : undefined, // Only show if not default
    language: navigator.language || undefined,
    timezone: (() => {
      try {
        return (
          Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop() ||
          undefined
        );
      } catch {
        return undefined;
      }
    })(),
  };
}

function getScreenSizeKey(width: number, height: number): string {
  return `${width}x${height}`;
}

const Main = withSharedState(
  {
    defaultData: {
      sizes: {} as Record<string, ScreenSize>,
    } as ScreenSizeData,
    myDefaultAwareness: undefined as undefined | { currentSize: string },
    id: "screen-symphony-2",
  },
  ({ data, setData, setMyAwareness }) => {
    const { hasSynced } = usePlayContext();
    const [currentSize, setCurrentSize] = useState({ width: 0, height: 0 });
    const [isResizing, setIsResizing] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [targetZoom, setTargetZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const [lastTouchDistance, setLastTouchDistance] = useState(0);
    const [panStartY, setPanStartY] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Track current screen size and register device
    useEffect(() => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setCurrentSize({ width, height });

      const sizeKey = getScreenSizeKey(width, height);
      setMyAwareness({ currentSize: sizeKey });

      // Only register this device once after sync is complete
      if (hasSynced) {
        const localStorageKey = `screen-symphony-${sizeKey}`;
        const hasVisited = localStorage.getItem(localStorageKey);

        if (!hasVisited) {
          const deviceInfo = getCurrentDeviceInfo();
          const timestamp = Date.now();

          console.log("setting data", sizeKey);
          setData((draft) => {
            if (!draft.sizes[sizeKey]) {
              draft.sizes[sizeKey] = {
                width,
                height,
                count: 0,
                timestamps: [],
                deviceInfo,
                lastSeen: timestamp,
              };
            }

            const size = draft.sizes[sizeKey];
            size.count++;
            size.timestamps.push(timestamp);
            size.lastSeen = timestamp;
            size.deviceInfo = deviceInfo;
          });

          // Mark this device as visited
          localStorage.setItem(localStorageKey, timestamp.toString());
        }
      }
    }, [hasSynced]);

    // Handle resize events with debouncing (update current size but don't re-register)
    useEffect(() => {
      const handleResize = () => {
        // Clear existing timeout
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }

        // Show resizing state immediately
        setIsResizing(true);

        // Update current size immediately for visual feedback
        const width = window.innerWidth;
        const height = window.innerHeight;
        setCurrentSize({ width, height });

        // Debounce the final registration and awareness update
        resizeTimeoutRef.current = setTimeout(() => {
          const sizeKey = getScreenSizeKey(width, height);
          setMyAwareness({ currentSize: sizeKey });
          setIsResizing(false);
        }, 500); // Wait 500ms after user stops resizing
      };

      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
      };
    }, []);

    // Smooth zoom animation
    useEffect(() => {
      let animationId: number;
      const animate = () => {
        setZoom((prev) => {
          const diff = targetZoom - prev;
          const newZoom = prev + diff * 0.1;
          if (Math.abs(diff) > 0.001) {
            animationId = requestAnimationFrame(animate);
          }
          return newZoom;
        });
      };
      animate();
      return () => cancelAnimationFrame(animationId);
    }, [targetZoom]);

    // Get all unique sizes sorted by area (largest first for proper nesting)
    const allSizes = useMemo(() => {
      return Object.values(data.sizes).sort(
        (a, b) => b.width * b.height - a.width * a.height
      );
    }, [data.sizes]);

    // Zoom helper function with dynamic max zoom based on largest screen size
    const updateZoom = useCallback(
      (newZoom: number) => {
        // Calculate max zoom based on largest screen size with padding
        let maxZoom = 5; // Default fallback

        if (
          allSizes.length > 0 &&
          currentSize.width > 0 &&
          currentSize.height > 0
        ) {
          const largestSize = allSizes[0]; // Already sorted by area, largest first
          const paddingFactor = 1.2; // 20% padding around the largest rectangle

          const maxZoomByWidth =
            (currentSize.width * 0.9) / (largestSize.width * paddingFactor);
          const maxZoomByHeight =
            (currentSize.height * 0.9) / (largestSize.height * paddingFactor);

          maxZoom = Math.min(maxZoomByWidth, maxZoomByHeight, 5); // Cap at 5x for safety
        }

        setTargetZoom(Math.max(0.1, Math.min(maxZoom, newZoom)));
      },
      [allSizes, currentSize.width, currentSize.height]
    );

    // Prevent scroll on body and handle it for zooming
    useEffect(() => {
      const handleScroll = (e: Event) => {
        e.preventDefault();
        return false;
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        // Prevent arrow keys, space, page up/down from scrolling
        if (
          [
            "ArrowUp",
            "ArrowDown",
            "Space",
            "PageUp",
            "PageDown",
            "Home",
            "End",
          ].includes(e.code)
        ) {
          e.preventDefault();

          // Convert key presses to zoom
          const zoomFactor =
            e.code === "ArrowUp" || e.code === "PageUp"
              ? 1.1
              : e.code === "ArrowDown" || e.code === "PageDown"
              ? 0.9
              : 1;
          if (zoomFactor !== 1) {
            updateZoom(targetZoom * zoomFactor);
          }
        }
      };

      // Add event listeners to prevent scrolling and handle keyboard zoom
      window.addEventListener("scroll", handleScroll, { passive: false });
      window.addEventListener("keydown", handleKeyDown, { passive: false });
      document.body.addEventListener("scroll", handleScroll, {
        passive: false,
      });
      document.documentElement.addEventListener("scroll", handleScroll, {
        passive: false,
      });

      return () => {
        window.removeEventListener("scroll", handleScroll);
        window.removeEventListener("keydown", handleKeyDown);
        document.body.removeEventListener("scroll", handleScroll);
        document.documentElement.removeEventListener("scroll", handleScroll);
      };
    }, [targetZoom, updateZoom]);

    // Mouse wheel zoom with snapping (centered zooming only)
    const handleWheel = useCallback(
      (e: React.WheelEvent) => {
        const delta = e.deltaY;
        const zoomFactor = delta > 0 ? 0.9 : 1.1;
        updateZoom(targetZoom * zoomFactor);
      },
      [targetZoom, updateZoom]
    );

    // Touch/pan gesture handlers
    const getTouchDistance = (touches: TouchList) => {
      if (touches.length < 2) return 0;
      const touch1 = touches[0];
      const touch2 = touches[1];
      return Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) +
          Math.pow(touch2.clientY - touch1.clientY, 2)
      );
    };

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
      e.preventDefault();
      setIsPanning(true);

      if (e.touches.length === 2) {
        // Pinch gesture
        setLastTouchDistance(getTouchDistance(e.touches));
      } else if (e.touches.length === 1) {
        // Single finger pan for zoom
        setPanStartY(e.touches[0].clientY);
      }
    }, []);

    const handleTouchMove = useCallback(
      (e: React.TouchEvent) => {
        e.preventDefault();
        if (!isPanning) return;

        if (e.touches.length === 2) {
          // Pinch zoom
          const currentDistance = getTouchDistance(e.touches);
          if (lastTouchDistance > 0) {
            const scale = currentDistance / lastTouchDistance;
            updateZoom(targetZoom * scale);
          }
          setLastTouchDistance(currentDistance);
        } else if (e.touches.length === 1) {
          // Pan gesture zoom (vertical movement)
          const deltaY = panStartY - e.touches[0].clientY;
          const sensitivity = 0.005;
          const zoomDelta = deltaY * sensitivity;
          updateZoom(targetZoom * (1 + zoomDelta));
          setPanStartY(e.touches[0].clientY);
        }
      },
      [isPanning, lastTouchDistance, panStartY, targetZoom, updateZoom]
    );

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
      e.preventDefault();
      setIsPanning(false);
      setLastTouchDistance(0);
      setPanStartY(0);
    }, []);

    // Mouse pan gesture handlers (for trackpads)
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only left mouse button
      e.preventDefault();
      setIsPanning(true);
      setPanStartY(e.clientY);
    }, []);

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        if (!isPanning) return;
        e.preventDefault();

        const deltaY = panStartY - e.clientY;
        const sensitivity = 0.003;
        const zoomDelta = deltaY * sensitivity;
        updateZoom(targetZoom * (1 + zoomDelta));
        setPanStartY(e.clientY);
      },
      [isPanning, panStartY, targetZoom, updateZoom]
    );

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      setIsPanning(false);
      setPanStartY(0);
    }, []);

    // Memoized screen rectangle component for performance
    const ScreenRectangle = useCallback(
      ({
        size,
        index,
        zoom,
        isCurrentSize,
      }: {
        size: ScreenSize;
        index: number;
        zoom: number;
        isCurrentSize: boolean;
      }) => {
        const color = ALBERS_COLORS[index % ALBERS_COLORS.length];
        const scaledWidth = size.width * zoom;
        const scaledHeight = size.height * zoom;

        // Generate device name based on screen size
        const deviceName = useMemo(
          () => getScreenSizeName(size.width, size.height),
          [size.width, size.height]
        );

        const timeString = useMemo(
          () =>
            new Date(size.lastSeen).toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
            }),
          [size.lastSeen]
        );

        return (
          <div
            key={getScreenSizeKey(size.width, size.height)}
            className={`screen-rectangle ${
              isCurrentSize ? "current" : ""
            } animate-in`}
            style={{
              width: scaledWidth,
              height: scaledHeight,
              backgroundColor: color,
              opacity: isCurrentSize ? 1 : 0.7,
              border: isCurrentSize
                ? `3px solid ${color}`
                : `1px solid ${color}`,
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(-50%, -50%)`,
              zIndex: index + 1,
              animationDelay: `${(allSizes.length - 1 - index) * 1000}ms`, // Smaller rectangles first
            }}
          >
            <div className="equipment-labels">
              {/* Top edge - Device identification */}
              <div className="label-top">
                <span className="device-id">{deviceName}</span>
                <span className="dimensions">
                  {size.width}×{size.height}
                </span>
              </div>

              {/* Right edge - System info */}
              <div className="label-right">
                {size.deviceInfo.os && (
                  <div className="info-block">
                    <span className="label">OS</span>
                    <span className="value">
                      {size.deviceInfo.os.toUpperCase()}
                    </span>
                    {size.deviceInfo.osVersion && (
                      <span className="sub">{size.deviceInfo.osVersion}</span>
                    )}
                  </div>
                )}
                {size.deviceInfo.deviceType && (
                  <div className="info-block">
                    <span className="label">TYPE</span>
                    <span className="value">
                      {size.deviceInfo.deviceType.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>

              {/* Bottom edge - Usage stats */}
              <div className="label-bottom">
                <span className="stat">
                  CNT:{size.count.toString().padStart(3, "0")}
                </span>
                <span className="stat">
                  DPR:{size.deviceInfo.pixelRatio.toFixed(1)}×
                </span>
                {size.deviceInfo.language && (
                  <span className="stat">
                    LANG:{size.deviceInfo.language.toUpperCase()}
                  </span>
                )}
              </div>

              {/* Left edge - Browser & time info */}
              <div className="label-left">
                {size.deviceInfo.browser && (
                  <div className="info-block">
                    <span className="label">BROWSER</span>
                    <span className="value">
                      {size.deviceInfo.browser.toUpperCase()}
                    </span>
                    {size.deviceInfo.browserVersion && (
                      <span className="sub">
                        V{size.deviceInfo.browserVersion}
                      </span>
                    )}
                  </div>
                )}
                <div className="info-block">
                  <span className="label">LAST</span>
                  <span className="value">{timeString}</span>
                  {size.deviceInfo.timezone && (
                    <span className="sub">{size.deviceInfo.timezone}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      },
      []
    );

    // Render nested rectangles
    const renderScreenSizes = useMemo(() => {
      if (allSizes.length === 0) return null;

      const currentSizeKey = getScreenSizeKey(
        currentSize.width,
        currentSize.height
      );

      return allSizes.map((size, index) => (
        <ScreenRectangle
          key={getScreenSizeKey(size.width, size.height)}
          size={size}
          index={index}
          zoom={zoom}
          isCurrentSize={
            getScreenSizeKey(size.width, size.height) === currentSizeKey
          }
        />
      ));
    }, [allSizes, zoom, currentSize, ScreenRectangle]);

    return (
      <div id="main">
        {/* Title - top left */}
        <div className="title">
          <h1>screen symphony</h1>
        </div>

        {/* Full-screen visualization container */}
        <div
          ref={containerRef}
          className="visualization-container"
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            cursor: isPanning ? "ns-resize" : "default",
          }}
        >
          {renderScreenSizes}
        </div>

        {/* Floating controls - bottom right */}
        <div className="floating-controls">
          <div className="info-chips">
            <div className="chip current-size">
              {currentSize.width} × {currentSize.height}
              {isResizing && <span className="resize-dot">●</span>}
            </div>
            <div className="chip size-count">
              {allSizes.length} screen sizes
            </div>
            <div className="chip zoom-level">{(zoom * 100).toFixed(0)}%</div>
          </div>

          <div className="control-buttons">
            <button
              onClick={() => setTargetZoom(1)}
              disabled={isResizing}
              title="Reset Zoom"
            >
              Reset Zoom
            </button>
          </div>

          {isResizing && <div className="resize-status">Adjusting size...</div>}
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
