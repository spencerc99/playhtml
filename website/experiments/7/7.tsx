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
  brightness: number;
  position: { x: number; y: number };
  createdAt: number;
}

interface HandHold {
  id: string;
  user1: any;
  user2: any;
  position1: { x: number; y: number };
  position2: { x: number; y: number };
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
    if (user?.color) return user.color; // simulated cursor
    if (user?.playerStyle?.colorPalette?.[0]) return user.playerStyle.colorPalette[0]; // real user
    if (user?.publicKey === "me") return "#4ecdc4"; // our own user
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

// SVG Hand component
const HandSVG: React.FC<{
  color: string;
  isLeft: boolean;
  style?: React.CSSProperties;
}> = ({ color, isLeft, style }) => (
  <div
    className="hand-svg"
    style={{
      position: "absolute",
      pointerEvents: "none",
      zIndex: 1000,
      ...style,
    }}
  >
    <svg width="40" height="40" viewBox="0 0 40 40">
      <g transform={isLeft ? "scale(-1,1) translate(-40,0)" : ""}>
        <path
          d="M10 25c0-3 2-5 5-5s5 2 5 5v8c0 2-1 3-3 3h-4c-2 0-3-1-3-3v-8z"
          fill={color}
          stroke="#000"
          strokeWidth="1"
        />
        <circle
          cx="12"
          cy="18"
          r="2"
          fill={color}
          stroke="#000"
          strokeWidth="1"
        />
        <circle
          cx="15"
          cy="16"
          r="2"
          fill={color}
          stroke="#000"
          strokeWidth="1"
        />
        <circle
          cx="18"
          cy="18"
          r="2"
          fill={color}
          stroke="#000"
          strokeWidth="1"
        />
        <circle
          cx="21"
          cy="20"
          r="1.5"
          fill={color}
          stroke="#000"
          strokeWidth="1"
        />
      </g>
    </svg>
  </div>
);

// Star component
const StarComponent: React.FC<{ star: Star }> = ({ star }) => {
  const [color1, color2] = star.colors;
  const mixedColor = mixColors(color1, color2);

  return (
    <div
      className="star"
      style={{
        position: "absolute",
        left: star.position.x,
        top: star.position.y,
        transform: "translate(-50%, -50%)",
        opacity: Math.min(star.brightness / 5, 1),
        filter: `brightness(${100 + star.brightness * 20}%)`,
      }}
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
          d="M10 2 L12 8 L18 8 L13.5 12 L15.5 18 L10 14 L4.5 18 L6.5 12 L2 8 L8 8 Z"
          fill={`url(#gradient-${star.id})`}
          stroke="#fff"
          strokeWidth="0.5"
        />
      </svg>
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
    const [testHandHold, setTestHandHold] = useState(false);
    const mainRef = useRef<HTMLDivElement>(null);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

    // Proximity handlers
    const handleProximityEntered = useCallback(
      (otherPlayer: any) => {
        console.log("Proximity entered!", otherPlayer);

        if (!otherPlayer) return;

        const connectionId =
          otherPlayer.publicKey || otherPlayer.connectionId || "unknown";
        setProximityUsers((prev) => new Set([...prev, connectionId]));

        // Get cursor positions (approximate)
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

        // Set hand hold in awareness
        const pairId = getPairId({ publicKey: "me" }, otherPlayer);
        const handHold: HandHold = {
          id: pairId,
          user1: { publicKey: "me" },
          user2: otherPlayer,
          position1: { x: centerX - 30, y: centerY },
          position2: { x: centerX + 30, y: centerY },
          startedAt: Date.now(),
        };

        setMyAwareness({ activeHandHold: handHold });

        // Create or brighten star
        if (hasSynced) {
          setData((draft) => {
            const starId = pairId;
            const myColor = "#4ecdc4";
            const otherColor =
              otherPlayer.playerStyle?.colorPalette?.[0] || "#ff6b6b";

            if (draft.stars[starId]) {
              // Brighten existing star
              draft.stars[starId].brightness += 1;
            } else {
              // Create new star
              const angle = Math.random() * Math.PI * 2;
              const distance = 150 + Math.random() * 300;

              draft.stars[starId] = {
                id: starId,
                colors: [myColor, otherColor],
                brightness: 1,
                position: {
                  x: centerX + Math.cos(angle) * distance,
                  y: centerY + Math.sin(angle) * distance,
                },
                createdAt: Date.now(),
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

        // Remove hand hold from awareness
        setMyAwareness({ activeHandHold: undefined });
      },
      [setMyAwareness]
    );

    // Configure cursor proximity handlers
    useEffect(() => {
      configureCursors({
        onProximityEntered: handleProximityEntered,
        onProximityLeft: handleProximityLeft,
        proximityThreshold: 100, // Distance for hand-holding
        visibilityThreshold: 300, // Distance to see other cursors
      });
    }, [handleProximityEntered, handleProximityLeft, configureCursors]);

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
              draft.stars[starId].brightness += 1;
            } else {
              const angle = Math.random() * Math.PI * 2;
              const distance = 150 + Math.random() * 300;

              draft.stars[starId] = {
                id: starId,
                colors: [myColor, otherColor],
                brightness: 1,
                position: {
                  x: centerX + Math.cos(angle) * distance,
                  y: centerY + Math.sin(angle) * distance,
                },
                createdAt: Date.now(),
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

        return (
          <React.Fragment key={handHold.id}>
            <HandSVG
              color={user1Color}
              isLeft={false}
              style={{
                left: handHold.position1.x - 20,
                top: handHold.position1.y - 20,
              }}
            />
            <HandSVG
              color={user2Color}
              isLeft={true}
              style={{
                left: handHold.position2.x - 20,
                top: handHold.position2.y - 20,
              }}
            />
            <div
              className="connection-line"
              style={{
                position: "absolute",
                left: Math.min(handHold.position1.x, handHold.position2.x),
                top: Math.min(handHold.position1.y, handHold.position2.y),
                width: Math.abs(handHold.position2.x - handHold.position1.x),
                height: Math.abs(handHold.position2.y - handHold.position1.y),
                background: `linear-gradient(45deg, ${user1Color}50, ${user2Color}50)`,
                borderRadius: "2px",
                pointerEvents: "none",
                zIndex: 999,
              }}
            />
          </React.Fragment>
        );
      });
    }, [awareness]);


    return (
      <div id="stellar-connections" ref={mainRef}>
        {/* Title */}
        <div className="title">
          <h1>stellar connections</h1>
          <p>move close to other cursors to hold hands and light the stars</p>
        </div>

        {/* Stars background */}
        <div className="stars-container">{renderStars}</div>

        {/* Hand holds overlay */}
        <div className="hands-container">{renderHandHolds}</div>

        {/* Our own cursor */}
        <div
          className="our-cursor"
          style={{
            position: "fixed",
            left: mousePosition.x,
            top: mousePosition.y,
            pointerEvents: "none",
            zIndex: 10001,
            transform: "translate(-5px, -5px)",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 32 32">
            <g transform="translate(10 7)">
              <path
                d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z"
                fill="#fff"
                stroke="#000"
                strokeWidth="0.5"
              />
              <path
                d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z"
                fill="#4ecdc4"
              />
            </g>
          </svg>
          <div
            style={{
              position: "absolute",
              top: -25,
              left: 35,
              background: "rgba(0,0,0,0.8)",
              color: "white",
              padding: "2px 6px",
              borderRadius: "8px",
              fontSize: "11px",
              whiteSpace: "nowrap",
              border: "1px solid #4ecdc4",
            }}
          >
            You
          </div>
        </div>

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
        proximityThreshold: 100,
        visibilityThreshold: 200,
      },
    }}
  >
    <Main />
  </PlayProvider>
);
