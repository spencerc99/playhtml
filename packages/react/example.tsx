import * as React from "react";
import {
  CanDuplicateElement,
  CanPlayElement,
  CanToggleElement,
  playhtml,
} from "./src/index";
import { useState } from "react";

playhtml.init();

export function Candle() {
  return (
    <CanPlayElement
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
    </CanPlayElement>
  );
}

interface Reaction {
  emoji: string;
  count: number;
}

export function ReactionView({ reaction }: { reaction: Reaction }) {
  const [hasReacted, setHasReacted] = useState(false);

  return (
    <CanPlayElement
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
    </CanPlayElement>
  );
}

export function Lamp() {
  return (
    <CanToggleElement>
      <img
        src="/noguchi-akari-a1.png"
        selector-id=".lamp"
        className="lamp"
        id="lamp"
      />
    </CanToggleElement>
  );
}
