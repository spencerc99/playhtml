import React, { useState, useEffect, useContext } from "react";
import {
  PlayProvider,
  PlayContext,
  CanMoveElement,
  CanSpinElement,
  CanToggleElement,
  CanGrowElement,
  CanHoverElement,
  CanDuplicateElement,
  withSharedState,
} from "@playhtml/react";

const ShootingStarEventType = "shootingStar";

// Custom hook for shooting star events
function useShootingStar() {
  const {
    registerPlayEventListener,
    removePlayEventListener,
    dispatchPlayEvent,
  } = useContext(PlayContext);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const id = registerPlayEventListener(ShootingStarEventType, {
      onEvent: () => {
        setIsAnimating(true);
        setTimeout(() => setIsAnimating(false), 2000);
      },
    });

    return () => removePlayEventListener(ShootingStarEventType, id);
  }, [registerPlayEventListener, removePlayEventListener]);

  return {
    isAnimating,
    trigger: () => dispatchPlayEvent({ type: ShootingStarEventType }),
  };
}

// Shooting star component - triggers animation for all users via events
function ShootingStar() {
  const { isAnimating, trigger } = useShootingStar();

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: "-36px",
          left: "-36px",
          fontSize: "36px",
          textShadow: "0 0 4px yellow",
          animation: isAnimating ? "shootingstar 2s ease-in-out" : "none",
          pointerEvents: "none",
        }}
      >
        💫
      </div>
      <button onClick={trigger}>shooting star!</button>
    </>
  );
}

// Reaction button - tracks who has reacted using localStorage
const ReactionButton = withSharedState(
  { defaultData: { count: 0 } },
  ({ data, setData, ref }) => {
    const [hasReacted, setHasReacted] = useState(false);

    useEffect(() => {
      if (ref.current) {
        setHasReacted(Boolean(localStorage.getItem(ref.current.id)));
      }
    }, [ref.current?.id]);

    return (
      <button
        onClick={() => {
          const { count } = data;
          if (hasReacted) {
            setData({ count: count - 1 });
            if (ref.current) {
              localStorage.removeItem(ref.current.id);
            }
            setHasReacted(false);
          } else {
            setData({ count: count + 1 });
            if (ref.current) {
              localStorage.setItem(ref.current.id, "true");
            }
            setHasReacted(true);
          }
        }}
        className={`reaction ${hasReacted ? "reacted" : ""}`}
        style={{ fontSize: "24px", padding: "10px 20px", margin: "10px 0" }}
      >
        💖 <span>{data.count}</span>
      </button>
    );
  }
);

