import "./fridge.scss";
import profaneWords from "profane-words";
import { TagType } from "@playhtml/common";
import ReactDOM from "react-dom/client";
import { withPlay } from "../packages/react/src";
import React, { useContext, useEffect, useState } from "react";
import { PlayProvider } from "../packages/react/src";
import { useLocation } from "./useLocation";
import { PlayContext } from "../packages/react/src";

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

const DefaultRoom = "fridge";
const DeleteWordLimit = 3;
const DeleteWordInterval = 1000 * 60 * 10; // 10 minutes
const DeleteLimitReachedKey = "fridge-lastDeleteTime";
const RestrictedWords = [...profaneWords];

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

const MaxWords = 300;
const MaxWordLength = 40;

const WordControls = withPlay()(
  {
    defaultData: [] as FridgeWordType[],
    id: "newWords",
  },
  ({ data, setData }) => {
    const [input, setInput] = React.useState("");
    const [deleteMode, setDeleteMode] = React.useState(false);
    const [deleteCount, setDeleteCount] = React.useState(0);

    const userColor =
      window.cursors?.color || localStorage.getItem("userColor") || undefined;

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

    function onSubmit() {
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

      setData([
        ...data,
        { word: input, color: userColor, id: Date.now().toString() },
      ]);
      clearMessage();
    }

    function handleDeleteWord(
      id: string | undefined,
      word: string,
      color: string | undefined
    ) {
      if (deleteCount >= DeleteWordLimit) {
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

      setData(data.filter((_, idx) => idx !== idxToDelete));
      setDeleteCount(deleteCount + 1);
      if (deleteCount + 1 === DeleteWordLimit) {
        localStorage.setItem(DeleteLimitReachedKey, Date.now().toString());
      }
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
              handleDeleteWord(id, word, color);
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
              maxLength={30}
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

function FridgeWords({ hasError }: { hasError: boolean }) {
  const { hasSynced } = useContext(PlayContext);

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
  ) : hasError ? (
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
      We're having some trouble finding the fridge magnets! Give us a minute to
      dig around and come back later...
    </div>
  ) : (
    <>
      {Words.map((w, i) => (
        <FridgeWord key={i} word={w} />
      ))}
      <WordControls />
    </>
  );
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
        <FridgeWords hasError={hasError} />
      </PlayProvider>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("fridge") as HTMLElement).render(
  <Main />
);
