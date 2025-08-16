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
  CanToggleElement,
  usePlayContext,
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

// Loading State Test Component
const LoadingStateTest = () => {
  const { hasSynced } = usePlayContext();

  return (
    <div
      style={{ padding: "20px", border: "2px solid #333", margin: "20px 0" }}
    >
      <h3>Enhanced Loading State Tests</h3>
      <p style={{ marginBottom: "20px" }}>
        Sync Status:{" "}
        <strong>{hasSynced ? "✅ Synced" : "⏳ Loading..."}</strong>
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "20px",
        }}
      >
        {/* can-play with opt-in loading */}
        <WithSharedStateCanPlayWithLoading />

        {/* Custom loading with breathing + custom class */}
        <CanMoveElement
          defaultData={{ x: 0, y: 0 }}
          loading={{ behavior: "animate", customClass: "custom-loader" }}
        >
          <div
            style={{
              width: "180px",
              height: "100px",
              background: "linear-gradient(45deg, #ffeaa7, #fdcb6e)",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              fontWeight: "bold",
              color: "white",
              textShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          >
            Custom class
          </div>
        </CanMoveElement>
      </div>

      <style>
        {`
          .custom-loader {
            border: 3px solid #fff !important;
            box-shadow: 0 0 15px rgba(255,255,255,0.5) !important;
          }
        `}
      </style>
    </div>
  );
};

// can-play with opt-in loading
const WithSharedStateCanPlayWithLoading = withSharedState(
  {
    defaultData: { count: 0 },
    loading: { behavior: "animate", style: "pulse" },
  },
  ({ data, setData }) => (
    <div
      style={{
        width: "180px",
        height: "100px",
        background: "linear-gradient(45deg, #fd79a8, #e17055)",
        borderRadius: "12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "16px",
        fontWeight: "bold",
        color: "white",
        textShadow: "0 1px 3px rgba(0,0,0,0.3)",
        cursor: "pointer",
      }}
      onClick={() => setData({ count: data.count + 1 })}
    >
      can-play (pulse) - {data.count}
    </div>
  )
);

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider>
    <div>
      <LoadingStateTest />
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
