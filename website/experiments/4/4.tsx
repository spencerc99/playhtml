import "./4.scss";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState } from "@playhtml/react";

interface ColorChange {
  color: string;
  timestamp: number;
}
const TotalHexColors = 16777216;

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

function hueRotate(hex, degrees) {
  // Convert hexadecimal color to RGB
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Convert RGB to HSL
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;
  const max = Math.max(r1, g1, b1);
  const min = Math.min(r1, g1, b1);
  let h,
    s,
    l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // Achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r1:
        h = (g1 - b1) / d + (g1 < b1 ? 6 : 0);
        break;
      case g1:
        h = (b1 - r1) / d + 2;
        break;
      case b1:
        h = (r1 - g1) / d + 4;
        break;
    }
    h /= 6;
  }

  if (s < 0.05) {
    s = (1 - s) / 4;
  }
  if (l > 0.95) {
    l = l / 2;
  }
  if (l < 0.3) {
    l = (1 - l) / 2;
  }

  // Rotate hue
  h = (h + degrees / 360) % 1;

  // Convert HSL back to RGB (not needed)

  // Return HSL values
  const hue = Math.round(h * 360);
  const saturation = Math.round(s * 100);
  const lightness = Math.round(l * 100);

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function padZero(str) {
  var zeros = new Array(2).join("0");
  return (zeros + str).slice(-2);
}

const ColorController = withSharedState(
  {
    defaultData: {
      colors: [] as ColorChange[],
    },
    myDefaultAwareness: undefined as undefined | { color: string },
  },
  ({ data, setData, awareness, setMyAwareness }) => {
    const { colors } = data;
    // Get the latest color in the history, otherwise use white as the default background.
    const colorSet = useMemo(
      () => new Set(colors.map((c) => c.color)),
      [colors]
    );
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
      setData({ colors: [...colors, newColor] });
    };
    const colorsReversed = useMemo(() => [...colors].reverse(), [colors]);
    const isInvalidColor = color === currentColor || colorSet.has(color);

    return (
      <div
        id="main"
        style={{
          "--background-inverted": invertColor(currentColor, true),
          "--background": currentColor,
        }}
      >
        <div className="backgrounds">
          {colorsReversed.map(({ color, timestamp }) => (
            <div
              style={{
                "--background-accent": hueRotate(color, 90),
                "--background": color,
                "--color": invertColor(color, true),
              }}
              className={
                color === currentColor ? "background selected" : "background"
              }
            >
              <h3
                onClick={() => {
                  setColor(color);
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    width: ".8em",
                    height: ".8em",
                    background: color,
                    verticalAlign: "middle",
                    border: `1px solid var(--color)`,
                    marginRight: "4px",
                  }}
                ></div>
                {color}
              </h3>
              <p>
                {new Date(timestamp).toLocaleDateString()} at{" "}
                {new Date(timestamp).toLocaleTimeString()}
              </p>
            </div>
          ))}
        </div>
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
              style={{
                "--color": color,
                "--color-inverted": invertColor(color, true),
              }}
              disabled={isInvalidColor}
              onClick={() => addColor()}
            >
              Change color
            </button>
            {colorSet.has(color) && (
              <p className="error">{color} has already been selected!</p>
            )}
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
              zIndex: 5,
              mixBlendMode: "difference",
              color: "white",
            }}
          >
            <p>
              {/* Animate these numbers */}
              <AnimatedCounter start={0} end={colors.length} /> colors have been
              added.{" "}
              <AnimatedCounter
                start={TotalHexColors}
                end={TotalHexColors - colors.length}
              />{" "}
              left.
            </p>
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
            <a href="https://playhtml.fun/experiments">playhtml experiment</a>{" "}
            <a href="https://github.com/spencerc99/playhtml/blob/main/website/experiments/4/">
              "04"
            </a>
          </div>
        </footer>
      </div>
    );
  }
);

const AnimatedCounter = ({ start, end, duration = 1500 }) => {
  const direction = start < end ? "up" : "down";
  const [counter, setCounter] = useState(start);

  useEffect(() => {
    let startTime = null;
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const value =
        direction === "up"
          ? Math.floor(progress * (end - start) + start)
          : Math.ceil(start - progress * (start - end));
      setCounter(value);
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(window.requestAnimationFrame(step));
    };
  }, [start, end, duration, direction]);

  return <span>{counter}</span>;
};

// Website with a shared color.
ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider>
    <ColorController></ColorController>
  </PlayProvider>
);
