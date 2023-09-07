import * as React from "react";
import { Playable, playhtml } from "./src/index";

playhtml.init();

export function Candle() {
  return (
    <Playable
      defaultData={{ on: false }}
      onClick={(_e, { data, setData }) => {
        setData({ on: !data.on });
      }}
      updateElement={({ element, data }) => {
        (element as HTMLImageElement).src = data.on
          ? "/public/candle-gif.gif"
          : "/public/candle-off.png";
      }}
    >
      <img
        src="/public/candle-gif.gif"
        selector-id=".candle"
        className="candle"
      />
    </Playable>
  );
}
