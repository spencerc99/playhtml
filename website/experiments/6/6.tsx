import "./6.scss";
import React, { useEffect, useMemo, useState, useRef, useContext, useCallback } from "react";
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

    // Zoom helper function
    const updateZoom = useCallback((newZoom: number) => {
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
    }, [currentSize.width, currentSize.height]);

    // Prevent scroll on body and handle it for zooming
    useEffect(() => {
      const handleScroll = (e: Event) => {
        e.preventDefault();
        return false;
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        // Prevent arrow keys, space, page up/down from scrolling
        if (['ArrowUp', 'ArrowDown', 'Space', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.code)) {
          e.preventDefault();
          
          // Convert key presses to zoom
          const zoomFactor = e.code === 'ArrowUp' || e.code === 'PageUp' ? 1.1 : 
                            e.code === 'ArrowDown' || e.code === 'PageDown' ? 0.9 : 1;
          if (zoomFactor !== 1) {
            updateZoom(targetZoom * zoomFactor);
          }
        }
      };

      // Add event listeners to prevent scrolling and handle keyboard zoom
      window.addEventListener('scroll', handleScroll, { passive: false });
      window.addEventListener('keydown', handleKeyDown, { passive: false });
      document.body.addEventListener('scroll', handleScroll, { passive: false });
      document.documentElement.addEventListener('scroll', handleScroll, { passive: false });

      return () => {
        window.removeEventListener('scroll', handleScroll);
        window.removeEventListener('keydown', handleKeyDown);
        document.body.removeEventListener('scroll', handleScroll);
        document.documentElement.removeEventListener('scroll', handleScroll);
      };
    }, [targetZoom, updateZoom]);

    // Mouse wheel zoom with snapping (centered zooming only)
    const handleWheel = useCallback((e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;
      const zoomFactor = delta > 0 ? 0.9 : 1.1;
      updateZoom(targetZoom * zoomFactor);
    }, [targetZoom, updateZoom]);

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

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
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
    }, [isPanning, lastTouchDistance, panStartY, targetZoom, updateZoom]);

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

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (!isPanning) return;
      e.preventDefault();
      
      const deltaY = panStartY - e.clientY;
      const sensitivity = 0.003;
      const zoomDelta = deltaY * sensitivity;
      updateZoom(targetZoom * (1 + zoomDelta));
      setPanStartY(e.clientY);
    }, [isPanning, panStartY, targetZoom, updateZoom]);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      setIsPanning(false);
      setPanStartY(0);
    }, []);

    // Get all unique sizes sorted by area (largest first for proper nesting)
    const allSizes = useMemo(() => {
      return Object.values(data.sizes).sort(
        (a, b) => b.width * b.height - a.width * a.height
      );
    }, [data.sizes]);

    // Memoized screen rectangle component for performance
    const ScreenRectangle = useCallback(({ size, index, zoom, isCurrentSize }: {
      size: ScreenSize;
      index: number;
      zoom: number;
      isCurrentSize: boolean;
    }) => {
      const color = ALBERS_COLORS[index % ALBERS_COLORS.length];
      const scaledWidth = size.width * zoom;
      const scaledHeight = size.height * zoom;

      // Find nearest device for label (memoized)
      const nearestDevice = useMemo(() => findNearestDeviceSize(size.width, size.height), [size.width, size.height]);
      const isExactMatch = nearestDevice.width === size.width && nearestDevice.height === size.height;
      
      // Pre-format strings to avoid recalculation
      const modelId = useMemo(() => 
        isExactMatch 
          ? nearestDevice.name.toUpperCase().replace(/[^A-Z0-9]/g, '')
          : `~${nearestDevice.name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`,
        [nearestDevice.name, isExactMatch]
      );
      
      const timeString = useMemo(() => 
        new Date(size.lastSeen).toLocaleTimeString('en-US', { 
          hour12: false, 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        [size.lastSeen]
      );

      return (
        <div
          key={getScreenSizeKey(size.width, size.height)}
          className={`screen-rectangle ${isCurrentSize ? "current" : ""}`}
          style={{
            width: scaledWidth,
            height: scaledHeight,
            backgroundColor: color,
            opacity: isCurrentSize ? 1 : 0.7,
            border: isCurrentSize ? `3px solid ${color}` : `1px solid ${color}`,
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: `translate(-50%, -50%)`,
            zIndex: index + 1,
          }}
        >
          <div className="equipment-labels">
            <div className="equipment-header">
              <span className="model-id">{modelId}</span>
              <span className="dimensions">{size.width}×{size.height}</span>
            </div>
            
            <div className="equipment-stats">
              <div className="stat-row">
                <span className="stat-label">CNT</span>
                <span className="stat-value">{size.count.toString().padStart(3, '0')}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">DPR</span>
                <span className="stat-value">{size.deviceInfo.pixelRatio.toFixed(1)}×</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">LST</span>
                <span className="stat-value">{timeString}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }, []);

    // Render nested rectangles
    const renderScreenSizes = useMemo(() => {
      if (allSizes.length === 0) return null;

      const currentSizeKey = getScreenSizeKey(currentSize.width, currentSize.height);
      
      return allSizes.map((size, index) => (
        <ScreenRectangle
          key={getScreenSizeKey(size.width, size.height)}
          size={size}
          index={index}
          zoom={zoom}
          isCurrentSize={getScreenSizeKey(size.width, size.height) === currentSizeKey}
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
            cursor: isPanning ? 'ns-resize' : 'default',
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
