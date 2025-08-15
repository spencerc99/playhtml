import "../home.scss";
import React, { PropsWithChildren } from "react";
import ReactDOM from "react-dom/client";
import {
  CanGrowElement,
  CanHoverElement,
  withSharedState,
  PlayProvider,
  CanMoveElement,
  CanSpinElement,
} from "@playhtml/react";
import { ReactionView } from "../../packages/react/examples/Reaction";
import { Lamp } from "../../packages/react/examples/SharedLamp";
import { OnlineIndicator } from "../../packages/react/examples/OnlineIndicator";
import { ConfettiZone } from "../../packages/react/examples/Confetti";
import { LiveVisitorCount } from "../../packages/react/examples/VisitorCount";
import { ViewCount } from "../../packages/react/examples/ViewCount";
import { LiveChat } from "../../packages/react/examples/LiveChat";
import { FridgeWord } from "../../packages/react/examples/FridgeWord";
import { CanResizeElement } from "../../packages/react/examples/resizable";
import { RandomSpinner } from "../../packages/react/examples/RandomSpinner";
import { Poll } from "../../packages/react/examples/Poll";
import { SharedTimer } from "../../packages/react/examples/SharedTimer";
import { SharedSlider } from "../../packages/react/examples/SharedSlider";
import { LiveReactions } from "../../packages/react/examples/LiveReactions";
// import { CursorOverlap } from "../../packages/react/examples/CursorOverlap";
import { SharedSound } from "../../packages/react/examples/SharedSound";

const Candle = withSharedState(
  { defaultData: { on: false } },
  ({ data, setData }) => {
    return (
      <img
        src={data.on ? "/candle-gif.gif" : "/candle-off.png"}
        selector-id=".candle"
        className="candle"
        onClick={() => {
          setData({ on: !data.on });
        }}
      />
    );
  }
);

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider>
    <div>
      <Candle />
      <ReactionView reaction={{ emoji: "🧡", count: 1 }} />
      <Lamp />
      <CanMoveElement>
        <div
          style={{
            width: "100px",
            height: "100px",
            background: "blue",
          }}
          className="moveBox"
        ></div>
      </CanMoveElement>
      <CanSpinElement>
        <div
          style={{
            width: "100px",
            height: "100px",
            background: "yellow",
          }}
          className="moveBox"
        ></div>
      </CanSpinElement>
      <OnlineIndicator />
      <CanGrowElement>
        <div id="plant"></div>
      </CanGrowElement>
      <CanHoverElement>
        <div
          style={{
            width: "100px",
            height: "100px",
            background: "red",
          }}
          id="hover"
          className="hoverBox"
        ></div>
      </CanHoverElement>
      <CanResizeElement
        initialHeight={150}
        initialWidth={150}
        onResize={() => {}}
      >
        <div
          id="resize"
          style={{
            border: "1px solid black",
            background: "orange",
            width: "100%",
            height: "100%",
          }}
        ></div>
      </CanResizeElement>
      <ConfettiZone />
      <LiveVisitorCount />
      <ViewCount />
      <LiveChat name="Live Chat" />
      <FridgeWord word="Hello" color="red" />
      <FridgeWord word="World" color="blue" />
      <FridgeWord word="tender" color="green" />
      <FridgeWord word="days" color="yellow" />
      <div style={{ display: "flex", flexDirection: "column", gap: "3em" }}>
        <RandomSpinner
          options={["Confetti", "Lamp", "Live Chat", "Poll", "Picker"]}
        />
        {/* Custom RandomSpinner with "we're so back" and "it's so over" */}
        <RandomSpinner
          options={["we're so back", "it's so over"]}
          colors={["#22c55f", "#ef4444"]} // green and red
        />
        <Poll
          question="Which example should we build next?"
          options={["Poll", "Random Picker", "Drawing", "Shared Music"]}
        />
        <SharedTimer durationMs={120000} />
        <SharedSlider label="Vibes" min={0} max={100} step={1} />
        <LiveReactions emoji="💥" />
        <SharedSound soundUrl={"/lamp-on.m4a"} />
      </div>
      {/* <MirrorableElement></MirrorableElement> */}
    </div>
  </PlayProvider>
);
