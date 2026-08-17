// ABOUTME: WWO Internal Office for granting beta access and navigating operator tools.
// ABOUTME: Keeps the admin credential in session storage and never places it in a URL.

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addInternalAccess,
  isValidPublicId,
  listInternalAccess,
  removeInternalAccess,
  type InternalAccessEntry,
} from "./internalAccessApi";
import "./style.scss";

const TOKEN_STORAGE_KEY = "wwo-admin-token";
const PLAYHTML_ADMIN_URL = "https://playhtml.fun/admin.html";

function shortPublicId(publicId: string): string {
  return `${publicId.slice(0, 12)}…${publicId.slice(-10)}`;
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState("");

  return (
    <main className="office-login">
      <div className="office-login__card">
        <span className="office-kicker">WE WERE ONLINE</span>
        <h1>Internal Office</h1>
        <p>Use the Worker admin key to open WWO operator tools.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (token.trim()) onLogin(token.trim());
          }}
        >
          <label htmlFor="admin-token">Admin key</label>
          <input
            id="admin-token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoFocus
          />
          <button type="submit" disabled={!token.trim()}>
            Enter office
          </button>
        </form>
        <a href={PLAYHTML_ADMIN_URL}>Open PlayHTML room admin →</a>
      </div>
    </main>
  );
}

function InternalOffice() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "",
  );
  const [entries, setEntries] = useState<InternalAccessEntry[]>([]);
  const [publicId, setPublicId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadEntries = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      setEntries(await listInternalAccess(token));
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : String(requestError),
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadEntries().catch(() => {});
  }, [loadEntries]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return entries;
    return entries.filter((entry) =>
      entry.publicId.toLowerCase().includes(normalizedQuery),
    );
  }, [entries, query]);

  if (!token) {
    return (
      <Login
        onLogin={(nextToken) => {
          sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
          setToken(nextToken);
        }}
      />
    );
  }

  const addEntry = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const entry = await addInternalAccess(token, publicId);
      setEntries((current) => [
        entry,
        ...current.filter((item) => item.publicId !== entry.publicId),
      ]);
      setPublicId("");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : String(requestError),
      );
    }
  };

  return (
    <div className="office-shell">
      <header className="office-header">
        <div>
          <span className="office-kicker">WE WERE ONLINE</span>
          <h1>Internal Office</h1>
        </div>
        <nav aria-label="Internal tools">
          <a aria-current="page" href="/internal/">Beta access</a>
          <span title="The curation desk will join this office when its branch lands">
            Commute curation
          </span>
          <a href={PLAYHTML_ADMIN_URL}>PlayHTML rooms ↗</a>
        </nav>
        <button
          className="office-header__logout"
          onClick={() => {
            sessionStorage.removeItem(TOKEN_STORAGE_KEY);
            setToken("");
          }}
        >
          Lock office
        </button>
      </header>

      <main className="office-main">
        <section className="office-intro">
          <div>
            <span className="office-section-number">DESK 01</span>
            <h2>Beta access</h2>
            <p>
              Add an extension public ID to reveal the experiments screen and
              enable every unfinished feature by default.
            </p>
          </div>
          <div className="office-count">
            <strong>{entries.length}</strong>
            <span>approved testers</span>
          </div>
        </section>

        <section className="office-panel">
          <form className="office-add" onSubmit={addEntry}>
            <label htmlFor="public-id">Extension public ID</label>
            <div>
              <input
                id="public-id"
                value={publicId}
                onChange={(event) => setPublicId(event.target.value)}
                placeholder="pk_…"
                spellCheck={false}
              />
              <button type="submit" disabled={!isValidPublicId(publicId)}>
                Grant access
              </button>
            </div>
            <small>
              The tester can copy this ID from their profile in the extension.
            </small>
          </form>

          <div className="office-list-header">
            <h3>Approved extensions</h3>
            <div>
              <input
                aria-label="Search approved public IDs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search IDs"
              />
              <button onClick={() => loadEntries()} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          {error && <p className="office-error">{error}</p>}
          {!loading && filteredEntries.length === 0 ? (
            <p className="office-empty">
              {entries.length === 0
                ? "No extension IDs have beta access yet."
                : "No approved IDs match that search."}
            </p>
          ) : (
            <ul className="office-list">
              {filteredEntries.map((entry) => (
                <li key={entry.publicId}>
                  <div>
                    <code title={entry.publicId}>{shortPublicId(entry.publicId)}</code>
                    <time dateTime={entry.addedAt}>
                      added {new Date(entry.addedAt).toLocaleString()}
                    </time>
                  </div>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Remove beta access for ${shortPublicId(entry.publicId)}?`)) {
                        return;
                      }
                      setError("");
                      try {
                        await removeInternalAccess(token, entry.publicId);
                        setEntries((current) =>
                          current.filter((item) => item.publicId !== entry.publicId),
                        );
                      } catch (requestError) {
                        setError(
                          requestError instanceof Error
                            ? requestError.message
                            : String(requestError),
                        );
                      }
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="office-roadmap">
          <span className="office-section-number">NEXT DESK</span>
          <h2>Commute curation</h2>
          <p>
            The commute stop review tool will use this same shell and navigation
            once its branch is ready to merge.
          </p>
        </aside>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <InternalOffice />,
);
