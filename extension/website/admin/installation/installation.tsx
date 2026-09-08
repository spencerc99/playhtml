// ABOUTME: Operates the production WWO installation screens from the authenticated office.
// ABOUTME: Lists stable machine URLs and advances their shared reload generation.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminHeader, AdminLogin, useAdminToken } from "../adminAuth";
import "../style.scss";
import { buildLiveInstallationScreens } from "../../shared/utils/installationUrls";
import {
  getCurrentInstallationControl,
  reloadInstallationScreens,
} from "./installationControlApi";
import type { InstallationControl } from "../../shared/utils/installationControlApi";

const PRODUCTION_ORIGIN = "https://wewere.online";

function formatUpdatedAt(value: string): string {
  const isoValue = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(isoValue);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function InstallationOffice() {
  const auth = useAdminToken();
  const [control, setControl] = useState<InstallationControl | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const screens = useMemo(() => buildLiveInstallationScreens(PRODUCTION_ORIGIN), []);
  const nonProductionHost = window.location.hostname !== "wewere.online";

  const loadControl = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setControl(await getCurrentInstallationControl());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth.token) void loadControl();
  }, [auth.token, loadControl]);

  if (!auth.token) return <AdminLogin onLogin={auth.login} />;

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    window.setTimeout(() => setCopiedUrl((current) => current === url ? null : current), 1500);
  };

  const triggerReload = async () => {
    if (!window.confirm(
      "Reload every open production installation screen within about one minute?",
    )) return;
    setReloading(true);
    setError("");
    setNotice("");
    try {
      const nextControl = await reloadInstallationScreens(auth.token);
      setControl(nextControl);
      setNotice("Production screens will reload within about one minute.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="office-shell">
      <AdminHeader currentPage="installation" onLogout={auth.logout} />
      <main className="office-main">
        <section className="office-intro">
          <div>
            <span className="office-section-number">INSTALLATION</span>
            <h2>Production screens</h2>
            <p>Open one stable link on each display. The links always point to wewere.online.</p>
          </div>
        </section>

        {nonProductionHost && <p className="office-warning" role="note">
          This console is running on {window.location.host}, but its controls and links target production.
        </p>}
        {error && <p className="office-error" role="alert">{error}</p>}
        {notice && <p className="office-notice" role="status">{notice}</p>}

        <section className="office-panel installation-control">
          <div>
            <span className="office-section-number">GLOBAL CONTROL</span>
            <h3>Reload all screens</h3>
            <p>Every open live or touches screen checks this control about once per minute.</p>
          </div>
          <dl>
            <div><dt>Generation</dt><dd>{control?.generation ?? (loading ? "…" : "Unavailable")}</dd></div>
            <div><dt>Last triggered</dt><dd>{control ? formatUpdatedAt(control.updatedAt) : "—"}</dd></div>
          </dl>
          <button type="button" className="office-button--danger" disabled={reloading || loading}
            onClick={triggerReload}>{reloading ? "Triggering…" : "Reload all production screens"}</button>
        </section>

        <section className="office-panel installation-links">
          <div className="office-list-header">
            <div><span className="office-section-number">MACHINE LINKS</span><h3>Nine named screens</h3></div>
            <button type="button" onClick={() => screens.forEach((screen) =>
              window.open(screen.url, "_blank", "noopener"))}>Open all</button>
          </div>
          <ol>
            {screens.map((screen) => <li key={screen.label}>
              <span>{screen.label}</span>
              <code title={screen.url}>{screen.url}</code>
              <button type="button" onClick={() => void copy(screen.url)}>
                {copiedUrl === screen.url ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={() => window.open(screen.url, "_blank", "noopener")}>Open</button>
            </li>)}
          </ol>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<InstallationOffice />);
