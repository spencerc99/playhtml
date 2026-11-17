// ABOUTME: React starter app showcasing the main playhtml capabilities.
// ABOUTME: Same sections as the HTML starter and the playground at playhtml.fun/docs/play.

import { useContext, useEffect, useRef, useState } from "react";
import {
  PlayProvider,
  PlayContext,
  CanMoveElement,
  CanSpinElement,
  CanToggleElement,
  CanGrowElement,
  CanHoverElement,
  CanDuplicateElement,
  withSharedState,
} from "@playhtml/react";

// Shared data: one color everyone sees.
const ColorBox = withSharedState(
  { defaultData: { color: "white" } },
  ({ data, setData }) => (
    <section id="colorBox">
      <input readOnly style={{ backgroundColor: data.color }} />
      <button
        onClick={() =>
          setData((draft) => {
            draft.color = draft.color === "red" ? "green" : "red";
          })
        }
      >
        change color
      </button>
    </section>
  ),
);

// Shared data as a list: appended entries appear for everyone.
const Guestbook = withSharedState(
  { defaultData: { entries: [] as string[] } },
  ({ data, setData }) => {
    const [value, setValue] = useState("");
    const sayHi = () => {
      if (!value) return;
      setData((draft) => {
        draft.entries.push(value);
      });
      setValue("");
    };
    return (
      <div id="guestbook">
        <section>
          <input
            placeholder="say hi..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button onClick={sayHi}>say hi</button>
        </section>
        <ul>
          {data.entries.map((entry, i) => (
            <li key={i}>{entry}</li>
          ))}
        </ul>
      </div>
    );
  },
);

// Events: a one-off moment everyone sees, nothing saved.
function ShootingStar() {
  const { registerPlayEventListener, removePlayEventListener, dispatchPlayEvent } =
    useContext(PlayContext);
  const star = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = registerPlayEventListener("shootingStar", {
      onEvent: () => {
        star.current?.animate(
          [
            { transform: "translate(100vw, 100vh) rotate(0deg)" },
            { transform: "translate(-10vw, -10vh) rotate(360deg)" },
          ],
          { duration: 2000 },
        );
      },
    });
    return () => removePlayEventListener("shootingStar", id);
  }, [registerPlayEventListener, removePlayEventListener]);

  return (
    <>
      <button onClick={() => dispatchPlayEvent({ type: "shootingStar" })}>
        shooting star!
      </button>
      <div id="shootingStar" ref={star}>
        ★
      </div>
    </>
  );
}

// withSharedState: your own shared element with custom data.
const ReactionButton = withSharedState(
  { defaultData: { count: 0 } },
  ({ data, setData }) => {
    const [hasReacted, setHasReacted] = useState(() =>
      Boolean(localStorage.getItem("reacted")),
    );
    const react = () => {
      setData((draft) => {
        draft.count += hasReacted ? -1 : 1;
      });
      if (hasReacted) localStorage.removeItem("reacted");
      else localStorage.setItem("reacted", "1");
      setHasReacted(!hasReacted);
    };
    return (
      <button id="reactionBtn" className={hasReacted ? "reacted" : ""} onClick={react}>
        react {data.count}
      </button>
    );
  },
);

function App() {
  const star = useRef<HTMLSpanElement>(null);

  return (
    <PlayProvider
      initOptions={{
        developmentMode: true,
        cursors: { enabled: true, room: "page" },
      }}
    >
      <h1>Hello World!</h1>
      <p>Everything below is shared with everyone on this page.</p>

      {/* Built-in capabilities: wrap an element that has an id. */}
      <section>
        <CanSpinElement>
          <img id="illustration" src="/illustration.svg" alt="Spin me" />
        </CanSpinElement>
        <CanMoveElement>
          <img id="openSign" src="/open-sign.gif" alt="Drag me" style={{ width: "auto" }} />
        </CanMoveElement>
        <CanToggleElement>
          <img id="lamp" src="/lamp.png" alt="Toggle me" />
        </CanToggleElement>
        <CanToggleElement>
          <img id="catOrDog" src="/cat.jpg" alt="Toggle me" />
        </CanToggleElement>
        <CanGrowElement>
          <img id="plant" src="/plant.png" alt="Grow me" />
        </CanGrowElement>
        <CanHoverElement>
          <div id="hoverBox" />
        </CanHoverElement>
        <span id="star" ref={star} style={{ fontSize: "32px" }}>
          ★
        </span>
        <CanDuplicateElement elementToDuplicate={star}>
          <button id="duplicateBtn">add a star</button>
        </CanDuplicateElement>
      </section>

      <ColorBox />

      <h2>guestbook</h2>
      <Guestbook />

      <h2>events</h2>
      <ShootingStar />

      <h2>custom elements</h2>
      <ReactionButton />
    </PlayProvider>
  );
}

export default App;
