// ABOUTME: Provides copy-paste React sources for the basic built-in capability recipes.
// ABOUTME: Covers persistent movement and toggles plus presence-based shared hover.

export const canMoveReactSource = `// ABOUTME: Constrains two shared draggable images to one arena.
// ABOUTME: Uses stable ids so positions persist and synchronize across browsers.
import { PlayProvider, CanMoveElement } from "@playhtml/react";

const ARENA_ID = "ph-cap-move-arena";

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <div id={ARENA_ID} className="arena" aria-label="Drag the hat and cat">
          <CanMoveElement bounds={ARENA_ID}>
            <div id="ph-cap-hat" className="piece hat">
              <img src="https://playhtml.fun/docs/yankees-hat.png" alt="" draggable={false} />
            </div>
          </CanMoveElement>
          <CanMoveElement bounds={ARENA_ID}>
            <div id="ph-cap-cat" className="piece cat">
              <img src="https://playhtml.fun/docs/long-cat.png" alt="" draggable={false} />
            </div>
          </CanMoveElement>
        </div>
      </main>

      <style>{\`
        :root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { display: grid; min-height: 100vh; padding: 1rem; place-items: center; }
        main { width: min(40rem, 100%); }
        .arena {
          position: relative;
          width: 100%;
          height: min(14.75rem, calc(100vh - 2rem));
          overflow: hidden;
          border: 1.5px solid #1c1c1c;
          border-radius: 8px;
          background: #f1f2e9;
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
        }
        .piece {
          position: absolute;
          top: 0;
          left: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 0;
          background: transparent;
          cursor: grab;
          touch-action: none;
          user-select: none;
        }
        .piece:active { cursor: grabbing; }
        .hat { width: 4.5rem; height: 4.5rem; }
        .cat { width: 5.25rem; height: 9.5rem; }
        .piece img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
      \`}</style>
    </PlayProvider>
  );
}
`;

export const canToggleReactSource = `// ABOUTME: Shares one persistent on or off button across browsers.
// ABOUTME: Renders the established docs toggle from CanToggleElement data.
import { PlayProvider, CanToggleElement } from "@playhtml/react";

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <CanToggleElement>
          {({ data }) => (
            <button
              id="ph-docs-toggle-demo"
              type="button"
              className={data.on ? "toggle is-on" : "toggle"}
              aria-pressed={data.on}
            >
              <span className="dot" aria-hidden="true" />
              <span>{data.on ? "on" : "off"}</span>
            </button>
          )}
        </CanToggleElement>
      </main>

      <style>{\`
        :root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { display: grid; min-height: 100vh; padding: 1rem; place-items: center; }
        main { text-align: center; }
        .toggle {
          display: inline-flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.55rem 1rem;
          border: 2px solid #1c1c1c;
          border-radius: 6px;
          background: #ebe4d5;
          box-shadow: 2px 2px 0 #1c1c1c;
          color: #1c1c1c;
          cursor: pointer;
          font: 700 0.8rem/1 ui-monospace, monospace;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .toggle:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0 #1c1c1c; }
        .toggle:active { transform: translate(2px, 2px); box-shadow: none; }
        .toggle.is-on { background: #274b9e; color: #f4efe5; }
        .dot { width: 0.625rem; height: 0.625rem; border: 1px solid rgba(0, 0, 0, 0.35); border-radius: 999px; background: #79766f; }
        .toggle.is-on .dot { background: #e8a63a; box-shadow: 0 0 0 3px rgba(232, 166, 58, 0.25); }
      \`}</style>
    </PlayProvider>
  );
}
`;

export const canHoverReactSource = `// ABOUTME: Shares ephemeral hover state across connected browsers.
// ABOUTME: Styles the established docs hover pad from the PlayHTML attribute.
import { PlayProvider, CanHoverElement } from "@playhtml/react";

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <CanHoverElement>
          <div id="ph-cap-hover-pad" className="hover-pad">
            <p>Hover here with a friend - the pad lights up for everyone.</p>
          </div>
        </CanHoverElement>
      </main>

      <style>{\`
        :root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { display: grid; min-height: 100vh; padding: 1rem; place-items: center; }
        main { width: min(40rem, 100%); }
        .hover-pad {
          display: grid;
          width: min(22.5rem, 100%);
          min-height: 7.5rem;
          margin: 0 auto;
          padding: 1rem 1.1rem;
          place-items: center;
          border: 1.5px solid #1c1c1c;
          border-radius: 8px;
          background: linear-gradient(135deg, #ebe4d5, #ded6c7);
          box-shadow: 2px 2px 0 #1c1c1c;
          transition: background 150ms, transform 150ms;
        }
        .hover-pad[data-playhtml-hover] { background: linear-gradient(135deg, #e8a63a, #ded6c7); transform: translateY(-2px); }
        p { margin: 0; font-size: 0.92rem; line-height: 1.45; }
      \`}</style>
    </PlayProvider>
  );
}
`;
