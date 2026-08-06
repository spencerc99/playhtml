// ABOUTME: Provides copy-paste React sources for the basic built-in capability recipes.
// ABOUTME: Covers persistent movement and toggles plus presence-based shared hover.

export const canMoveReactSource = `// ABOUTME: Constrains two shared draggable stickers to one arena.
// ABOUTME: Uses stable ids so positions persist and synchronize across browsers.
import { PlayProvider, CanMoveElement } from "@playhtml/react";

const ARENA_ID = "move-arena";

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <h1>Drag together</h1>
        <p>Move either sticker. Its position updates in every connected browser.</p>
        <div id={ARENA_ID} className="arena">
          <CanMoveElement bounds={ARENA_ID}>
            <div
              id="move-hat"
              className="piece hat"
              role="img"
              aria-label="A draggable baseball cap"
            >
              🧢
            </div>
          </CanMoveElement>
          <CanMoveElement bounds={ARENA_ID}>
            <div
              id="move-cat"
              className="piece cat"
              role="img"
              aria-label="A draggable cat"
            >
              🐈
            </div>
          </CanMoveElement>
        </div>
      </main>

      <style>{\`
        :root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { display: grid; min-height: 100vh; padding: 1.5rem; place-items: center; }
        main { width: min(38rem, 100%); }
        h1 { margin: 0 0 0.35rem; font-size: clamp(2rem, 8vw, 3.5rem); }
        p { margin: 0 0 1rem; line-height: 1.5; }
        .arena {
          position: relative;
          height: 20rem;
          overflow: hidden;
          border: 2px solid #1c1c1c;
          background: #dce8cf;
          box-shadow: 5px 5px 0 #1c1c1c;
        }
        .piece {
          position: absolute;
          display: grid;
          width: 8rem;
          height: 8rem;
          place-items: center;
          font-size: 6rem;
          touch-action: none;
          user-select: none;
        }
        .hat { top: 2rem; left: 2rem; }
        .cat { right: 2rem; bottom: 1.5rem; }
      \`}</style>
    </PlayProvider>
  );
}
`;

export const canToggleReactSource = `// ABOUTME: Shares one persistent on or off switch across browsers.
// ABOUTME: Renders the switch directly from CanToggleElement data.
import { PlayProvider, CanToggleElement } from "@playhtml/react";

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <h1>Shared switch</h1>
        <p>Click the switch. Everyone sees the same state.</p>
        <CanToggleElement>
          {({ data }) => (
            <button
              id="shared-switch"
              type="button"
              className={data.on ? "switch is-on" : "switch"}
              aria-pressed={data.on}
            >
              <span className="track"><span className="thumb" /></span>
              <span>{data.on ? "on" : "off"}</span>
            </button>
          )}
        </CanToggleElement>
      </main>

      <style>{\`
        :root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { display: grid; min-height: 100vh; padding: 1.5rem; place-items: center; }
        main { width: min(28rem, 100%); text-align: center; }
        h1 { margin: 0 0 0.35rem; font-size: clamp(2rem, 9vw, 3.5rem); }
        p { margin: 0 0 1.25rem; }
        .switch {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border: 2px solid #1c1c1c;
          background: #ebe4d5;
          box-shadow: 4px 4px 0 #1c1c1c;
          cursor: pointer;
          font: 700 1rem/1 system-ui, sans-serif;
        }
        .track {
          display: flex;
          width: 3.5rem;
          padding: 0.2rem;
          border: 2px solid #1c1c1c;
          background: #d7cfc0;
        }
        .thumb { width: 1.25rem; height: 1.25rem; background: #1c1c1c; transition: translate 150ms; }
        .is-on { background: #b9dfad; }
        .is-on .thumb { translate: 1.55rem 0; }
      \`}</style>
    </PlayProvider>
  );
}
`;

export const canHoverReactSource = `// ABOUTME: Shares ephemeral hover state across connected browsers.
// ABOUTME: Styles the element from the data-playhtml-hover attribute.
import { PlayProvider, CanHoverElement } from "@playhtml/react";

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <h1>Shared hover</h1>
        <p>Hover over the card. It lights up for everyone currently connected.</p>
        <CanHoverElement>
          <div id="shared-hover-card" className="hover-card">
            hover here
          </div>
        </CanHoverElement>
      </main>

      <style>{\`
        :root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { display: grid; min-height: 100vh; padding: 1.5rem; place-items: center; }
        main { width: min(32rem, 100%); text-align: center; }
        h1 { margin: 0 0 0.35rem; font-size: clamp(2rem, 9vw, 3.5rem); }
        p { margin: 0 0 1.25rem; line-height: 1.5; }
        .hover-card {
          display: grid;
          min-height: 12rem;
          place-items: center;
          border: 2px solid #1c1c1c;
          background: #dce8cf;
          box-shadow: 5px 5px 0 #1c1c1c;
          font-size: 1.4rem;
          font-weight: 800;
          transition: background 150ms, transform 150ms;
        }
        .hover-card[data-playhtml-hover] { background: #f3cf58; transform: scale(1.03); }
      \`}</style>
    </PlayProvider>
  );
}
`;
