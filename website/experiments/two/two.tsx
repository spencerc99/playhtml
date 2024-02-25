import "./two.scss";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState } from "@playhtml/react";

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
    // const [cursorFile, setCursorFile] = useState<string>("");
    // const [cursorFileEncoded, setCursorFileEncoded] = useState<string>("");
    const { cursors } = data;
    const cursorsSet = new Set(cursors.map((cursor) => cursor.cursorUrl));
    const userCursor = myAwareness?.cursorUrl;
    const setUserCursor = (newUrl: string) => {
      setMyAwareness({ cursorUrl: newUrl });
    };
    // const [userCursor, setUserCursor] = useState<string>("");

    useEffect(() => {
      if (cursors.length === 0 || userCursor) return;

      const initCursor = randomFromArray(cursors).cursorUrl;
      setUserCursor(initCursor);
      changeCursorUrl(initCursor);
    }, [data.cursors]);

    function changeCursorUrl(newUrl: string) {
      if (!newUrl) {
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
        <h1>cursor festival</h1>
        <div className="actions">
          <div className="inputs">
            <input
              placeholder="new cursor url"
              value={cursorUrl}
              onChange={(e) => setCursorUrl(e.target.value)}
            />
            {/* <input
              type="file"
              value={cursorFile}
              multiple={false}
              accept="image/png,image/gif"
              onChange={(e) => setCursorFile(e.target.value)}
            /> */}
          </div>
          <img src={cursorUrl} alt="cursor url preview" />
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
            change cursor
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
  <PlayProvider>
    <CursorController></CursorController>
  </PlayProvider>
);
