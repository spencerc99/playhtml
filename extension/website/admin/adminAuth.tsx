// ABOUTME: Shares authentication and navigation across WWO admin pages.
// ABOUTME: Keeps the Worker admin token out of URLs; remembers it in this browser for 30 days of inactivity.

import { useState } from "react";
import { clearAdminToken, loadAdminToken, saveAdminToken } from "./adminToken";

const PLAYHTML_ADMIN_URL = "https://playhtml.fun/admin.html";

export type AdminPage = "access" | "installation";

export function useAdminToken() {
  const [token, setToken] = useState(loadAdminToken);

  return {
    token,
    login(nextToken: string) {
      saveAdminToken(nextToken);
      setToken(nextToken);
    },
    logout() {
      clearAdminToken();
      setToken("");
    },
  };
}

export function AdminLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <main className="office-login">
      <div className="office-login__card">
        <span className="office-kicker">WE WERE ONLINE</span>
        <h1>Internal Office</h1>
        <p>Use the Worker admin key to open WWO operator tools.</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (token.trim()) onLogin(token.trim());
        }}>
          <label htmlFor="admin-token">Admin key</label>
          <input id="admin-token" type="password" autoComplete="current-password" value={token}
            onChange={(event) => setToken(event.target.value)} autoFocus />
          <button type="submit" disabled={!token.trim()}>Enter office</button>
        </form>
        <a href={PLAYHTML_ADMIN_URL}>Open PlayHTML room admin →</a>
      </div>
    </main>
  );
}

export function AdminHeader({
  currentPage,
  onLogout,
}: {
  currentPage: AdminPage;
  onLogout: () => void;
}) {
  return (
    <header className="office-header">
      <div><span className="office-kicker">WE WERE ONLINE</span><h1>Internal Office</h1></div>
      <nav aria-label="Internal tools">
        <a aria-current={currentPage === "access" ? "page" : undefined} href="/admin/">Access control</a>
        <a aria-current={currentPage === "installation" ? "page" : undefined}
          href="/admin/installation/">Installation</a>
        <a href="/internet-map/">Internet map</a>
        <a href="/commute-curation/">Commute curation</a>
        <a href={PLAYHTML_ADMIN_URL}>PlayHTML rooms ↗</a>
      </nav>
      <button className="office-header__logout" onClick={onLogout}>Lock office</button>
    </header>
  );
}
