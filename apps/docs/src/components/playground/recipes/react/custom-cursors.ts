// ABOUTME: Provides the copy-paste React source for the custom cursors recipe.
// ABOUTME: Passes onCustomCursorRender through PlayProvider and reads people with usePeople.
import { critterCursorCss, critterHelpers } from "../demo-shared";
import { appShell } from "./app-shell";

const typedHelpers = critterHelpers
  .replace("function critterFor(pid)", "function critterFor(pid: string): string")
  .replace(
    "function critterCursor(emoji, color)",
    "function critterCursor(emoji: string, color: string): string",
  );

export const customCursorsReactSource = `import { useEffect } from "react";
import { playhtml } from "playhtml";
import { PlayProvider, usePeople } from "@playhtml/react";

${typedHelpers}

// Called once for each other person's cursor. Fill in \`element\` and
// return it, or return null to keep the default arrow. playhtml moves the
// element and adds the person's name tag.
function renderCursor(pid: string, element: HTMLElement): HTMLElement {
  const person = playhtml.people.everyone.find((p) => p.pid === pid);
  const critter = document.createElement("div");
  critter.className = "critter";
  critter.textContent = critterFor(pid);
  critter.style.setProperty("--color", person?.color ?? "#1c1c1c");
  element.replaceChildren(critter);
  return element;
}

function CritterPad() {
  const { me } = usePeople();
  // onCustomCursorRender only draws other people. Draw your own pointer
  // with CSS so you see what everyone else sees.
  useEffect(() => {
    document.body.style.cursor = critterCursor(critterFor(me.pid), me.color);
  }, [me.pid, me.color]);

  return (
    <div className="critter-pad">
      <p>You're {critterFor(me.pid)} to everyone here.</p>
      <p>Open this page in a second window and move your mouse in both.</p>
    </div>
  );
}

${appShell(
  "CritterPad",
  critterCursorCss,
  `{
        developmentMode: true,
        cursors: { enabled: true, onCustomCursorRender: renderCursor },
      }`,
)}`;
