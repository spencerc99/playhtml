import ReactDOM from "react-dom";
import React from "react";
import { SESSIONS } from "./sessions";
import "./walking-together.scss";

function Home() {
  const sessions = [...SESSIONS].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="session-index">
      <ul>
        {sessions.map((s) => (
          <li key={s.id} className={s.archived ? "archived" : "active"}>
            <a href={`./index.html?session=${s.id}`}>{s.label}</a>
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
