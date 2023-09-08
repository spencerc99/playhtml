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
    >
      {(data) => (
        <img
          src={data.on ? "/candle-gif.gif" : "/candle-off.png"}
          selector-id=".candle"
          className="candle"
        />
      )}
    </Playable>
  );
}
