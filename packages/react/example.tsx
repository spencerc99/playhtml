import * as React from "react";
import { Playable, playhtml } from "./src/index";
import { useEffect, useRef, useState } from "react";

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

interface Reaction {
  emoji: string;
  count: number;
}

export function ReactionView({ reaction }: { reaction: Reaction }) {
  const [hasReacted, setHasReacted] = useState(false);

  return (
    <Playable
      defaultData={reaction.count}
      onClick={(_e, { setData, data, element }) => {
        if (hasReacted) {
          setData(data - 1);
          localStorage.removeItem(element.id);
          setHasReacted(false);
        } else {
          setData(data + 1);
          localStorage.setItem(element.id, "true");
          setHasReacted(true);
        }
      }}
      additionalSetup={({ getElement }) => {
        setHasReacted(Boolean(localStorage.getItem(getElement().id)));
      }}
    >
      {(data) => {
        return (
          <button
            className={`reaction ${hasReacted ? "reacted" : ""}`}
            selector-id=".reactions reaction"
          >
            {reaction.emoji} <span className="count">{data}</span>
          </button>
        );
      }}
    </Playable>
  );
}
