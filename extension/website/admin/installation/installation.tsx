// ABOUTME: Operates the production WWO installation screens from the authenticated office.
// ABOUTME: Opens positioned machine windows and advances their shared reload generation.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminHeader, AdminLogin, useAdminToken } from "../adminAuth";
import "../style.scss";
import { buildLiveInstallationScreens } from "../../shared/utils/installationUrls";
import { LIVE_INSTALLATION_PROFILES } from "../../shared/utils/liveInstallationProfiles";
import { ARS_LAYOUT, openInstallationLayout, openInstallationScreen } from "./installationLayouts";
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

  const openAll = () => {
    openInstallationLayout(ARS_LAYOUT, screens, window);
    setNotice("Requested nine windows in the Ars Electronica layout. Allow pop-ups for this site if any are missing.");
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
            <button type="button" onClick={openAll}>Open all in Ars layout</button>
          </div>
          <div className="installation-layout">
            <p>Opens separate windows on this display, arranged roughly like the Ars Electronica wall. If the group is blocked, use each Open button below.</p>
            <div className="installation-layout__map" role="img" aria-label="Ars Electronica arrangement of the nine named screens">
              {ARS_LAYOUT.windows.map((slot) => <div key={slot.screen} title={`${slot.number}: ${LIVE_INSTALLATION_PROFILES[slot.screen].label}`} style={{
                left: `${slot.x / ARS_LAYOUT.width * 100}%`,
                top: `${slot.y / ARS_LAYOUT.height * 100}%`,
                width: `${slot.width / ARS_LAYOUT.width * 100}%`,
                height: `${slot.height / ARS_LAYOUT.height * 100}%`,
              }}>
                <strong>{slot.number}</strong>
                <span>{LIVE_INSTALLATION_PROFILES[slot.screen].label}</span>
              </div>)}
            </div>
          </div>
          <ol>
            {screens.map((screen) => <li key={screen.label}>
              <span>{screen.label}</span>
              <code title={screen.url}>{screen.url}</code>
              <button type="button" onClick={() => void copy(screen.url)}>
                {copiedUrl === screen.url ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={() => openInstallationScreen(ARS_LAYOUT, screen, window)}>Open</button>
            </li>)}
          </ol>
        </section>

        <section className="office-panel">
          <div className="office-list-header">
            <div><span className="office-section-number">BROWSING MACHINE</span><h3>Installation mode</h3></div>
          </div>
          <p>
            On the machine visitors browse from, open the extension's Settings, press
            Cmd/Ctrl+Shift+8, and check Installation mode. The frame, the live cursor trace,
            the sound, and the faster collection pace follow them onto every site, and the
            frame's "about this" corner explains the piece to whoever sits down.
          </p>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<InstallationOffice />);
