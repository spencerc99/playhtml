import ReactDOM from "react-dom";
import React from "react";
import { SESSIONS } from "./sessions";
import "./walking-together.scss";

/** Home / index for walking-together: lists every session. The bare
 * /events/walking-together/ URL lands here; people pick a session to join,
 * which opens the session experience at session.html?session=<id>. */
function Home() {
  const sessions = [...SESSIONS].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="session-index">
      <ul>
        {sessions.map((s) => (
          <li key={s.id} className={s.archived ? "archived" : "active"}>
            <a href={`./session.html?session=${s.id}`}>{s.label}</a>
            <span className="session-date">{s.date}</span>
            {s.archived ? (
              <span className="session-tag">archived (read-only)</span>
            ) : (
              <span className="session-tag join">join</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

ReactDOM.render(<Home />, document.getElementById("react"));
