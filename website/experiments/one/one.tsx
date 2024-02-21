import "./one.scss";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { withPlay, PlayProvider } from "@playhtml/react";

interface ColorChange {
  color: string;
  timestamp: number;
}

function invertColor(hex, bw) {
  if (hex.indexOf("#") === 0) {
    hex = hex.slice(1);
  }
  // convert 3-digit hex to 6-digits.
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6) {
    throw new Error("Invalid HEX color.");
  }
  let r = parseInt(hex.slice(0, 2), 16),
    g = parseInt(hex.slice(2, 4), 16),
    b = parseInt(hex.slice(4, 6), 16);
  if (bw) {
    // http://stackoverflow.com/a/3943023/112731
    return r * 0.299 + g * 0.587 + b * 0.114 > 186 ? "#000000" : "#FFFFFF";
  }
  // invert color components
  r = (255 - r).toString(16);
  g = (255 - g).toString(16);
  b = (255 - b).toString(16);
  // pad each with zeros and return
  return "#" + padZero(r) + padZero(g) + padZero(b);
}

function padZero(str) {
  var zeros = new Array(2).join("0");
  return (zeros + str).slice(-2);
}

const ColorController = withPlay()(
  {
    defaultData: {
      colors: [] as ColorChange[],
    },
    myDefaultAwareness: undefined as undefined | { color: string },
  },
  ({ data, setData, awareness, setMyAwareness }) => {
    const { colors } = data;
    const currentColor = colors[colors.length - 1]?.color || "#ffffff";
    const [color, setColor] = useState(currentColor);

    useEffect(() => {
      if (colors.length === 0) return;
      setColor(colors[colors.length - 1].color);
    }, [data.colors]);

    useEffect(() => {
      // TODO: can't set to undefined to clear it.
      setMyAwareness(color === currentColor ? { color } : { color });
    }, [color]);

    const addColor = () => {
      const newColor = { color, timestamp: Date.now() };
      setData({ colors: [...colors, newColor] });
    };
    const colorsReversed = useMemo(() => [...colors].reverse(), [colors]);

    return (
      <div
        id="main"
        style={{
          minWidth: "100vw",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1em",
          "--background": currentColor,
          "--background-inverted": invertColor(currentColor, true),
        }}
      >
        {/* TODO: interesting gradients with what people have selected that hasnt been saved? maybe online indicators but the color is what they have selected and they have blurred treartment */}
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
            style={{
              "--color": color,
              "--color-inverted": invertColor(color, true),
            }}
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
                    // blur
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
    );
  }
);

// Website with a shared color.
ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider>
    {/* <ColorControllerNone
      data={{ colors: [{ color: "cadetblue", timestamp: 1708112357909 }] }}
      setData={() => {}}
    /> */}
    <ColorController></ColorController>
  </PlayProvider>
);
