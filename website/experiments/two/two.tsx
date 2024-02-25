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

function extractUrlFromCursorStyle(cursorStyle: string) {
  if (!cursorStyle.startsWith('url("')) {
    return;
  }
  cursorStyle = cursorStyle.slice(5);

  if (!cursorStyle.endsWith('"), auto') || cursorStyle.endsWith('")')) {
    return;
  }
  if (cursorStyle.endsWith('"), auto')) {
    cursorStyle = cursorStyle.slice(0, cursorStyle.length - 8);
  } else {
    cursorStyle = cursorStyle.slice(0, cursorStyle.length - 2);
  }

  return cursorStyle;
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
    const userCursorIsGif = userCursor && userCursor.endsWith(".gif");
    const [cursorLocation, setCursorLocation] = useState({ x: 0, y: 0 });

    useEffect(() => {
      document.addEventListener("mousemove", (e) => {
        setCursorLocation({ x: e.clientX, y: e.clientY });
      });
    });
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
        {/* <p>
          good sources: <a href="gifcities.org/">gifcities.org</a>
        </p> */}
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
            <img src={cursorUrl} alt="cursor url preview" />
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
