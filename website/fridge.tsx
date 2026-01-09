import "./fridge.scss";
import profaneWords from "profane-words";
import { MoveData, TagType } from "@playhtml/common";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { PlayContext, withSharedState } from "../packages/react/src";
import React, { useContext, useEffect, useState, useRef } from "react";
import { PlayProvider } from "../packages/react/src";
import { useLocation } from "./useLocation";

// Detect mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

// Custom pinch-to-zoom and two-finger pan for mobile
// Applies transform directly to .content element (which contains all page content)
// Allows mobile users to pan to see words placed off-screen by desktop users
function usePinchZoom() {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const stateRef = useRef({ scale: 1, x: 0, y: 0 });
  const gestureRef = useRef({
    initialDistance: 0,
    initialScale: 1,
    isTwoFinger: false,
    lastX: 0,
    lastY: 0,
  });

  // Keep ref in sync with state
  useEffect(() => {
    stateRef.current = transform;
  }, [transform]);

  // Apply transform directly to .content element
  useEffect(() => {
    const content = document.querySelector(".content") as HTMLElement;
    if (content) {
      content.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
      content.style.transformOrigin = "0 0";
    }
  }, [transform]);

  useEffect(() => {
    const getDistance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getCenter = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const gesture = gestureRef.current;
        gesture.isTwoFinger = true;
        gesture.initialDistance = getDistance(e.touches);
        gesture.initialScale = stateRef.current.scale;
        const center = getCenter(e.touches);
        gesture.lastX = center.x;
        gesture.lastY = center.y;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (e.touches.length === 2 && gesture.isTwoFinger) {
        e.preventDefault();
        const distance = getDistance(e.touches);
        const center = getCenter(e.touches);

        // Calculate new scale from pinch
        const scaleChange = distance / gesture.initialDistance;
        let newScale = gesture.initialScale * scaleChange;
        newScale = Math.max(0.5, Math.min(4, newScale)); // Clamp between 0.5x and 4x

        // Calculate pan from two-finger drag
        const dx = center.x - gesture.lastX;
        const dy = center.y - gesture.lastY;

        setTransform((prev) => ({
          scale: newScale,
          x: prev.x + dx,
          y: prev.y + dy,
        }));

        gesture.lastX = center.x;
        gesture.lastY = center.y;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        gestureRef.current.isTwoFinger = false;
      }
    };

    // Desktop: ctrl/cmd + wheel = zoom, regular wheel/trackpad = pan
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Zoom with ctrl/cmd + scroll
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setTransform((prev) => ({
          ...prev,
          scale: Math.max(0.5, Math.min(4, prev.scale * delta)),
        }));
      } else {
        // Pan with regular scroll/trackpad
        e.preventDefault();
        setTransform((prev) => ({
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    // Attach to document for global capture
    document.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const resetZoom = () => setTransform((prev) => ({ ...prev, scale: 1 }));
  const resetPan = () => setTransform((prev) => ({ ...prev, x: 0, y: 0 }));
  const resetAll = () => setTransform({ scale: 1, x: 0, y: 0 });

  return { transform, resetZoom, resetPan, resetAll };
}

// Add Plausible analytics type definition
declare global {
  interface Window {
    plausible?: (
      eventName: string,
      options?: { props?: Record<string, any> }
    ) => void;
  }
}

interface FridgeWordType {
  id?: string;
  word: string;
  color?: string;
  x?: number;
  y?: number;
}

interface Props extends FridgeWordType {
  deleteMode?: boolean;
  onDeleteWord?: () => void;
  className?: string;
  userColor?: string;
  wall?: string;
}

const DefaultRoom = "fridge";
const DeleteWordLimit = 3;
const DeleteWordInterval = 1000 * 60 * 10; // 10 minutes
const DeleteLimitReachedKey = "fridge-lastDeleteTime";
const RestrictedWords = [...profaneWords];

type MoveLocalData = { startMouseX: number; startMouseY: number };

function getClientCoordinates(e: MouseEvent | TouchEvent): {
  clientX: number;
  clientY: number;
} {
  if ("touches" in e) {
    const { clientX, clientY } = e.touches[0];
    return { clientX, clientY };
  }
  return { clientX: e.clientX, clientY: e.clientY };
}

// Migration helper: check for "can-play" data that needs to be migrated to "can-move"
function getCanPlayData(elementId?: string): MoveData | undefined {
  if (!elementId) return undefined;
  const playhtml = (window as any).playhtml;
  return playhtml?.syncedStore?.["can-play"]?.[elementId];
}

const FridgeWord = withSharedState<MoveData, any, Props>(
  (props: Props) => {
    // Check for "can-play" data to migrate to "can-move" (reverse migration)
    const canPlayData = getCanPlayData(props.id);
    // Use can-play data if it exists and has non-zero position, otherwise use props
    const initialX =
      canPlayData && (canPlayData.x !== 0 || canPlayData.y !== 0)
        ? canPlayData.x
        : props.x ?? 0;
    const initialY =
      canPlayData && (canPlayData.x !== 0 || canPlayData.y !== 0)
        ? canPlayData.y
        : props.y ?? 0;

    return {
      // Use can-move tag to store data under "can-move" instead of "can-play"
      tagInfo: [TagType.CanMove],
      defaultData: { x: initialX, y: initialY },
      id: props.id,
      resetShortcut: "shiftKey",
      onDragStart: (e, { setLocalData }) => {
        const { clientX, clientY } = getClientCoordinates(e);
        setLocalData({
          startMouseX: clientX,
          startMouseY: clientY,
        });
      },
      onDrag: (e, { data, localData, setData, setLocalData, element }) => {
        const { clientX, clientY } = getClientCoordinates(e);
        const { top, left, bottom, right } = element.getBoundingClientRect();
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const viewportHeight =
          window.visualViewport?.height ?? window.innerHeight;
        if (
          (right > viewportWidth && clientX > localData.startMouseX) ||
          (bottom > viewportHeight && clientY > localData.startMouseY) ||
          (left < 0 && clientX < localData.startMouseX) ||
          (top < 0 && clientY < localData.startMouseY)
        )
          return;
        setData({
          x: data.x + clientX - localData.startMouseX,
          y: data.y + clientY - localData.startMouseY,
        });
        setLocalData({ startMouseX: clientX, startMouseY: clientY });
      },
      // onMount: (_, { setData, element }) => {
      //   // Reverse migration: if can-play data exists, copy it to can-move and delete can-play
      //   const canPlayData = getCanPlayData(element.id);
      //   if (canPlayData && (canPlayData.x !== 0 || canPlayData.y !== 0)) {
      //     setData({ x: canPlayData.x, y: canPlayData.y });
      //     // Clean up old can-play data
      //     try {
      //       const playhtml = (window as any).playhtml;
      //       playhtml?.deleteElementData?.("can-play", element.id);
      //     } catch (e) {
      //       console.warn("[FRIDGE] Failed to cleanup old can-play data:", e);
      //     }
      //   }
      // },
    };
  },
  ({ data, setData }, props: Props) => {
    const { id, word, deleteMode, onDeleteWord, className, userColor, wall } =
      props;
    return (
      <div
        id={id}
        selector-id="#fridge .fridgeWordHolder"
        className="fridgeWordHolder"
        style={{ transform: `translate(${data.x}px, ${data.y}px)` }}
        onPointerDown={() => {
          if (!userColor || !wall) return;
          window.plausible?.("MovedWord", {
            props: {
              userColor: userColor,
              wall: wall,
            },
          });
        }}
      >
        <div
          className={`fridgeWord ${className}`}
          style={{
            "--word-color": props.color,
            ...(deleteMode
              ? {
                  border: "2px dotted red",
                }
              : {}),
          }}
        >
          {word}
          {deleteMode ? (
            <button
              style={{
                background: "red",
                borderRadius: "50%",
                width: "1.5em",
                marginLeft: "4px",
                color: "white",
                position: "absolute",
                top: "-8px",
                right: "-12px",
                height: "1.5em",
                minHeight: "unset",
                lineHeight: "0",
              }}
              onClick={() => {
                if (!deleteMode) return;

                onDeleteWord?.();
              }}
            >
              {" "}
              x
            </button>
          ) : (
            ""
          )}
        </div>
      </div>
    );
  }
);

const Words = [
  "sometimes",
  "I",
  "dream",
  "of",
  "a",
  "world",
  "full",
  "of",
  "love",
  "where",
  "lightning",
  "surrender",
  "s",
  "with",
  "vanish",
  "ing",
  "tender",
  "ness",
  "!",
  "why",
  "don't",
  "you",
  "if",
  "not",
  "us",
  "then",
  "who",
  "?",
  "and",
  "few",
  "would",
  "question",
  "the",
  "living",
  "moment",
  "as",
  "its",
  "energy",
  "surrounding",
  "every",
  "free",
  "heart",
  "but",
  "life",
  "is",
  "in",
  "under",
  "around",
  "always",
  "someone",
  "s",
  "touch",
  "never",
  "could",
  "once",
  "moon",
];

const MaxWords = 1000;
const MaxWordLength = 40;

interface ToolboxProps {
  wall: string;
  onChangeWall: (wall: string | null) => void;
  isDefaultWall: boolean;
  resetZoom?: () => void;
  resetPan?: () => void;
  currentZoom?: number;
  currentPan?: { x: number; y: number };
}

const WordControls = withSharedState<FridgeWordType[]>(
  {
    defaultData: [] as FridgeWordType[],
    id: "newWords",
  },
  ({ data, setData }, props: ToolboxProps) => {
    const {
      wall,
      onChangeWall,
      isDefaultWall,
      resetZoom,
      resetPan,
      currentZoom,
      currentPan,
    } = props;
    const [input, setInput] = React.useState("");
    const [deleteMode, setDeleteMode] = React.useState(false);
    const [deleteCount, setDeleteCount] = React.useState(0);
    const [cursorPos, setCursorPos] = React.useState<{
      x: number;
      y: number;
    } | null>(null);
    const [wallInputValue, setWallInputValue] = React.useState(wall);
    const [showWallControls, setShowWallControls] = React.useState(false);
    const { removeElementData } = useContext(PlayContext);
    const userColor =
      window.cursors?.color || localStorage.getItem("userColor") || undefined;
    const isMobile = useIsMobile();

    // Track cursor position for desktop
    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        setCursorPos({ x: e.clientX, y: e.clientY });
      };
      window.addEventListener("mousemove", handleMouseMove);
      return () => window.removeEventListener("mousemove", handleMouseMove);
    }, []);

    // Get the fridge container's position to calculate relative coordinates
    function getFridgeOffset(): { left: number; top: number } {
      const fridge = document.getElementById("fridge");
      if (!fridge) return { left: 0, top: 0 };
      const rect = fridge.getBoundingClientRect();
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
      };
    }

    // Get center of viewport position (relative to fridge container)
    function getCenterPosition(): { x: number; y: number } {
      const fridgeOffset = getFridgeOffset();
      const viewportCenterX = window.scrollX + window.innerWidth / 2;
      const viewportCenterY = window.scrollY + window.innerHeight / 2;
      return {
        x: viewportCenterX - fridgeOffset.left - 50,
        y: viewportCenterY - fridgeOffset.top - 20,
      };
    }

    // Get position for new word based on how it was submitted
    function getNewWordPosition(useCursor: boolean): { x: number; y: number } {
      const isMobile = "ontouchstart" in window || window.innerWidth < 768;
      // Use center for mobile, button clicks, or if no cursor position
      if (isMobile || !useCursor || !cursorPos) {
        return getCenterPosition();
      }
      // Use cursor position with slight offset (for Enter key submission)
      // Convert viewport coordinates to fridge-relative coordinates
      const fridgeOffset = getFridgeOffset();
      return {
        x: cursorPos.x + window.scrollX - fridgeOffset.left + 10,
        y: cursorPos.y + window.scrollY - fridgeOffset.top + 10,
      };
    }

    function clearMessage() {
      setInput("");
    }

    useEffect(() => {
      const lastDeleteTime = localStorage.getItem(DeleteLimitReachedKey);
      if (lastDeleteTime) {
        const elapsedTime = Date.now() - parseInt(lastDeleteTime);
        if (elapsedTime < DeleteWordInterval) {
          setDeleteCount(DeleteWordLimit);
        } else {
          setDeleteCount(0);
          localStorage.removeItem(DeleteLimitReachedKey);
        }
      }
    }, []);

    function onSubmit(useCursor: boolean = false) {
      if (!input) {
        return;
      }

      if (input.length > MaxWordLength) {
        alert("word too long!");
        clearMessage();
        return;
      }
      if (
        RestrictedWords.some((word) => {
          const regex = new RegExp(`\\b${word}\\b`, "gi");
          return regex.test(input);
        })
      ) {
        alert(
          "we don't seem to like that word :( please keep things nice here"
        );
        clearMessage();
        return false;
      }

      // Track word creation
      window.plausible?.("CreateWord", {
        props: {
          wordLength: input.length,
          userColor: userColor,
          wall: wall,
        },
      });

      const pos = getNewWordPosition(useCursor);
      setData((d) => {
        d.push({
          word: input,
          color: userColor,
          id: Date.now().toString(),
          x: pos.x,
          y: pos.y,
        });
      });
      clearMessage();
    }

    function handleDeleteWord(
      id: string | undefined,
      word: string,
      color: string | undefined
    ) {
      if (deleteCount >= DeleteWordLimit) {
        // Track delete overload
        window.plausible?.("DeleteWordOverload", {
          props: {
            userColor: userColor,
            wall: wall,
          },
        });
        alert("why u deleting so much? chill");
        setDeleteMode(false);
        return;
      }

      const idxToDelete = data.findIndex((w) => {
        if (id) {
          return id === w.id;
        }

        return word === w.word && color === w.color;
      });

      // Track successful word deletion
      window.plausible?.("DeleteWord", {
        props: {
          wordLength: word.length,
          userColor: userColor,
          wall: wall,
        },
      });

      // Clean up element data to prevent orphaned data
      if (id) {
        try {
          removeElementData("can-move", id);
          // Also clean up any leftover can-play data from migration period
          removeElementData("can-play", id);
        } catch (error) {
          console.warn("[FRIDGE] Failed to cleanup element data:", error);
        }
      }

      setData((d) => {
        d.splice(idxToDelete, 1);
      });
      setDeleteCount(deleteCount + 1);
      if (deleteCount + 1 === DeleteWordLimit) {
        localStorage.setItem(DeleteLimitReachedKey, Date.now().toString());
      }
    }

    const toolboxStyles: React.CSSProperties = isMobile
      ? {
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#efefef",
          borderTop: "2px solid #333",
          padding: "10px 12px",
          paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
          zIndex: 9999,
          boxShadow: "0 -3px 0 0 rgba(50, 50, 50, 1)",
          boxSizing: "border-box",
        }
      : {
          position: "fixed",
          bottom: "24px",
          right: "24px",
          background: "#efefef",
          padding: "12px",
          zIndex: 9999,
          boxShadow: "4px 4px 0px 0px rgba(50, 50, 50, 1)",
          minWidth: "280px",
          border: "2px solid #333",
        };

    // Shared button style for fridge magnet look
    const magnetButtonStyle: React.CSSProperties = {
      padding: "0.4em 0.6em",
      background: "#efefef",
      color: "#333",
      border: "none",
      boxShadow: "2px 2px 0px 0px rgba(50, 50, 50, 1)",
      fontSize: "14px",
      cursor: "pointer",
      whiteSpace: "nowrap",
    };

    const toolbox = (
      <div style={toolboxStyles} className="fridge-toolbox">
        {/* Main row: input + buttons */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            alignItems: "center",
          }}
        >
          <input
            placeholder="New word..."
            value={input}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit(true);
            }}
            maxLength={30}
            onChange={(e) => setInput(e.target.value.trim())}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "0.4em",
              border: "2px solid #333",
              fontSize: isMobile ? "16px" : "14px",
              background: "white",
              color: "#333",
              outline: "none",
            }}
          />
          <button
            onClick={() => onSubmit(false)}
            disabled={!Boolean(input) || data.length >= MaxWords}
            style={{
              ...magnetButtonStyle,
              background: input ? "#efefef" : "#ccc",
              color: input ? "#333" : "#888",
              cursor: input ? "pointer" : "not-allowed",
              opacity: input ? 1 : 0.7,
            }}
          >
            Add
          </button>
          <button
            onClick={() => setDeleteMode(!deleteMode)}
            style={{
              ...magnetButtonStyle,
              background: deleteMode ? "#333" : "#ff6b6b",
              color: deleteMode ? "white" : "white",
              boxShadow: deleteMode
                ? "1px 1px 0px 0px rgba(50, 50, 50, 1)"
                : "2px 2px 0px 0px rgba(50, 50, 50, 1)",
            }}
            title={deleteMode ? "Stop deleting" : "Delete words"}
          >
            {deleteMode ? "Done" : "Delete"}
          </button>
        </div>

        {/* Status text - only show when fridge is full */}
        {data.length >= MaxWords && (
          <div
            style={{
              fontSize: "12px",
              color: "#666",
              marginTop: "6px",
              textAlign: "center",
              fontStyle: "italic",
            }}
          >
            Fridge full! Delete words or change walls.
          </div>
        )}

        {/* Wall stats & info - single row */}
        <div
          style={{
            marginTop: "8px",
            paddingTop: "8px",
            borderTop: "2px dashed #999",
          }}
        >
          <button
            onClick={() => setShowWallControls(!showWallControls)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "4px 0",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "14px",
              color: "#333",
              gap: "8px",
            }}
          >
            {/* Wall name - truncate if needed */}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              <span style={{ flexShrink: 0 }}>▣</span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {wall === DefaultRoom ? "main" : wall}
              </span>
            </span>

            {/* Stats - compact */}
            <span
              style={{
                display: "flex",
                gap: "10px",
                fontSize: "13px",
                color: "#666",
                flexShrink: 0,
              }}
            >
              <span title="words">¶{Words.length + data.length}</span>
              <span
                title="contributors"
                style={{ display: "flex", alignItems: "center", gap: "1px" }}
              >
                <svg
                  viewBox="0 0 880 1000"
                  style={{ width: "1em", height: "1em", fill: "currentColor" }}
                >
                  <path
                    transform="translate(0, 900) scale(1,-1)"
                    d="M440 137L310-87L228-39L390 241L390 331L146 472L193 553L390 439L390 475Q345 489 316.50 525.50Q288 562 288 610L288 610Q288 652 308 685Q328 718 362.50 737.50Q397 757 440 757L440 757Q483 757 517.50 737.50Q552 718 572 685Q592 652 592 610L592 610Q592 562 563.50 525.50Q535 489 490 475L490 475L490 439L687 553L734 472L490 331L490 241L652-39L570-87L440 137ZM440 554L440 554Q464 554 480 570Q496 586 496 610L496 610Q496 634 480 650Q464 666 440 666L440 666Q416 666 400 650Q384 634 384 610L384 610Q384 586 400 570Q416 554 440 554Z"
                  />
                </svg>
                {new Set(data.map((w) => w.color).filter(Boolean)).size}
              </span>
              {/* Zoom indicator with magnifying glass */}
              {currentZoom && currentZoom !== 1 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    resetZoom?.();
                  }}
                  title="Reset zoom"
                  style={{
                    cursor: "pointer",
                    color: "#4a7c59",
                    display: "flex",
                    alignItems: "center",
                    gap: "2px",
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    style={{
                      width: "1em",
                      height: "1em",
                      fill: "none",
                      stroke: "currentColor",
                      strokeWidth: 2,
                    }}
                  >
                    <circle cx="10" cy="10" r="6" />
                    <line x1="14.5" y1="14.5" x2="20" y2="20" />
                  </svg>
                  {Math.round(currentZoom * 100)}%
                </span>
              )}
              {/* Pan indicator with four-directional arrows */}
              {currentPan && (currentPan.x !== 0 || currentPan.y !== 0) && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    resetPan?.();
                  }}
                  title="Reset pan"
                  style={{
                    cursor: "pointer",
                    color: "#4a7c59",
                    display: "flex",
                    alignItems: "center",
                    gap: "2px",
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    style={{
                      width: "1em",
                      height: "1em",
                      fill: "none",
                      stroke: "currentColor",
                      strokeWidth: 2,
                    }}
                  >
                    <line x1="12" y1="2" x2="12" y2="22" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <polyline points="8,6 12,2 16,6" />
                    <polyline points="8,18 12,22 16,18" />
                    <polyline points="6,8 2,12 6,16" />
                    <polyline points="18,8 22,12 18,16" />
                  </svg>
                  {-Math.round(currentPan.x / 10)},
                  {-Math.round(currentPan.y / 10)}
                </span>
              )}
              <span style={{ color: "#999" }}>
                [{showWallControls ? "−" : "+"}]
              </span>
            </span>
          </button>

          {/* Expandable wall controls */}
          {showWallControls && (
            <div
              style={{
                display: "flex",
                flexDirection: isMobile ? "row" : "column",
                gap: "6px",
                alignItems: isMobile ? "center" : "stretch",
                flexWrap: "wrap",
                marginTop: "6px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  flex: 1,
                  minWidth: isMobile ? "auto" : "100%",
                }}
              >
                <input
                  placeholder="Wall name..."
                  value={wallInputValue}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      wallInputValue &&
                      wallInputValue !== wall
                    ) {
                      onChangeWall(wallInputValue);
                    }
                  }}
                  onChange={(e) => setWallInputValue(e.target.value.trim())}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "0.3em",
                    border: "2px solid #333",
                    fontSize: isMobile ? "16px" : "13px",
                    background: "white",
                    color: "#333",
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => onChangeWall(wallInputValue)}
                  disabled={!wallInputValue || wallInputValue === wall}
                  style={{
                    ...magnetButtonStyle,
                    padding: "0.3em 0.5em",
                    fontSize: "13px",
                    background:
                      wallInputValue && wallInputValue !== wall
                        ? "#4a7c59"
                        : "#ccc",
                    color:
                      wallInputValue && wallInputValue !== wall
                        ? "white"
                        : "#888",
                    cursor:
                      wallInputValue && wallInputValue !== wall
                        ? "pointer"
                        : "not-allowed",
                  }}
                >
                  Go
                </button>
              </div>
              {!isDefaultWall && (
                <button
                  onClick={() => onChangeWall(null)}
                  style={{
                    ...magnetButtonStyle,
                    padding: "0.3em 0.5em",
                    fontSize: "12px",
                  }}
                >
                  &larr; back to main
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );

    return (
      <>
        {data.map(({ word, color, id, x, y }) => (
          <FridgeWord
            id={id}
            key={id}
            word={word}
            color={color}
            x={x}
            y={y}
            deleteMode={deleteMode}
            className="custom"
            onDeleteWord={() => {
              handleDeleteWord(id, word, color);
            }}
            userColor={userColor}
            wall={wall}
          />
        ))}
        {/* Render toolbox via portal to ensure fixed positioning works */}
        {createPortal(toolbox, document.body)}
      </>
    );
  }
);

