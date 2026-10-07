// ABOUTME: Shares authentication and navigation across WWO admin pages.
// ABOUTME: Keeps the Worker admin token out of URLs; remembers it in this browser for 30 days of inactivity.

import { useState } from "react";

const TOKEN_STORAGE_KEY = "wwo-admin-token";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLAYHTML_ADMIN_URL = "https://playhtml.fun/admin.html";

export type AdminPage = "access" | "installation";

function saveToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt: Date.now() + TOKEN_TTL_MS }));
}

// Each visit pushes the expiry out again, so regular use never signs you out.
function loadToken(): string {
  const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) return "";
  try {
    const stored = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (typeof stored.token === "string" && typeof stored.expiresAt === "number" && stored.expiresAt > Date.now()) {
      saveToken(stored.token);
      return stored.token;
    }
  } catch {
    // Unreadable entry: treat as signed out.
  }
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  return "";
}

export function useAdminToken() {
  const [token, setToken] = useState(loadToken);

  return {
    token,
    login(nextToken: string) {
      saveToken(nextToken);
      setToken(nextToken);
    },
    logout() {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
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
