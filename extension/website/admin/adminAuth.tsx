// ABOUTME: Shares session-scoped authentication and navigation across WWO admin pages.
// ABOUTME: Keeps the Worker admin token out of URLs and persistent browser storage.

import { useState } from "react";

const TOKEN_STORAGE_KEY = "wwo-admin-token";
const PLAYHTML_ADMIN_URL = "https://playhtml.fun/admin.html";

export type AdminPage = "access" | "installation";

export function useAdminToken() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "");

  return {
    token,
    login(nextToken: string) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
      setToken(nextToken);
    },
    logout() {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
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
        <span title="The curation desk will join this office when its branch lands">Commute curation</span>
        <a href={PLAYHTML_ADMIN_URL}>PlayHTML rooms ↗</a>
      </nav>
      <button className="office-header__logout" onClick={onLogout}>Lock office</button>
    </header>
  );
}
