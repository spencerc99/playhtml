// Docs live demo for names and colors: shows your saved name and color and
// lets you change them. Mirrors the snippet on the People and presence page.
import React, { useEffect, useState } from "react";
import { playhtml } from "playhtml";
import { usePagePeople } from "./usePagePeople";

// <input type="color"> only takes hex, but default colors are hsl().
function toHex(color: string): string {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return "#000000";
  context.fillStyle = color;
  return context.fillStyle;
}

export function YourNameDemo(): React.ReactElement {
  const everyone = usePagePeople();
  const me = everyone.find((person) => person.isMe);
  const [draftName, setDraftName] = useState("");

  // Keep the field in sync when your name changes elsewhere (another tab).
  useEffect(() => {
    setDraftName(me?.name ?? "");
  }, [me?.name]);

  const saveName = () => {
    const name = draftName.trim();
    if (me && name !== (me.name ?? "")) playhtml.people.me.name = name;
  };

  return (
    <div className="ph-identity">
      <div className="ph-identity__card">
        <span
          className="ph-identity__dot"
          style={{ background: me?.color ?? "transparent" }}
          aria-hidden="true"
        />
        <span className="ph-identity__name">
          {me ? (me.name ?? "anonymous") : "connecting…"}
        </span>
      </div>
      <div className="ph-identity__fields">
        <label className="ph-identity__field">
          <span>name</span>
          <input
            value={draftName}
            placeholder="your name"
            maxLength={40}
            disabled={!me}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <label className="ph-identity__field">
          <span>color</span>
          <input
            type="color"
            value={me ? toHex(me.color) : "#000000"}
            disabled={!me}
            onChange={(event) =>
              (playhtml.people.me.color = event.target.value)
            }
          />
        </label>
      </div>
    </div>
  );
}
