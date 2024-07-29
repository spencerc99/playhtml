import "./fridge.scss";
import words from "profane-words";
import { TagType } from "@playhtml/common";
import ReactDOM from "react-dom/client";
import { withPlay } from "../packages/react/src";
import React, { useState } from "react";
import { PlayProvider } from "../packages/react/src";
import { useLocation } from "./useLocation";

interface FridgeWordType {
  id?: string;
  word: string;
  color?: string;
}
interface Props extends FridgeWordType {
  deleteMode?: boolean;
  onDeleteWord?: () => void;
  className?: string;
}

const FridgeWord = withPlay<Props>()(
  {
    tagInfo: [TagType.CanMove],
  },
  ({ props }) => {
    const { id, word, deleteMode, onDeleteWord, className } = props;
    return (
      <div
        id={id}
        selector-id="#fridge .fridgeWordHolder"
        className="fridgeWordHolder"
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

const MaxWords = 500;

const WordControls = withPlay()(
  {
    defaultData: [] as FridgeWordType[],
    id: "newWords",
  },
  ({ data, setData }) => {
    const [input, setInput] = React.useState("");
    const [deleteMode, setDeleteMode] = React.useState(false);
    const userColor =
      window.cursors?.color || localStorage.getItem("userColor") || undefined;

    function clearMessage() {
      setInput("");
    }

    function onSubmit() {
      if (!input) {
        return;
      }
      if (
        words.some((word) => {
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

      setData([
        ...data,
        { word: input, color: userColor, id: Date.now().toString() },
      ]);
      clearMessage();
    }

    return (
      <>
        {data.map(({ word, color, id }) => (
          <FridgeWord
            id={id}
            key={id}
            word={word}
            color={color}
            deleteMode={deleteMode}
            className="custom"
            onDeleteWord={() => {
              const idxToDelete = data.findIndex((w) => {
                if (id) {
                  return id === w.id;
                }

                return word === w.word && color === w.color;
              });

              setData(data.filter((_, idx) => idx !== idxToDelete));
            }}
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
                if (e.key === "Enter") onSubmit();
              }}
              onChange={(e) => setInput(e.target.value.trim())}
            ></input>
            <button
              onClick={onSubmit}
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
              Remove some to add more!
            </div>
          ) : undefined}
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

function Main() {
  const { search, pathname } = useLocation();
  const [hasError, setHasError] = useState(false);
  const params = new URLSearchParams(search);
  // strip .html from the pathname
  const transformedPathname = pathname.replace(/\.html/g, "");
  const wall = params.get("wall") || transformedPathname;
  const isDefaultWall = transformedPathname === wall;
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
      {hasError && (
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
      )}
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
        {Words.map((w, i) => (
          <FridgeWord key={i} word={w} />
        ))}
        <WordControls />
      </PlayProvider>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("fridge") as HTMLElement).render(
  <Main />
);
