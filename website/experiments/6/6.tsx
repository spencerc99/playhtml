import "./6.scss";
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState, usePlayContext } from "@playhtml/react";

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

// Memoized device name cache
const deviceNameCache = new Map<string, string>();

// Generate descriptive screen size names from device info - optimized with caching
function getScreenSizeName(deviceInfo: DeviceInfo): string {
  const key = `${deviceInfo.os}-${deviceInfo.deviceType}-${deviceInfo.browser}`;
  if (deviceNameCache.has(key)) {
    return deviceNameCache.get(key)!;
  }

  let name = "";

  // Start with device type if available
  if (deviceInfo.deviceType) {
    name = deviceInfo.deviceType.toUpperCase();
  } else if (deviceInfo.os) {
    // Infer device type from OS
    switch (deviceInfo.os.toLowerCase()) {
      case "ios":
        name = "MOBILE";
        break;
      case "android":
        name = deviceInfo.userAgent.includes("Mobile") ? "MOBILE" : "TABLET";
        break;
      case "macos":
        name = "MAC";
        break;
      case "windows":
        name = "PC";
        break;
      case "linux":
        name = "LINUX";
        break;
      default:
        name = "DEVICE";
    }
  } else {
    name = "DEVICE";
  }

  // Add OS version if available for specificity
  if (deviceInfo.osVersion) {
    name += ` ${deviceInfo.osVersion}`;
  }

  deviceNameCache.set(key, name);
  return name;
}

