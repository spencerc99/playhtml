import "./7.scss";
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState, usePlayContext } from "@playhtml/react";

interface Star {
  id: string;
  colors: [string, string];
  connectionCount: number;
  position: { x: number; y: number };
  rotation: number;
  createdAt: number;
  lastInteraction: number;
}

interface HandHold {
  id: string;
  user1: any;
  user2: any;
  position1: { x: number; y: number };
  position2: { x: number; y: number };
  angle: number;
  startedAt: number;
}

interface StellarData {
  stars: Record<string, Star>;
}

interface StellarAwareness {
  activeHandHold?: HandHold;
}

// Generate a unique ID for a pair of users based on their colors
function getPairId(user1: any, user2: any): string {
  const getColor = (user: any) => {
    // For simulated users or real users, get the primary color
    if (user?.playerStyle?.colorPalette?.[0])
      return user.playerStyle.colorPalette[0]; // real user
    return "#ffffff"; // fallback
  };

  const color1 = getColor(user1);
  const color2 = getColor(user2);
  return [color1, color2].sort().join("-");
}

// Mix two colors to create a star color
function mixColors(color1: string, color2: string): string {
  // Simple color mixing - take average of RGB values
  const parseColor = (color: string) => {
    if (color.startsWith("hsl")) {
      // For HSL colors, extract hue and create a new color
      const hueMatch = color.match(/hsl\((\d+),/);
      if (hueMatch) {
        const hue = parseInt(hueMatch[1]);
        return `hsl(${hue}, 70%, 65%)`;
      }
    }
    return color;
  };

  return parseColor(color1); // For now, just use first color
}

// SVG Hand component using actual SVG files
const HandSVG: React.FC<{
  color: string;
  isLeft: boolean;
  position: { x: number; y: number };
  rotation?: number;
}> = ({ color, isLeft, position, rotation = 0 }) => {
  const [svgContent, setSvgContent] = useState<string>("");

  useEffect(() => {
    const loadSVG = async () => {
      try {
        const svgFile = isLeft ? "openhand.svg" : "closedhand.svg";
        const response = await fetch(`./${svgFile}`);
        const content = await response.text();
        setSvgContent(content);
      } catch (error) {
        console.warn("Could not load hand SVG:", error);
      }
    };
    loadSVG();
  }, [isLeft]);

  if (!svgContent) return null;

  return (
    <div
      className="hand-svg"
      style={
        {
          position: "absolute",
          left: position.x,
          top: position.y,
          transform: `translate(-50%, -50%) rotate(${rotation}rad) ${
            isLeft ? "scaleX(-1)" : ""
          }`,
          pointerEvents: "none",
          zIndex: 500,
          width: 40,
          height: 40,
          "--hand-color": color,
        } as React.CSSProperties
      }
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
};

// Star component with tooltip
const StarComponent: React.FC<{ star: Star }> = ({ star }) => {
  const [color1, color2] = star.colors;
  const [showTooltip, setShowTooltip] = useState(false);

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  // Create a slightly imperfect hand-drawn star path using the star's rotation as a seed
  const r = star.rotation || 0; // Ensure we have a valid number
  const handDrawnPath = `
    M10,${2 + Math.sin(r) * 0.5} 
    L${12 + Math.cos(r * 2) * 0.3},${8 + Math.sin(r * 3) * 0.4} 
    L${18 + Math.cos(r * 1.5) * 0.4},${8 + Math.sin(r * 2.5) * 0.3} 
    L${13.5 + Math.cos(r * 1.2) * 0.3},${12 + Math.sin(r * 1.8) * 0.4} 
    L${15.5 + Math.cos(r * 2.8) * 0.3},${18 + Math.sin(r * 1.3) * 0.4} 
    L${10 + Math.cos(r * 3.2) * 0.2},${14 + Math.sin(r * 2.2) * 0.3} 
    L${4.5 + Math.cos(r * 1.7) * 0.3},${18 + Math.sin(r * 2.7) * 0.3} 
    L${6.5 + Math.cos(r * 2.5) * 0.4},${12 + Math.sin(r * 1.5) * 0.3} 
    L${2 + Math.cos(r * 1.9) * 0.3},${8 + Math.sin(r * 2.9) * 0.4} 
    L${8 + Math.cos(r * 2.3) * 0.3},${8 + Math.sin(r * 1.1) * 0.3} Z
  `
    .replace(/\s+/g, " ")
    .trim();

  return (
    <div
      className="star"
      style={{
        position: "absolute",
        left: star.position.x,
        top: star.position.y,
        transform: `translate(-50%, -50%) rotate(${r}rad) scale(${
          0.9 + Math.sin(r * 4) * 0.1
        })`,
        opacity: Math.min(star.connectionCount / 5, 1),
        filter: `brightness(${100 + star.connectionCount * 20}%) hue-rotate(${
          r * 20
        }deg)`,
        cursor: "pointer",
        transition: "transform 0.3s ease",
        zIndex: 100,
        pointerEvents: "auto",
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <svg width="20" height="20" viewBox="0 0 20 20">
        <defs>
          <linearGradient
            id={`gradient-${star.id}`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" style={{ stopColor: color1, stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: color2, stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        <path
          d={handDrawnPath}
          fill={`url(#gradient-${star.id})`}
          stroke="#fff"
          strokeWidth="0.3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      {showTooltip && (
        <div
          className="star-tooltip"
          style={{
            position: "absolute",
            bottom: "30px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            color: "white",
            padding: "12px 16px",
            borderRadius: "16px",
            fontSize: "12px",
            whiteSpace: "nowrap",
            zIndex: 1000,
            boxShadow: `
              0 8px 32px rgba(0, 0, 0, 0.3),
              0 0 0 1px rgba(255, 255, 255, 0.1),
              inset 0 1px 0 rgba(255, 255, 255, 0.2)
            `,
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: color1,
                border: "1px solid rgba(255, 255, 255, 0.3)",
                boxShadow: `0 0 6px ${color1}60`,
              }}
            ></div>
            <span style={{ opacity: 0.8, fontSize: "10px" }}>×</span>
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: color2,
                border: "1px solid rgba(255, 255, 255, 0.3)",
                boxShadow: `0 0 6px ${color2}60`,
              }}
            ></div>
          </div>
          <div style={{ textAlign: "center", marginBottom: "4px", fontWeight: 500 }}>
            star #{Math.abs(star.id.split('').reduce((a, b) => { return a + b.charCodeAt(0); }, 0)) % 10000}
          </div>
          <div style={{ textAlign: "center", marginBottom: "6px", fontSize: "11px", opacity: 0.8 }}>
            {star.connectionCount} connection{star.connectionCount === 1 ? '' : 's'}
          </div>
          <div style={{ opacity: 0.7, fontSize: "11px", textAlign: "center", marginBottom: "2px" }}>
            First met: {formatTime(star.createdAt)}
          </div>
          <div style={{ opacity: 0.7, fontSize: "11px", textAlign: "center" }}>
            Last held: {formatTime(star.lastInteraction)}
          </div>
        </div>
      )}
    </div>
  );
};

const Main = withSharedState(
  {
    defaultData: {
      stars: {} as Record<string, Star>,
    } as StellarData,
    myDefaultAwareness: undefined as StellarAwareness | undefined,
    id: "stellar-connections",
  },
  ({ data, setData, awareness, setMyAwareness }) => {
    const { hasSynced, configureCursors } = usePlayContext();
    const [proximityUsers, setProximityUsers] = useState<Set<string>>(
      new Set()
    );
    const [activeHandHolds, setActiveHandHolds] = useState<
      Map<string, HandHold>
    >(new Map());
    const [testHandHold, setTestHandHold] = useState(false);
    const mainRef = useRef<HTMLDivElement>(null);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

    // Proximity handlers
    const handleProximityEntered = useCallback(
      (
        otherPlayer: any,
        positions?: {
          ours: { x: number; y: number };
          theirs: { x: number; y: number };
        },
        angle?: number
      ) => {
        console.log("Proximity entered!", otherPlayer, positions, angle);

        if (!otherPlayer) return;

        const connectionId =
          otherPlayer.publicKey || otherPlayer.connectionId || "unknown";
        setProximityUsers((prev) => new Set([...prev, connectionId]));

        // Use actual cursor positions if available, otherwise fallback to center
        const ourPos = positions?.ours || {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        };
        const theirPos = positions?.theirs || {
          x: window.innerWidth / 2 + 60,
          y: window.innerHeight / 2,
        };

        // Set hand hold in awareness with actual positions and angle
        const pairId = getPairId({ publicKey: "me" }, otherPlayer);
        const handHold: HandHold = {
          id: pairId,
          user1: { publicKey: "me" },
          user2: otherPlayer,
          position1: ourPos,
          position2: theirPos,
          angle: angle || 0,
          startedAt: Date.now(),
        };

        // Store locally for cursor hiding
        setActiveHandHolds((prev) => new Map(prev.set(connectionId, handHold)));
        setMyAwareness({ activeHandHold: handHold });

        // Create or brighten star
        if (hasSynced) {
          setData((draft) => {
            const starId = pairId;
            const myColor = "#4ecdc4";
            const otherColor = otherPlayer.playerStyle?.colorPalette?.[0];

            if (draft.stars[starId]) {
              // Increase connection count and update last interaction
              draft.stars[starId].connectionCount += 1;
              draft.stars[starId].lastInteraction = Date.now();
            } else {
              // Create new star at the midpoint between cursors
              const midX = (ourPos.x + theirPos.x) / 2;
              const midY = (ourPos.y + theirPos.y) / 2;

              draft.stars[starId] = {
                id: starId,
                colors: [myColor, otherColor],
                connectionCount: 1,
                position: {
                  x: midX,
                  y: midY,
                },
                rotation: Math.random() * Math.PI * 2,
                createdAt: Date.now(),
                lastInteraction: Date.now(),
              };
            }
          });
        }
      },
      [hasSynced, setData, setMyAwareness]
    );

    const handleProximityLeft = useCallback(
      (connectionId: string) => {
        console.log("Proximity left!", connectionId);

        setProximityUsers((prev) => {
          const next = new Set(prev);
          next.delete(connectionId);
          return next;
        });

        // Remove from local state
        setActiveHandHolds((prev) => {
          const next = new Map(prev);
          next.delete(connectionId);
          return next;
        });

        // Remove hand hold from awareness
        setMyAwareness({ activeHandHold: undefined });
      },
      [setMyAwareness]
    );

    // Custom cursor renderer to hide cursors that are hand-holding
    const customCursorRenderer = useCallback(
      (connectionId: string, element: HTMLElement) => {
        // If this cursor is part of an active hand hold, hide it
        if (activeHandHolds.has(connectionId)) {
          element.style.display = "none";
          return element;
        }
        return null; // Use default rendering
      },
      [activeHandHolds]
    );

    // Configure cursor proximity handlers
    useEffect(() => {
      configureCursors({
        onProximityEntered: handleProximityEntered,
        onProximityLeft: handleProximityLeft,
        onCustomCursorRender: customCursorRenderer,
      });
    }, [
      handleProximityEntered,
      handleProximityLeft,
      customCursorRenderer,
      configureCursors,
    ]);

    // Track mouse position
    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        setMousePosition({ x: e.clientX, y: e.clientY });
      };

      window.addEventListener("mousemove", handleMouseMove);
      return () => window.removeEventListener("mousemove", handleMouseMove);
    }, []);

    // Test hand hold toggle
    const toggleTestHandHold = useCallback(() => {
      if (!testHandHold) {
        // Create test hand hold
        const testUser = {
          publicKey: "test-user",
          name: "Test User",
          playerStyle: { colorPalette: ["#ff6b6b"] },
        };

        const pairId = getPairId({ publicKey: "me" }, testUser);
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

        const handHold: HandHold = {
          id: pairId,
          user1: { publicKey: "me" },
          user2: testUser,
          position1: { x: centerX - 50, y: centerY },
          position2: { x: centerX + 50, y: centerY },
          angle: 0, // Horizontal hold
          startedAt: Date.now(),
        };

        setMyAwareness({ activeHandHold: handHold });

        // Create or brighten star
        if (hasSynced) {
          setData((draft) => {
            const starId = pairId;
            const myColor = "#4ecdc4";
            const otherColor = "#ff6b6b";

            if (draft.stars[starId]) {
              draft.stars[starId].connectionCount += 1;
              draft.stars[starId].lastInteraction = Date.now();
            } else {
              const angle = Math.random() * Math.PI * 2;
              const distance = 150 + Math.random() * 300;

              draft.stars[starId] = {
                id: starId,
                colors: [myColor, otherColor],
                connectionCount: 1,
                position: {
                  x: centerX + Math.cos(angle) * distance,
                  y: centerY + Math.sin(angle) * distance,
                },
                rotation: Math.random() * Math.PI * 2,
                createdAt: Date.now(),
                lastInteraction: Date.now(),
              };
            }
          });
        }

        setTestHandHold(true);
      } else {
        // Remove test hand hold
        setMyAwareness({ activeHandHold: undefined });
        setTestHandHold(false);
      }
    }, [testHandHold, hasSynced, setData, setMyAwareness]);

    // Render stars
    const renderStars = useMemo(() => {
      return Object.values(data.stars).map((star) => (
        <StarComponent key={star.id} star={star} />
      ));
    }, [data.stars]);

    // Render hand holds from all users' awareness
    const renderHandHolds = useMemo(() => {
      const allHandHolds = awareness
        .map((user) => user.activeHandHold)
        .filter((handHold): handHold is HandHold => handHold !== undefined);

      return allHandHolds.map((handHold) => {
        const user1Color = "#4ecdc4"; // Should get from cursor system
        const user2Color =
          handHold.user2?.playerStyle?.colorPalette?.[0] || "#ff6b6b";

        // Calculate positions so hands appear to be holding
        const midX = (handHold.position1.x + handHold.position2.x) / 2;
        const midY = (handHold.position1.y + handHold.position2.y) / 2;
        const distance = Math.sqrt(
          Math.pow(handHold.position2.x - handHold.position1.x, 2) +
            Math.pow(handHold.position2.y - handHold.position1.y, 2)
        );
        const handOffset = 15; // Distance from center for each hand

        return (
          <React.Fragment key={handHold.id}>
            <HandSVG
              color={user1Color}
              isLeft={false}
              position={{
                x: midX - handOffset * Math.cos(handHold.angle),
                y: midY - handOffset * Math.sin(handHold.angle),
              }}
              rotation={handHold.angle}
            />
            <HandSVG
              color={user2Color}
              isLeft={true}
              position={{
                x: midX + handOffset * Math.cos(handHold.angle),
                y: midY + handOffset * Math.sin(handHold.angle),
              }}
              rotation={handHold.angle + Math.PI}
            />
          </React.Fragment>
        );
      });
    }, [awareness]);

    return (
      <div id="stellar-connections" ref={mainRef}>
        {/* Title */}
        <div className="title">
          <h1>when cursors meet</h1>
          <p>find others to hold hands</p>
          <p>
            <a href="/">playhtml</a> <a href="/experiments">experiment</a> 7
          </p>
        </div>

        {/* Stars background */}
        <div className="stars-container" style={{ position: "relative", zIndex: 10 }}>{renderStars}</div>

        {/* Hand holds overlay */}
        <div className="hands-container">{renderHandHolds}</div>

        {/* Test hand hold button */}
        <button
          className="test-handhold-toggle"
          onClick={toggleTestHandHold}
          style={{
            position: "fixed",
            bottom: "2rem",
            right: "2rem",
            background: testHandHold ? "#e74c3c" : "#9b59b6",
            color: "white",
            border: "none",
            padding: "0.75rem 1.5rem",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: "500",
            zIndex: 1000,
            boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
            backdropFilter: "blur(10px)",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 15px rgba(0,0,0,0.2)";
          }}
        >
          {testHandHold ? "End Test Hand Hold" : "Test Hand Hold"}
        </button>

        {/* Info panel */}
        <div className="info-panel">
          <div className="stat">
            <span className="label">nearby:</span>
            <span className="value">{proximityUsers.size}</span>
          </div>
          <div className="stat">
            <span className="label">stars:</span>
            <span className="value">{Object.keys(data.stars).length}</span>
          </div>
          <div className="stat">
            <span className="label">holding hands:</span>
            <span className="value">
              {awareness.filter((user) => user.activeHandHold).length}
            </span>
          </div>
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
        proximityThreshold: 30,
        visibilityThreshold: 300,
      },
    }}
  >
    <Main />
  </PlayProvider>
);