const AdminSettings = ({
  data,
  setData,
}: {
  data: { showDefaultWords: boolean };
  setData: (data: { showDefaultWords: boolean }) => void;
}) => {
  return (
    <div
      style={{
        position: "fixed",
        top: "20px",
        right: "20px",
        background: "white",
        padding: "1em",
        borderRadius: "4px",
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        zIndex: 1000,
      }}
    >
      <h3 style={{ margin: "0 0 1em 0" }}>Admin Settings</h3>
      <label style={{ display: "flex", alignItems: "center", gap: "0.5em" }}>
        <input
          type="checkbox"
          checked={data.showDefaultWords}
          onChange={(e) =>
            setData((d) => {
              d.showDefaultWords = e.target.checked;
            })
          }
        />
        Show Default Words
      </label>
    </div>
  );
};

interface FridgeWordsProps {
  hasError: boolean;
  wall: string;
  onChangeWall: (wall: string | null) => void;
  isDefaultWall: boolean;
  resetZoom?: () => void;
  resetPan?: () => void;
  currentZoom?: number;
  currentPan?: { x: number; y: number };
}

const FridgeWordsContent = withSharedState(
  {
    defaultData: { showDefaultWords: true },
    id: "adminSettings",
  },
  ({ data, setData }, props: FridgeWordsProps) => {
    const {
      hasError,
      wall,
      onChangeWall,
      isDefaultWall,
      resetZoom,
      resetPan,
      currentZoom,
      currentPan,
    } = props;
    const { hasSynced } = useContext(PlayContext);
    const { search } = useLocation();
    const params = new URLSearchParams(search);
    const isAdmin = params.get("admin") !== null;

    return !hasSynced ? (
      <div
        className="loading"
        style={{
          borderRadius: "4px",
          padding: "0.5em 1em",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.2em",
        }}
      >
        Finding the words...
      </div>
    ) : props.hasError ? (
      <div
        style={{
          position: "absolute",
          top: "-300px",
          width: "100%",
          boxShadow: "0 0 8px 4px red",
          borderRadius: "4px",
          padding: "0.5em 1em",
          background: "white",
        }}
      >
        We're having some trouble finding the fridge magnets! Give us a minute
        to dig around and come back later...
      </div>
    ) : (
      <>
        {data.showDefaultWords &&
          Words.map((w, i) => <FridgeWord key={i} word={w} />)}
        <WordControls
          wall={wall}
          onChangeWall={onChangeWall}
          isDefaultWall={isDefaultWall}
          resetZoom={resetZoom}
          resetPan={resetPan}
          currentZoom={currentZoom}
          currentPan={currentPan}
        />
        {isAdmin && <AdminSettings data={data} setData={setData} />}
      </>
    );
  }
);

function FridgeWords(props: FridgeWordsProps) {
  return <FridgeWordsContent {...props} />;
}

function Main() {
  const { search } = useLocation();
  const [hasError, setHasError] = useState(false);
  const params = new URLSearchParams(search);
  const wall = params.get("wall") || DefaultRoom;
  const isDefaultWall = DefaultRoom === wall;
  const { transform, resetZoom, resetPan } = usePinchZoom();

  function setRoom(room: string | null) {
    const url = new URL(window.location.href);
    if (room === null) url.searchParams.delete("wall");
    else url.searchParams.set("wall", room);
    window.location.href = url.toString();
  }

  return (
    <PlayProvider
      initOptions={{
        room: wall,
        onError: () => {
          setHasError(true);
        },
      }}
    >
      <FridgeWords
        hasError={hasError}
        wall={wall}
        onChangeWall={setRoom}
        isDefaultWall={isDefaultWall}
        resetZoom={resetZoom}
        resetPan={resetPan}
        currentZoom={transform.scale}
        currentPan={{ x: transform.x, y: transform.y }}
      />
    </PlayProvider>
  );
}

createRoot(document.getElementById("fridge") as HTMLElement).render(<Main />);