// Josef Albers inspired color generation
// Based on his geometric color theory: high contrast, bold saturation, vibrant composition
function generateAlbersColor(seed: string): string {
  // Use the screen size key as a seed for consistent colors per size
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Balanced Albers-inspired hue distribution
  const albersHueRanges = [
    [0, 20], // Pure reds
    [20, 40], // Red-oranges
    [40, 55], // Pure oranges
    [120, 150], // Greens
    [150, 180], // Green-cyans
    [180, 210], // Cyans
    [210, 250], // Blues
    [250, 280], // Blue-purples
    [280, 320], // Purples/magentas
  ];

  // Pick a hue range based on hash
  const rangeIndex = Math.abs(hash) % albersHueRanges.length;
  const [minHue, maxHue] = albersHueRanges[rangeIndex];
  const hue = minHue + (Math.abs(hash * 2) % (maxHue - minHue));

  // Higher saturation and smart lightness based on hue
  const saturation = 80 + (Math.abs(hash * 3) % 20); // 80-100%

  // Adjust lightness based on hue to avoid browns in reds/oranges only
  let lightness;
  if (hue <= 55) {
    // Reds and oranges only: keep in 45-65% range to avoid browns
    lightness = 45 + (Math.abs(hash * 5) % 20); // 45-65%
  } else {
    // All other colors including greens: can use wider range
    lightness = 35 + (Math.abs(hash * 5) % 40); // 35-75%
  }

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

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
    const [showIntro, setShowIntro] = useState(true);
    const [hasStarted, setHasStarted] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    // Track which rectangles have already appeared to prevent re-animation
    const appearedRectangles = useRef<Set<string>>(new Set());

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

    // Direct zoom - no animation for better performance
    useEffect(() => {
      setZoom(targetZoom);
    }, [targetZoom]);

    // Get all unique sizes sorted by area (largest first for proper nesting)
    const allSizes = useMemo(() => {
      return Object.values(data.sizes).sort(
        (a, b) => b.width * b.height - a.width * a.height
      );
    }, [data.sizes]);

    // Zoom helper function with proper min zoom based on largest screen size
    const updateZoom = useCallback(
      (newZoom: number) => {
        let minZoom = 0.1; // Default fallback
        const maxZoom = 5; // Fixed max zoom

        if (
          allSizes.length > 0 &&
          currentSize.width > 0 &&
          currentSize.height > 0
        ) {
          const largestSize = allSizes[0]; // Already sorted by area, largest first
          const paddingFactor = 1.05; // 5% padding around the largest rectangle

          // Calculate minimum zoom where largest rectangle fits with padding
          const minZoomByWidth =
            (currentSize.width * 0.95) / (largestSize.width * paddingFactor);
          const minZoomByHeight =
            (currentSize.height * 0.95) / (largestSize.height * paddingFactor);

          minZoom = Math.min(minZoomByWidth, minZoomByHeight);
        }

        setTargetZoom(Math.max(minZoom, Math.min(maxZoom, newZoom)));
      },
      [allSizes, currentSize.width, currentSize.height]
    );

    // Simplified keyboard controls for zooming
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Only handle specific zoom keys
        if (["ArrowUp", "ArrowDown"].includes(e.code)) {
          e.preventDefault();
          const zoomFactor = e.code === "ArrowUp" ? 1.1 : 0.9;
          updateZoom(targetZoom * zoomFactor);
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [targetZoom, updateZoom]);

    // Direct wheel handler - let container scaling handle performance
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

      if (e.touches.length === 1) {
        // Single finger pan for zoom
        setPanStartY(e.touches[0].clientY);
      }
    }, []);

    const handleTouchMove = useCallback(
      (e: React.TouchEvent) => {
        e.preventDefault();
        if (!isPanning) return;

        if (e.touches.length === 1) {
          // Pan gesture zoom (vertical movement) - reduced sensitivity for smoother interaction
          const deltaY = panStartY - e.touches[0].clientY;
          const sensitivity = 0.003;
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

    // Handle continue from intro
    const handleContinue = useCallback(() => {
      setShowIntro(false);
      setHasStarted(true);

      // Clear the appeared rectangles so they all animate in
      appearedRectangles.current.clear();
    }, []);

    // Screen rectangle component with all labels
    const ScreenRectangle = React.memo(
      ({
        size,
        index,
        isCurrentSize,
        shouldAnimate,
      }: {
        size: ScreenSize;
        index: number;
        isCurrentSize: boolean;
        shouldAnimate: boolean;
      }) => {
        const sizeKey = getScreenSizeKey(size.width, size.height);
        const color = generateAlbersColor(sizeKey);

        // Memoized computations
        const deviceName = useMemo(
          () => getScreenSizeName(size.deviceInfo),
          [size.deviceInfo]
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
            className={`screen-rectangle ${isCurrentSize ? "current" : ""} ${
              shouldAnimate ? "animate-in" : ""
            }`}
            style={{
              width: size.width,
              height: size.height,
              backgroundColor: color,
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(-50%, -50%)`,
              zIndex: index + 1,
              animationDelay: shouldAnimate
                ? `${(allSizes.length - 1 - index) * 200}ms`
                : "0ms", // Smaller rectangles first
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
      }
    );

    // Current size key - memoized to prevent recalculation
    const currentSizeKey = useMemo(
      () => getScreenSizeKey(currentSize.width, currentSize.height),
      [currentSize.width, currentSize.height]
    );

    // Render rectangles up to visible count, smallest first
    const renderScreenSizes = useMemo(() => {
      if (allSizes.length === 0) return null;

      // allSizes is sorted largest first, so we need to reverse and take from the end
      const smallestFirst = [...allSizes].reverse();

      return smallestFirst.map((size, index) => {
        const sizeKey = getScreenSizeKey(size.width, size.height);
        // Find the original index in allSizes for proper color/z-index
        const originalIndex = allSizes.findIndex(
          (s) => getScreenSizeKey(s.width, s.height) === sizeKey
        );

        // Check if this rectangle is new and should animate
        const shouldAnimate =
          hasStarted && !appearedRectangles.current.has(sizeKey);
        if (shouldAnimate) {
          appearedRectangles.current.add(sizeKey);
        }

        return (
          <ScreenRectangle
            key={sizeKey}
            size={size}
            index={originalIndex}
            isCurrentSize={sizeKey === currentSizeKey}
            shouldAnimate={shouldAnimate}
          />
        );
      });
    }, [allSizes, currentSizeKey, hasStarted]);

    // Render current rectangle for intro
    const renderCurrentRectangle = useMemo(() => {
      if (allSizes.length === 0) return null;

      const currentSizeKey = getScreenSizeKey(
        currentSize.width,
        currentSize.height
      );
      const currentSizeData = data.sizes[currentSizeKey];

      if (!currentSizeData) return null;

      const color = generateAlbersColor(currentSizeKey);
      const deviceName = getScreenSizeName(currentSizeData.deviceInfo);

      return (
        <div
          className="screen-rectangle current intro-rectangle"
          style={{
            width: Math.max(currentSize.width * 0.4, 400), // Larger to fit content
            height: Math.max(currentSize.height * 0.4, 300),
            backgroundColor: color,
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 1,
          }}
        >
          <div className="equipment-labels">
            <div className="label-top">
              <span className="device-id">{deviceName}</span>
              <span className="dimensions">
                {currentSize.width}×{currentSize.height}
              </span>
            </div>
          </div>

          <div className="intro-content-inside">
            <p>
              screen symphony is a collective visualization of screen sizes
              visiting this website. Each rectangle represents a unique screen
              resolution.
            </p>
            <ol>
              <li className="detail-item">
                <span>Zoom with scroll/pinch, pan with drag</span>
              </li>
              <li className="detail-item">
                <span>Rectangles appear as visitors join</span>
              </li>
            </ol>
            <button className="continue-button" onClick={handleContinue}>
              Begin Symphony
            </button>
          </div>
        </div>
      );
    }, [allSizes, currentSize, data.sizes]);

    return (
      <div id="main">
        {/* Title - always visible */}
        <div className="title">
          <h1>screen symphony</h1>
        </div>

        {/* Full-screen visualization container */}
        <div
          ref={containerRef}
          className="visualization-container"
          onWheel={showIntro ? undefined : handleWheel}
          onTouchStart={showIntro ? undefined : handleTouchStart}
          onTouchMove={showIntro ? undefined : handleTouchMove}
          onTouchEnd={showIntro ? undefined : handleTouchEnd}
          onMouseDown={showIntro ? undefined : handleMouseDown}
          onMouseMove={showIntro ? undefined : handleMouseMove}
          onMouseUp={showIntro ? undefined : handleMouseUp}
          onMouseLeave={showIntro ? undefined : handleMouseUp}
          style={{
            cursor: isPanning ? "ns-resize" : undefined,
          }}
        >
          {showIntro ? (
            // Intro state: show only current rectangle with content inside
            renderCurrentRectangle
          ) : (
            // Main state: show all rectangles with zoom
            <div
              className="zoom-container"
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: `translate3d(-50%, -50%, 0) scale3d(${zoom}, ${zoom}, 1)`,
                transformOrigin: "center center",
                width: "100%",
                height: "100%",
                backfaceVisibility: "hidden", // Force GPU acceleration
              }}
            >
              {renderScreenSizes}
            </div>
          )}
        </div>

        {/* Floating controls - always visible */}
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

          {!showIntro && (
            <div className="control-buttons">
              <button
                onClick={() => setTargetZoom(1)}
                disabled={isResizing}
                title="Reset Zoom"
              >
                Reset Zoom
              </button>
            </div>
          )}

          {isResizing && <div className="resize-status">Adjusting size...</div>}
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
      cursors: { enabled: true },
    }}
  >
    <Main />
  </PlayProvider>
);
