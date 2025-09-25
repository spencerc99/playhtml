import { useState } from "react";
import { usePlayContext } from "../src";
import React from "react";

export function CursorOnlineIndicator() {
  const { cursors } = usePlayContext();
  const visitors = cursors.allColors;

  return (
    <span>
      ppl
      <span
        className="text-xs"
        style={{
          letterSpacing: "-0.05em",
        }}
      >
        ({visitors.length})
      </span>
      :{" "}
      <div className="flex gap-[2px] inline-flex">
        {visitors.map((color, index) => {
          const hasDuplicate = visitors.filter((c) => c === color).length > 1;
          const key = hasDuplicate ? `${color}-${index}` : color;
          return <CursorColor key={key} color={color} isFirst={index === 0} />;
        })}
      </div>
    </span>
  );
}

const CursorColor = ({
  color,
  isFirst = false,
}: {
  color: string;
  isFirst?: boolean;
}) => {
  const [internalColor, setInternalColor] = useState(color);
  return (
    <div className="relative inline-block">
      {isFirst && (
        <span className="absolute -top-[2px] left-1/2 -translate-x-1/2 text-[8px] leading-none">
          you
        </span>
      )}
      {isFirst ? (
        <div
          className="relative"
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            display: "inline-block",
            backgroundColor: color,
          }}
        >
          <input
            type="color"
            value={color}
            // trigger when user closes the color picker
            onChange={(e) => {
              setInternalColor(e.target.value);
            }}
            onBlur={() => {
              if (window.cursors) {
                if (internalColor !== color) {
                  window.cursors.color = internalColor;
                }
              }
            }}
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              display: "inline-block",
              opacity: 0,
              backgroundColor: color,
              position: "absolute",
              top: 0,
              left: 0,
            }}
          />
        </div>
      ) : (
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            display: "inline-block",
            backgroundColor: color,
          }}
        />
      )}
    </div>
  );
};
