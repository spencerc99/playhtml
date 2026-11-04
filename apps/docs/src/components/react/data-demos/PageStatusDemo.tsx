// Docs live demo for page presence: everyone picks a status with
// setMyPresence("status", ...) and sees each other's. Mirrors the snippet in
// the Page presence section.
import React from "react";
import { playhtml } from "playhtml";
import { usePagePeople } from "./usePagePeople";

const STATUSES = ["reading", "coding", "taking a break"];

export function PageStatusDemo(): React.ReactElement {
  // Updates when someone joins, leaves, renames, or changes their status.
  const everyone = usePagePeople("status");
  const me = everyone.find((person) => person.isMe);
  const myStatus = me?.presence.status as string | undefined;

  const pick = (status: string) =>
    playhtml.people.setMyPresence(
      "status",
      myStatus === status ? null : status,
    );

  return (
    <div className="ph-status-board">
      <div
        className="ph-status-board__picker"
        role="group"
        aria-label="Your status"
      >
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className="ph-status-board__option"
            aria-pressed={myStatus === status}
            disabled={!me}
            onClick={() => pick(status)}
          >
            {status}
          </button>
        ))}
      </div>
      <ul className="ph-status-board__list">
        {everyone.map((person) => (
          <li key={person.pid} className="ph-status-board__row">
            <span
              className="ph-status-board__dot"
              style={{ background: person.color }}
              aria-hidden="true"
            />
            <span className="ph-status-board__name">
              {person.name ?? "anonymous"}
              {person.isMe ? " (you)" : ""}
            </span>
            <span className="ph-status-board__status">
              {(person.presence.status as string | undefined) ?? "…"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
