import * as React from "react";
import { CanPlayElement, CanToggleElement, playhtml } from "./src/index";
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
      {({ data }) => (
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
      {({ data }) => {
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
      {({ data }) => (
        <img
          src="/noguchi-akari-a1.png"
          selector-id=".lamp"
          className="lamp"
          id="lamp"
          style={{ opacity: data ? 1 : 0.5 }}
        />
      )}
    </CanToggleElement>
  );
}

export function OnlineIndicator() {
  return (
    <CanPlayElement defaultData={{}} myDefaultAwareness={"#008000"}>
      {({ myAwareness, setLocalAwareness, awareness }) => {
        return (
          <>
            {awareness.map((val) => (
              <div
                style={{
                  width: "50px",
                  height: "50px",
                  borderRadius: "50%",
                  background: val,
                }}
              ></div>
            ))}
            <input
              type="color"
              onChange={(e) => setLocalAwareness(e.target.value)}
              value={myAwareness}
            />
          </>
        );
      }}
    </CanPlayElement>
  );
}
