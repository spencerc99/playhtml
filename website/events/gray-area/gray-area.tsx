import ReactDOM from "react-dom";
import "./gray-area.scss";
import randomColor from "randomcolor";
import React from "react";

const NumCursors = 50;

function Cursors() {
  return (
    <div>
      {Array.from({ length: NumCursors }).map((_, i) => {
        const distanceX =
          Math.random() * 400 + 200 * (Math.random() > 0.5 ? 1 : -1);
        const distanceY =
          Math.random() * 400 + 200 * (Math.random() > 0.5 ? 1 : -1);
        // scale duration with distance
        const duration = Math.sqrt(distanceX ** 2 + distanceY ** 2) * 0.03;
        const color = randomColor({
          luminosity: "bright",
          format: "hsla",
          alpha: 0.8,
        });
        return (
          <img
            key={i}
            className="cursor"
            style={{
              "--bg-color": color,
              "--starting-x": `${Math.random() * 100}vw`,
              "--starting-y": `${Math.random() * 100}vh`,
              "--distance-x": `${distanceX}px`,
              "--distance-y": `${distanceY}px`,
              "--duration": `${duration}s`,
            }}
            src={`data:image/svg+xml,%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 28 28' enable-background='new 0 0 28 28' xml:space='preserve'%3E%3Cpolygon fill='${encodeURIComponent(
              color
            )}' points='8.2,20.9 8.2,4.9 19.8,16.5 13,16.5 12.6,16.6 '/%3E%3Cpolygon fill='${encodeURIComponent(
              color
            )}' points='17.3,21.6 13.7,23.1 9,12 12.7,10.5 '/%3E%3Crect x='12.5' y='13.6' transform='matrix(0.9221 -0.3871 0.3871 0.9221 -5.7605 6.5909)' fill='${encodeURIComponent(
              color
            )}' width='2' height='8'/%3E%3Cpolygon fill='${encodeURIComponent(
              color
            )}' points='9.2,7.3 9.2,18.5 12.2,15.6 12.6,15.5 17.4,15.5 '/%3E%3C/svg%3E`}
          />
        );
      })}
    </div>
  );
}

ReactDOM.render(<Cursors />, document.getElementById("react"));
