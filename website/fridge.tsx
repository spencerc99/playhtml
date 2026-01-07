import "./fridge.scss";
import profaneWords from "profane-words";
import { MoveData } from "@playhtml/common";
import ReactDOM from "react-dom/client";
import { PlayContext, withSharedState } from "../packages/react/src";
import React, { useContext, useEffect, useState } from "react";
import { PlayProvider } from "../packages/react/src";
import { useLocation } from "./useLocation";

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
  userColor: string;
  wall: string;
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

// Migration helper: check for old "can-move" data
function getOldMoveData(elementId?: string): MoveData | undefined {
  if (!elementId) return undefined;
  const playhtml = (window as any).playhtml;
  return playhtml?.syncedStore?.["can-move"]?.[elementId];
}

const FridgeWord = withSharedState<MoveData, any, Props>(
  (props: Props) => {
    // Check for old "can-move" data to migrate
    const oldData = getOldMoveData(props.id);
    const initialX = oldData?.x ?? props.x ?? 0;
    const initialY = oldData?.y ?? props.y ?? 0;

    return {
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
    };
  },
  ({ data, setData }, props: Props) => {
    const { id, word, deleteMode, onDeleteWord, className, userColor, wall } =
      props;
    // Custom words use absolute positioning, default words use transform
    const isCustom = className === "custom";
    const positionStyle = isCustom
      ? { position: "absolute" as const, left: data.x, top: data.y }
      : { transform: `translate(${data.x}px, ${data.y}px)` };
    return (
      <div
        id={id}
        selector-id="#fridge .fridgeWordHolder"
        className="fridgeWordHolder"
        style={positionStyle}
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

const WordControls = withSharedState<FridgeWordType[]>(
  {
    defaultData: [] as FridgeWordType[],
    id: "newWords",
  },
  ({ data, setData }, props: { wall: string }) => {
    const { wall } = props;
    const [input, setInput] = React.useState("");
    const [deleteMode, setDeleteMode] = React.useState(false);
    const [deleteCount, setDeleteCount] = React.useState(0);
    const [cursorPos, setCursorPos] = React.useState<{
      x: number;
      y: number;
    } | null>(null);
    const { removeElementData } = useContext(PlayContext);
    const userColor =
      window.cursors?.color || localStorage.getItem("userColor") || undefined;

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

      // Clean up can-play data for this element to prevent orphaned data
      if (id) {
        try {
          removeElementData("can-play", id);
        } catch (error) {
          console.warn("[FRIDGE] Failed to cleanup can-play data:", error);
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
        <div
          style={{
            position: "fixed",
            bottom: "20%",
            right: "20%",
            display: "flex",
            flexDirection: "column",
            gap: ".5em",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: ".5em",
              justifyContent: "flex-end",
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
            ></input>
            <button
              onClick={() => onSubmit(false)}
              disabled={!Boolean(input) || data.length >= MaxWords}
              style={{
                padding: ".5em 1em",
              }}
            >
              Add
            </button>
          </div>
          {data.length >= MaxWords ? (
            <div
              style={{
                textAlign: "right",
                color: "slategray",
                fontSize: ".8em",
              }}
            >
              The fridge is at its limit.
              <br />
              Remove some words to add more or
              <br />
              try changing to a different wall!
            </div>
          ) : (
            <div
              style={{
                textAlign: "right",
                color: "slategray",
                fontSize: ".8em",
              }}
            >
              p.s. you can hit "enter" to add, too
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={() => setDeleteMode(!deleteMode)}
              style={{
                background: !deleteMode ? "red" : undefined,
                padding: ".5em 1em",
                width: "fit-content",
              }}
            >
              {deleteMode ? "Stop" : "Delete"}
            </button>
          </div>
        </div>
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
}

const FridgeWordsContent = withSharedState(
  {
    defaultData: { showDefaultWords: true },
    id: "adminSettings",
  },
  ({ data, setData }, props: FridgeWordsProps) => {
    const { hasError, wall } = props;
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
        <WordControls wall={wall} />
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
  const [newRoom, setNewRoom] = useState(wall);
  function setRoom(room: string | null) {
    // change "wall" search query param to "room"
    const url = new URL(window.location.href);
    if (room === null) url.searchParams.delete("wall");
    else url.searchParams.set("wall", room);
    window.location.href = url.toString();
  }

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: "-200px",
          left: "60%",
          display: "flex",
          flexDirection: "column",
          gap: ".5em",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: ".5em",
          }}
        >
          <input
            placeholder="Room..."
            value={newRoom}
            onKeyDown={(e) => {
              if (e.key === "Enter") setRoom(newRoom);
            }}
            onChange={(e) => setNewRoom(e.target.value.trim())}
          ></input>
          <button
            onClick={() => setRoom(newRoom)}
            disabled={!Boolean(newRoom) || newRoom === wall}
            style={{
              padding: ".5em 1em",
            }}
          >
            Change Wall
          </button>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={() => setRoom(null)}
            style={{
              padding: ".5em 1em",
              width: "fit-content",
            }}
            disabled={isDefaultWall}
          >
            Back to Main Wall
          </button>
        </div>
      </div>
      <PlayProvider
        initOptions={{
          room: wall,
          onError: () => {
            setHasError(true);
          },
        }}
      >
        <FridgeWords hasError={hasError} wall={wall} />
      </PlayProvider>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("fridge") as HTMLElement).render(
  <Main />
);
