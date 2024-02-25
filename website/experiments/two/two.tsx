import "./two.scss";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState } from "@playhtml/react";

interface Cursor {
  cursorUrl: string;
  timestamp: number;
}

const ColorController = withSharedState(
  {
    defaultData: {
      cursors: [] as Cursor[],
    },
  },
  ({ data, setData }) => {
    const [cursorUrl, setCursorUrl] = useState<string>("");
    // const [cursorFile, setCursorFile] = useState<string>("");
    // const [cursorFileEncoded, setCursorFileEncoded] = useState<string>("");
    const { cursors } = data;
    const cursorsSet = new Set(cursors.map((cursor) => cursor.cursorUrl));
    console.log(cursors);
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
    }
    return (
      <div id="cursorsMain">
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
        <h1>All Cursors</h1>
        <div className="cursors">
          <div
            className="cursor"
            onClick={() => {
              document.body.style.cursor = "";
            }}
          >
            original
          </div>
          {cursors.map((cursor) => (
            <div
              key={cursor.timestamp}
              className={`cursor ${
                cursor.cursorUrl === cursorUrl ? "active" : ""
              }`}
              onClick={() => changeCursorUrl(cursor.cursorUrl)}
              style={{
                cursor: `url(${cursor.cursorUrl}), auto`,
              }}
            >
              <img src={cursor.cursorUrl} alt="cursor" />
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
    <ColorController></ColorController>
  </PlayProvider>
);
