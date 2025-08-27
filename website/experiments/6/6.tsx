import "./6.scss";
import React, { useEffect, useMemo, useState, useRef, useContext } from "react";
import ReactDOM from "react-dom/client";
import {
  PlayProvider,
  withSharedState,
  PlayContext,
  usePlayContext,
} from "@playhtml/react";

interface ScreenSize {
  width: number;
  height: number;
  count: number;
  timestamps: number[];
  deviceInfo: {
    userAgent: string;
    pixelRatio: number;
    platform: string;
  };
  lastSeen: number;
}

interface ScreenSizeData {
  sizes: Record<string, ScreenSize>;
}

// Common device sizes for snapping
const DEVICE_SIZES = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 12", width: 390, height: 844 },
  { name: "iPhone 14 Pro Max", width: 430, height: 932 },
  { name: "iPad", width: 768, height: 1024 },
  { name: "iPad Pro", width: 1024, height: 1366 },
  { name: "MacBook Air", width: 1440, height: 900 },
  { name: 'MacBook Pro 14"', width: 1512, height: 982 },
  { name: 'MacBook Pro 16"', width: 1728, height: 1117 },
  { name: "Desktop HD", width: 1920, height: 1080 },
  { name: "Desktop QHD", width: 2560, height: 1440 },
  { name: "Desktop 4K", width: 3840, height: 2160 },
];

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

function getCurrentDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    pixelRatio: window.devicePixelRatio || 1,
    platform: navigator.platform,
  };
}

function getScreenSizeKey(width: number, height: number): string {
  return `${width}x${height}`;
}

function findNearestDeviceSize(width: number, height: number) {
  let closest = DEVICE_SIZES[0];
  let minDistance = Math.sqrt(
    Math.pow(width - closest.width, 2) + Math.pow(height - closest.height, 2)
  );

  for (const device of DEVICE_SIZES) {
    const distance = Math.sqrt(
      Math.pow(width - device.width, 2) + Math.pow(height - device.height, 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      closest = device;
    }
  }

  return closest;
}

const Main = withSharedState(
  {
    defaultData: {
      sizes: {} as Record<string, ScreenSize>,
    } as ScreenSizeData,
    myDefaultAwareness: undefined as undefined | { currentSize: string },
    id: "screen-symphony-1",
  },
  ({ data, setData, setMyAwareness }) => {
    const { hasSynced } = usePlayContext();
    const [currentSize, setCurrentSize] = useState({ width: 0, height: 0 });
    const [isResizing, setIsResizing] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [targetZoom, setTargetZoom] = useState(1);
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

    // Mouse wheel zoom with snapping (centered zooming only)
    const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;
      const zoomFactor = delta > 0 ? 0.9 : 1.1;
      let newZoom = targetZoom * zoomFactor;

      // Snap to device sizes when close
      for (const device of DEVICE_SIZES) {
        const deviceZoom = Math.min(
          device.width / currentSize.width,
          device.height / currentSize.height
        );
        if (Math.abs(newZoom - deviceZoom) < 0.1) {
          newZoom = deviceZoom;
          break;
        }
      }

      setTargetZoom(Math.max(0.1, Math.min(5, newZoom)));
    };

    // Get all unique sizes sorted by area (largest first for proper nesting)
    const allSizes = useMemo(() => {
      return Object.values(data.sizes).sort(
        (a, b) => b.width * b.height - a.width * a.height
      );
    }, [data.sizes]);

    // Render nested rectangles
    const renderScreenSizes = () => {
      if (allSizes.length === 0) return null;

      return allSizes.map((size, index) => {
        const color = ALBERS_COLORS[index % ALBERS_COLORS.length];
        const isCurrentSize =
          getScreenSizeKey(size.width, size.height) ===
          getScreenSizeKey(currentSize.width, currentSize.height);

        const scaledWidth = size.width * zoom;
        const scaledHeight = size.height * zoom;

        // Find nearest device for label
        const nearestDevice = findNearestDeviceSize(size.width, size.height);
        const isExactMatch =
          nearestDevice.width === size.width &&
          nearestDevice.height === size.height;

        return (
          <div
            key={getScreenSizeKey(size.width, size.height)}
            className={`screen-rectangle ${isCurrentSize ? "current" : ""}`}
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
              zIndex: index + 1, // Smaller rectangles (higher index) get higher z-index
            }}
          >
            {/* Labels around the viewport */}
            <div className="screen-label top-left">
              <div className="device-name">
                {isExactMatch ? nearestDevice.name : `~${nearestDevice.name}`}
              </div>
              <div className="dimensions">
                {size.width} × {size.height}
              </div>
            </div>

            <div className="screen-label top-right">
              <div className="count">×{size.count}</div>
              <div className="last-seen">
                {new Date(size.lastSeen).toLocaleTimeString()}
              </div>
            </div>

            <div className="screen-label bottom-left">
              <div className="platform">{size.deviceInfo.platform}</div>
              <div className="pixel-ratio">
                {size.deviceInfo.pixelRatio}× pixel ratio
              </div>
            </div>

            <div className="screen-label bottom-right">
              <div className="first-seen">
                First: {new Date(size.timestamps[0]).toLocaleTimeString()}
              </div>
              {size.timestamps.length > 1 && (
                <div className="session-count">
                  {size.timestamps.length} sessions
                </div>
              )}
            </div>
          </div>
        );
      });
    };

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
        >
          {renderScreenSizes()}
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
            <div className="chip zoom-level">
              {(zoom * 100).toFixed(0)}%
            </div>
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
          
          {isResizing && (
            <div className="resize-status">
              Adjusting size...
            </div>
          )}
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
