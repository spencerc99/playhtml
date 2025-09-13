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
  meetingAngle: number;
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
    return user.playerStyle.colorPalette[0];
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

  // Create a valid gradient ID by sanitizing the star ID
  const gradientId = `gradient-${star.id.replace(/[^a-zA-Z0-9-]/g, "")}`;

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
        {color1 && color2 && (
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{ stopColor: color1, stopOpacity: 1 }} />
              <stop
                offset="100%"
                style={{ stopColor: color2, stopOpacity: 1 }}
              />
            </linearGradient>
          </defs>
        )}
        <path
          d={handDrawnPath}
          fill={color1 && color2 ? `url(#${gradientId})` : color1 || color2}
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
              justifyContent: "center",
              marginBottom: "8px",
              height: "24px",
              position: "relative",
            }}
          >
            <div
              style={
                {
                  position: "absolute",
                  left: "calc(50% - 3px)",
                  top: "50%",
                  transform: `translate(-50%, -50%) rotate(${
                    star.meetingAngle || 0
                  }rad)`,
                  width: "20px",
                  height: "20px",
                  "--hand-color": color1,
                } as React.CSSProperties
              }
              dangerouslySetInnerHTML={{
                __html:
                  '<svg width="20" height="20" viewBox="0 0 32 32"><path fill="var(--hand-color, #FFFFFF)" d="M12.6,13c0.5-0.2,1.4-0.1,1.7,0.5c0.2,0.5,0.4,1.2,0.4,1.1c0-0.4,0-1.2,0.1-1.6 c0.1-0.3,0.3-0.6,0.7-0.7c0.3-0.1,0.6-0.1,0.9-0.1c0.3,0.1,0.6,0.3,0.8,0.5c0.4,0.6,0.4,1.9,0.4,1.8c0.1-0.3,0.1-1.2,0.3-1.6 c0.1-0.2,0.5-0.4,0.7-0.5c0.3-0.1,0.7-0.1,1,0c0.2,0,0.6,0.3,0.7,0.5c0.2,0.3,0.3,1.3,0.4,1.7c0,0.1,0.1-0.4,0.3-0.7 c0.4-0.6,1.8-0.8,1.9,0.6c0,0.7,0,0.6,0,1.1c0,0.5,0,0.8,0,1.2c0,0.4-0.1,1.3-0.2,1.7c-0.1,0.3-0.4,1-0.7,1.4c0,0-1.1,1.2-1.2,1.8 c-0.1,0.6-0.1,0.6-0.1,1c0,0.4,0.1,0.9,0.1,0.9s-0.8,0.1-1.2,0c-0.4-0.1-0.9-0.8-1-1.1c-0.2-0.3-0.5-0.3-0.7,0 c-0.2,0.4-0.7,1.1-1,1.1c-0.7,0.1-2.1,0-3.1,0c0,0,0.2-1-0.2-1.4c-0.3-0.3-0.8-0.8-1.1-1.1l-0.8-0.9c-0.3-0.4-1-0.9-1.2-2 c-0.2-0.9-0.2-1.4,0-1.8c0.2-0.4,0.7-0.6,0.9-0.6c0.2,0,0.7,0,0.9,0.1c0.2,0.1,0.3,0.2,0.5,0.4c0.2,0.3,0.3,0.5,0.2,0.1 c-0.1-0.3-0.3-0.6-0.4-1c-0.1-0.4-0.4-0.9-0.4-1.5C11.7,13.9,11.8,13.3,12.6,13z"/></svg>',
              }}
            />
            <div
              style={
                {
                  position: "absolute",
                  left: "calc(50% + 3px)",
                  top: "50%",
                  transform: `translate(-50%, -50%) rotate(${
                    (star.meetingAngle || 0) + Math.PI
                  }rad) scaleX(-1)`,
                  width: "20px",
                  height: "20px",
                  "--hand-color": color2,
                } as React.CSSProperties
              }
              dangerouslySetInnerHTML={{
                __html:
                  '<svg width="20" height="20" viewBox="0 0 32 32"><path fill="var(--hand-color, #FFFFFF)" d="M12.6,16.6c-0.1-0.4-0.2-0.8-0.4-1.6c-0.2-0.6-0.3-0.9-0.5-1.2 c-0.2-0.5-0.3-0.7-0.5-1.2c-0.1-0.3-0.4-1-0.5-1.4c-0.1-0.5,0-0.9,0.2-1.2c0.3-0.3,1-0.5,1.4-0.4c0.4,0.1,0.7,0.5,0.9,0.8 c0.3,0.5,0.4,0.6,0.7,1.5c0.4,1,0.6,1.9,0.6,2.2l0.1,0.5c0,0,0-1.1,0-1.2c0-1-0.1-1.8,0-2.9c0-0.1,0.1-0.6,0.1-0.7 c0.1-0.5,0.3-0.8,0.7-1c0.4-0.2,0.9-0.2,1.4,0c0.4,0.2,0.6,0.5,0.7,1c0,0.1,0.1,1,0.1,1.1c0,1,0,1.6,0,2.2c0,0.2,0,1.6,0,1.5 c0.1-0.7,0.1-3.2,0.3-3.9c0.1-0.4,0.4-0.7,0.8-0.9c0.4-0.2,1.1-0.1,1.4,0.2c0.3,0.3,0.4,0.7,0.5,1.2c0,0.4,0,0.9,0,1.2 c0,0.9,0,1.3,0,2.1c0,0,0,0.3,0,0.2c0.1-0.3,0.2-0.5,0.3-0.7c0-0.1,0.2-0.6,0.4-0.9c0.1-0.2,0.2-0.4,0.4-0.7 c0.2-0.3,0.4-0.4,0.7-0.6c0.5-0.2,1.1,0.1,1.3,0.6c0.1,0.2,0,0.7,0,1.1c-0.1,0.6-0.3,1.3-0.4,1.6c-0.1,0.4-0.3,1.2-0.3,1.6 c-0.1,0.4-0.2,1.4-0.4,1.8c-0.1,0.3-0.4,1-0.7,1.4c0,0-1.1,1.2-1.2,1.8c-0.1,0.6-0.1,0.6-0.1,1c0,0.4,0.1,0.9,0.1,0.9 s-0.8,0.1-1.2,0c-0.4-0.1-0.9-0.8-1-1.1c-0.2-0.3-0.5-0.3-0.7,0c-0.2,0.4-0.7,1.1-1.1,1.1c-0.7,0.1-2.1,0-3.1,0c0,0,0.2-1-0.2-1.4 c-0.3-0.3-0.8-0.8-1.1-1.1l-0.8-0.9c-0.3-0.4-0.6-1.1-1.2-2c-0.3-0.5-1-1.1-1.3-1.6c-0.2-0.4-0.3-1-0.2-1.3 c0.2-0.6,0.7-0.9,1.4-0.8c0.5,0,0.8,0.2,1.2,0.5c0.2,0.2,0.6,0.5,0.8,0.7c0.2,0.2,0.2,0.3,0.4,0.5 C12.6,16.8,12.6,16.9,12.6,16.6"/></svg>',
              }}
            />
          </div>
          <div
            style={{
              textAlign: "center",
              marginBottom: "4px",
              fontWeight: 500,
            }}
          >
            star #
            {Math.abs(
              star.id.split("").reduce((a, b) => {
                return a + b.charCodeAt(0);
              }, 0)
            ) % 10000}
          </div>
          <div
            style={{
              textAlign: "center",
              marginBottom: "6px",
              fontSize: "11px",
              opacity: 0.8,
            }}
          >
            {star.connectionCount} connection
            {star.connectionCount === 1 ? "" : "s"}
          </div>
          <div
            style={{
              opacity: 0.7,
              fontSize: "11px",
              textAlign: "center",
              marginBottom: "2px",
            }}
          >
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
    const { hasSynced, configureCursors, getMyPlayerIdentity, getCursors } =
      usePlayContext();
    const [proximityUsers, setProximityUsers] = useState<Set<string>>(
      new Set()
    );
    const [activeHandHolds, setActiveHandHolds] = useState<
      Map<string, HandHold>
    >(new Map());
    const mainRef = useRef<HTMLDivElement>(null);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
    const [starAnimations, setStarAnimations] = useState<
      Array<{
        id: string;
        x: number;
        y: number;
        color1: string;
        color2: string;
        startTime: number;
      }>
    >([]);
    const [animationTick, setAnimationTick] = useState(0);

    // Animation frame loop
    useEffect(() => {
      let animationFrame: number;

      const animate = () => {
        setAnimationTick(Date.now());
        animationFrame = requestAnimationFrame(animate);
      };

      if (starAnimations.length > 0) {
        animationFrame = requestAnimationFrame(animate);
      }

      return () => {
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
        }
      };
    }, [starAnimations.length]);

    // Function to trigger star creation animation
    const triggerStarAnimation = useCallback(
      (x: number, y: number, color1: string, color2: string) => {
        const animationId = `anim-${Date.now()}-${Math.random()}`;
        setStarAnimations((prev) => [
          ...prev,
          {
            id: animationId,
            x,
            y,
            color1,
            color2,
            startTime: Date.now(),
          },
        ]);

        // Remove animation after it completes (1.5 seconds)
        setTimeout(() => {
          setStarAnimations((prev) =>
            prev.filter((anim) => anim.id !== animationId)
          );
        }, 1500);
      },
      []
    );

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
        if (!otherPlayer) return;

        const connectionId = otherPlayer.connectionId || "unknown";
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
        const myIdentity = getMyPlayerIdentity();
        const myColor = myIdentity.color;
        const myUser = { playerStyle: { colorPalette: [myColor] } };
        const pairId = getPairId(myUser, otherPlayer);
        const handHold: HandHold = {
          id: pairId,
          user1: myUser,
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
            const otherColor = otherPlayer.playerStyle.colorPalette[0];

            if (draft.stars[starId]) {
              // Increase connection count and update last interaction
              draft.stars[starId].connectionCount += 1;
              draft.stars[starId].lastInteraction = Date.now();
            } else {
              // Create new star at the midpoint between cursors
              const midX = (ourPos.x + theirPos.x) / 2;
              const midY = (ourPos.y + theirPos.y) / 2;

              // Ensure colors are valid strings
              const validMyColor = myColor || "#3b82f6";
              const validOtherColor = otherColor || "#ef4444";

              draft.stars[starId] = {
                id: starId,
                colors: [validMyColor, validOtherColor],
                connectionCount: 1,
                position: {
                  x: midX,
                  y: midY,
                },
                rotation: Math.random() * Math.PI * 2,
                meetingAngle: angle || 0,
                createdAt: Date.now(),
                lastInteraction: Date.now(),
              };

              // Trigger animation for new star
              triggerStarAnimation(midX, midY, validMyColor, validOtherColor);
            }
          });
        }
      },
      [hasSynced, setData, setMyAwareness, triggerStarAnimation]
    );

    const handleProximityLeft = useCallback(
      (connectionId: string) => {
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
        const myIdentity = getMyPlayerIdentity();
        const user1Color = myIdentity.color;
        const user2Color = handHold.user2.playerStyle.colorPalette[0];

        // Calculate positions so hands appear to be overlapping/holding
        const midX = (handHold.position1.x + handHold.position2.x) / 2;
        const midY = (handHold.position1.y + handHold.position2.y) / 2;
        const handOffset = 8; // Reduced distance for overlapping hands

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

    // Render star creation animations
    const renderStarAnimations = useMemo(() => {
      return starAnimations.map((anim) => {
        const elapsed = animationTick - anim.startTime;
        const progress = Math.min(elapsed / 1500, 1); // 1.5 second animation
        const scale = 1 + progress * 15; // Scale from 1 to 16x (more reasonable)
        const opacity = Math.max(0, 0.4 * (1 - progress)); // Start at 40% opacity, fade to 0

        if (progress >= 1) return null;

        // Convert colors to rgba format - handle both hex and hsl
        const parseColor = (color: string) => {
          if (color.startsWith("hsl")) {
            // For HSL colors, extract values and convert to rgba
            const hslMatch = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
            if (hslMatch) {
              const [, h, s, l] = hslMatch;
              return `hsla(${h}, ${s}%, ${l}%, ${opacity})`;
            }
          } else if (color.startsWith("#")) {
            // For hex colors, convert to rgba
            const hex = color.slice(1);
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
          }
          return `rgba(59, 130, 246, ${opacity})`; // fallback blue
        };

        const color1Rgba = parseColor(anim.color1);
        const color2Rgba = parseColor(anim.color2).replace(/[\d.]+\)$/, "0)"); // Make second color transparent

        return (
          <div
            key={anim.id}
            style={{
              position: "absolute",
              left: anim.x,
              top: anim.y,
              transform: `translate(-50%, -50%) scale(${scale})`,
              width: "200px",
              height: "200px",
              borderRadius: "50%",
              background: `radial-gradient(circle, ${color1Rgba} 0%, ${color2Rgba} 70%)`,
              pointerEvents: "none",
              zIndex: 1000,
              transition: "none",
            }}
          />
        );
      });
    }, [starAnimations, animationTick]);

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
        <div
          className="stars-container"
          style={{ position: "relative", zIndex: 10 }}
        >
          {renderStars}
        </div>

        {/* Hand holds overlay */}
        <div className="hands-container">{renderHandHolds}</div>

        {/* Star creation animations */}
        <div
          className="star-animations"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          {renderStarAnimations}
        </div>

        {/* User presence indicator */}
        <div className="presence-indicator">
          <div className="presence-title">online now</div>
          <div className="presence-users">
            {getCursors().allColors.map((userColor, index) => {
              const myIdentity = getMyPlayerIdentity();
              const isMe = userColor === myIdentity?.color;

              return (
                <div
                  key={`${userColor}-${index}`}
                  className={`presence-user ${isMe ? "presence-user-me" : ""}`}
                  style={{
                    background: userColor,
                    boxShadow: `0 0 12px ${userColor}40`,
                  }}
                  title={isMe ? "You" : `User with ${userColor} cursor`}
                />
              );
            })}
            {getCursors().allColors.length === 0 && (
              <div className="presence-empty">waiting for others...</div>
            )}
          </div>
        </div>

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
