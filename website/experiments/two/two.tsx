import "./two.scss";
import React, { useContext, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { PlayContext, PlayProvider, withSharedState } from "@playhtml/react";
import confetti from "canvas-confetti";

interface Cursor {
  cursorUrl: string;
  timestamp: number;
}

function randomFromArray<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const CursorController = withSharedState(
  {
    defaultData: {
      cursors: [] as Cursor[],
    },
    myDefaultAwareness: {
      cursorUrl: "",
    },
  },
  ({ data, setData, myAwareness, setMyAwareness, awareness }) => {
    const [cursorUrl, setCursorUrl] = useState<string>("");
    const { cursors } = data;
    const cursorsSet = new Set(cursors.map((cursor) => cursor.cursorUrl));
    const userCursor = myAwareness?.cursorUrl;
    const setUserCursor = (newUrl: string) => {
      setMyAwareness({ cursorUrl: newUrl });
    };
    const userCursorIsGif = userCursor && userCursor.endsWith(".gif");
    const [cursorLocation, setCursorLocation] = useState({ x: 0, y: 0 });
    const { dispatchPlayEvent, hasSynced } = useContext(PlayContext);

    useEffect(() => {
      // TODO: doesn't handle scroll
      const move = (e) => {
        setCursorLocation({ x: e.clientX, y: e.clientY });
      };
      document.addEventListener("mousemove", move);
      const click = (e) => {
        dispatchPlayEvent({
          type: "confetti",
          eventPayload: {
            origin: {
              x: e.clientX / window.innerWidth,
              y: e.clientY / window.innerHeight,
            },
            particleCount: 7,
            startVelocity: 10,
            spread: 70,
            decay: 1,
          },
        });
      };
      document.addEventListener("click", click);

      return () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("click", click);
      };
    }, [hasSynced]);
    useEffect(() => {
      if (cursors.length === 0 || userCursor) return;

      const initCursor = randomFromArray(cursors).cursorUrl;
      setUserCursor(initCursor);
      changeCursorUrl(initCursor);
    }, [data.cursors]);

    function changeCursorUrl(newUrl: string) {
      if (!newUrl && !cursors.length) {
        return;
      }

      if (!cursorsSet.has(newUrl)) {
        setData({
          cursors: [
            ...cursors,
            {
              cursorUrl: newUrl,
              timestamp: Date.now(),
            },
          ],
        });
      }
      document.body.style.cursor = `url(${newUrl}), auto`;
      setUserCursor(newUrl);
    }
    return (
      <div id="cursorsMain">
        {userCursorIsGif && (
          <img
            src={userCursor}
            alt="user cursor"
            className="userCursor"
            style={{
              left: cursorLocation.x - 25,
              top: cursorLocation.y - 25,
              width: "50px",
              height: "50px",
            }}
          />
        )}
        <h1>cursor festival</h1>
        <p>
          a place for all cursors to play, choose your cursor and share it with
          everyone else who visits.
        </p>
        <p>
          add your own for others! some good sources:{" "}
          <a href="https://gsgifcities.org/">gifcities.org</a> &{" "}
          <a href="https://www.cursors-4u.com/">https://www.cursors-4u.com/</a>
        </p>
        <div className="actions">
          <div className="inputs">
            <input
              placeholder="new cursor url"
              value={cursorUrl}
              onChange={(e) => setCursorUrl(e.target.value)}
            />
            <img src={cursorUrl} alt="preview" />
          </div>
          <div
            className="testArea"
            style={{
              cursor: `url(${cursorUrl}), auto`,
            }}
          >
            <span>cursor testing area</span>
          </div>
          <button
            onClick={() => changeCursorUrl(cursorUrl)}
            disabled={!cursorUrl}
          >
            add cursor
          </button>
        </div>
        <h2>cursor inventory</h2>
        <div className="cursors">
          <div
            className={`cursor ${"" === userCursor ? "active" : ""}`}
            onClick={() => {
              document.body.style.cursor = "";
              setUserCursor("");
            }}
          >
            original
            <div className="count">
              {awareness.filter((a) => a.cursorUrl === "").length}
            </div>
          </div>
          {cursors.map((cursor) => (
            <div
              key={cursor.timestamp}
              className={`cursor ${
                cursor.cursorUrl === userCursor ? "active" : ""
              }`}
              onClick={() => changeCursorUrl(cursor.cursorUrl)}
              style={{
                cursor: `url(${cursor.cursorUrl}), auto`,
              }}
            >
              <img src={cursor.cursorUrl} alt="cursor" />
              <div className="count">
                {
                  awareness.filter((a) => a.cursorUrl === cursor.cursorUrl)
                    .length
                }
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
);

// Website with a shared color.
ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider
    initOptions={{
      events: {
        confetti: {
          type: "confetti",
          onEvent: (data) => {
            confetti({
              ...(data || {}),
            });
          },
        },
      },
    }}
  >
    <CursorController></CursorController>
  </PlayProvider>
);