function App() {
  const [highlightedCapability, setHighlightedCapability] = useState<string | null>(null);

  const capabilities = [
    "can-play",
    "can-move",
    "can-mirror",
    "can-toggle",
    "can-duplicate",
    "can-spin",
    "can-grow",
    "can-hover",
  ];

  return (
    <PlayProvider
      initOptions={{
        cursors: {
          enabled: true,
          room: "page",
        },
      }}
    >
      <div style={{ fontFamily: "HK Grotesk, sans-serif", backgroundColor: "#69f7be", minHeight: "100vh", padding: "2rem" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h1 style={{ color: "#2800ff", fontSize: "100px", textAlign: "center", marginTop: "2em" }}>
            Hello World!
          </h1>

          <CanSpinElement>
            <img
              src="https://cdn.glitch.com/a9975ea6-8949-4bab-addb-8a95021dc2da%2Fillustration.svg?v=1618177344016"
              alt="Editor illustration"
              style={{ maxWidth: "300px", display: "block", margin: "2rem auto", cursor: "pointer" }}
            />
          </CanSpinElement>

          <div style={{ marginBottom: "2em" }}>
            <CanMoveElement>
              <img
                src="https://media2.giphy.com/media/lL7A3Li0YtFHq/giphy.gif"
                alt="Open sign"
                style={{ cursor: "move", display: "block" }}
              />
            </CanMoveElement>

            <CanToggleElement>
              <img
                src="https://png.pngtree.com/png-vector/20230909/ourmid/pngtree-paper-lamp-paper-png-image_9211580.png"
                alt="Lamp"
                style={{ width: "200px", position: "absolute", top: 0, right: "-16px" }}
                className="lamp"
              />
            </CanToggleElement>
          </div>

          <div style={{ marginBottom: "2em", display: "flex", gap: "2em", flexWrap: "wrap", alignItems: "center" }}>
            <CanToggleElement>
              <img
                src="https://media.istockphoto.com/id/1443562748/photo/cute-ginger-cat.jpg?s=612x612&w=0&k=20&c=vvM97wWz-hMj7DLzfpYRmY2VswTqcFEKkC437hxm3Cg="
                alt="Cat or Dog"
                style={{ width: "200px", cursor: "pointer" }}
                id="catOrDog"
              />
            </CanToggleElement>

            <CanGrowElement>
              <img
                src="https://cdn.glitch.global/c493b77a-3c7d-4240-9aee-94519099c30c/44a715b5-bdb1-4e2e-b4ee-ea1b0821178b.image.png?v=1727411734991"
                alt="Plant"
                style={{ width: "200px", cursor: "pointer" }}
                id="plant"
              />
            </CanGrowElement>

            <CanHoverElement>
              <div
                style={{
                  width: "100px",
                  height: "100px",
                  background: "red",
                  borderRadius: "8px",
                }}
                id="hoverBox"
              />
            </CanHoverElement>

            <CanDuplicateElement>
              <button style={{ fontSize: "24px", padding: "10px 20px", cursor: "pointer" }}>
                🌟 Click to clone me!
              </button>
            </CanDuplicateElement>
          </div>

          <h2 style={{ color: "#2800ff" }}>playhtml getting started</h2>
          <p>
            This is the playhtml React starter. You can use it to build your own tiny social network.
            Check out the code and hover over the capabilities below to see which elements have them.
          </p>

          <ol style={{ position: "relative" }}>
            {capabilities.map((cap) => (
              <li
                key={cap}
                onMouseEnter={() => setHighlightedCapability(cap)}
                onMouseLeave={() => setHighlightedCapability(null)}
                style={{
                  width: "fit-content",
                  cursor: "zoom-in",
                  textShadow: highlightedCapability === cap ? "0px 0px 4px rgb(245, 169, 15)" : "none",
                }}
              >
                {cap}
              </li>
            ))}
          </ol>

          <p>
            For all the details about these capabilities and more, see the{" "}
            <a href="https://github.com/spencerc99/playhtml#plug-and-play-capabilities">
              playhtml docs
            </a>
          </p>

          <div style={{ marginTop: "2rem" }}>
            <p>Here's a playhtml event. It triggers a shooting star for everyone</p>
            <ShootingStar />
          </div>

          <div style={{ marginTop: "2rem" }}>
            <p>Here's a reaction button! Everyone can see how many people have reacted</p>
            <ReactionButton />
          </div>

          <hr style={{ margin: "3rem 0", border: "none", borderTop: "4px solid #fff" }} />

          <div style={{ textAlign: "center", padding: "2rem 0" }}>
            <p style={{ marginBottom: "1rem" }}>
              Want to see more examples? Check out the{" "}
              <a
                href="https://github.com/spencerc99/playhtml/tree/main/packages/react/examples"
                target="_blank"
                rel="noopener noreferrer"
              >
                examples folder
              </a>{" "}
              in the playhtml repo for components like:
            </p>
            <ul style={{ listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: "0.5em", justifyContent: "center" }}>
              <li>📊 Poll</li>
              <li>💬 Live Chat</li>
              <li>⏱️ Shared Timer</li>
              <li>🎰 Random Spinner</li>
              <li>🎉 Confetti Zone</li>
              <li>🎨 Shared Slider</li>
              <li>👥 Visitor Count</li>
              <li>and more!</li>
            </ul>
          </div>
        </div>

        <style>
          {`
            @keyframes shootingstar {
              0% {
                transform: translate(100vw, 100vh) rotate(0deg);
              }
              100% {
                transform: translate(-10vw, -10vh) rotate(360deg);
              }
            }

            .lamp.clicked {
              filter: brightness(1.2) saturate(1.6) drop-shadow(0px 0px 50px rgba(247, 220, 156, 0.85));
            }

            .hoverBox.hovered {
              background: blue !important;
              transform: scale(1.1);
            }

            #catOrDog.clicked {
              content: url("https://images.rawpixel.com/image_png_800/czNmcy1wcml2YXRlL3Jhd3BpeGVsX2ltYWdlcy93ZWJzaXRlX2NvbnRlbnQvcHUyMzMxNzg4LWltYWdlLXJtNTAzLTAxXzEtbDBqOXFyYzMucG5n.png");
            }

            .reaction {
              transition: all 0.2s ease;
              cursor: pointer;
            }

            .reaction.reacted {
              background: #ff6b6b;
              transform: scale(1.05);
              box-shadow: 0 5px 15px rgba(255, 107, 107, 0.3);
            }

            @font-face {
              font-family: HK Grotesk;
              src: url("https://cdn.glitch.me/605e2a51-d45f-4d87-a285-9410ad350515%2FHKGrotesk-Regular.otf?v=1603136326027")
                format("opentype");
            }
            @font-face {
              font-family: HK Grotesk;
              font-weight: bold;
              src: url("https://cdn.glitch.me/605e2a51-d45f-4d87-a285-9410ad350515%2FHKGrotesk-Bold.otf?v=1603136323437")
                format("opentype");
            }
          `}
        </style>
      </div>
    </PlayProvider>
  );
}

export default App;
