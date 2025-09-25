import "./one.scss";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState } from "@playhtml/react";
import { invertColor } from "../../utils/color";

interface ColorChange {
  color: string;
  timestamp: number;
}
const ColorController = withSharedState(
  {
    defaultData: {
      colors: [] as ColorChange[],
    },
    myDefaultAwareness: undefined as undefined | { color: string },
    // shared: true,
  },
  ({ data, setData, awareness, setMyAwareness }) => {
    const { colors } = data;
    // Get the latest color in the history, otherwise use white as the default background.
    const currentColor = colors[colors.length - 1]?.color || "#ffffff";
    const [color, setColor] = useState(currentColor);

    useEffect(() => {
      if (colors.length === 0) return;
      // Handle updating color with the latest once the history syncs (it starts as `defaultData` and then updates with the latets info)
      setColor(colors[colors.length - 1].color);
    }, [data.colors]);

    useEffect(() => {
      // Awareness is "live" information that isn't persisted. In this case, it will be an array of colors for each active user.
      setMyAwareness(color === currentColor ? { color } : { color });
    }, [color]);

    const addColor = () => {
      const newColor = { color, timestamp: Date.now() };
      // Update the history with the latest color. Updates globally and live for everyone on the site.
      setData((draft) => {
        draft.colors.push(newColor);
      });
    };
    const colorsReversed = useMemo(() => [...colors].reverse(), [colors]);

    return (
      <div
        id="main"
        style={
          {
            "--background-inverted": invertColor(currentColor, true),
            "--background": currentColor,
          } as React.CSSProperties
        }
      >
        <div
          style={{
            minWidth: "100vw",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1em",
          }}
        >
          <div
            className="colorController"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5em",
              alignItems: "center",
            }}
          >
            <input
              type="color"
              onChange={(e) => {
                setColor(e.target.value);
              }}
              value={color}
            />
            <button
              style={
                {
                  "--color": color,
                  "--color-inverted": invertColor(color, true),
                } as React.CSSProperties
              }
              disabled={color === currentColor}
              onClick={() => addColor()}
            >
              Change color
            </button>
            <div id="awareness">
              {awareness.map((a) => {
                return (
                  <div
                    style={{
                      background: a.color,
                      width: "2em",
                      height: "2em",
                      filter: "blur(4px)",
                      boxShadow: `0 0 8px 4px ${a.color}`,
                      borderRadius: "50%",
                    }}
                  ></div>
                );
              })}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: "300px",
              gap: ".5em",
              paddingBottom: "4em",
            }}
          >
            <p>the website's color has been changed {colors.length} times</p>
            <details>
              <summary>history</summary>
              <table>
                <thead>
                  <th>color</th>
                  <th>date</th>
                </thead>
                <tbody>
                  {colorsReversed.map(({ color, timestamp }) => (
                    <tr>
                      <td>
                        <div
                          style={{
                            display: "inline-block",
                            width: "1em",
                            height: "1em",
                            background: color,
                            verticalAlign: "middle",
                            border: `1px solid ${invertColor(color, true)}`,
                            marginRight: "4px",
                          }}
                        ></div>
                        {color}
                      </td>
                      <td>
                        {new Date(timestamp).toLocaleDateString()}{" "}
                        {new Date(timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        </div>
        <footer>
          <div>
            <a href="https://playhtml.fun">playhtml</a> experiment{" "}
            <a href="https://github.com/spencerc99/playhtml/blob/main/website/experiments/one/">
              "01"
            </a>
          </div>
        </footer>
      </div>
    );
  }
);

// Website with a shared color.
ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider initOptions={{}}>
    <ColorController></ColorController>
  </PlayProvider>
);
