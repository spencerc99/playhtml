// ABOUTME: Playground preview pane: status strip, sandboxed iframe with srcdoc,
// ABOUTME: reload button, postMessage receiver for dev panel status mirroring.
import { useEffect, useRef, useState } from "react";
import { buildIframeSrcdoc } from "./iframe-template";

export type PreviewProps = {
  source: string;
  roomId: string;
  /** Bumped externally to force a fresh iframe (e.g., reload button). */
  reloadNonce: number;
};

type DevStatus = {
  connected: boolean;
  clientCount: number;
  roomId: string;
} | null;

// Pinned to the published version. Phase 1 always uses unpkg; the
// workspace dev shim (loaded via blob: URL from /docs/__dev/playhtml.js)
// would let library iteration reflect live in the iframe but exposed a
// runtime issue we haven't tracked down yet. Live library iteration via
// the dev shim is queued as a follow-up — for editor work that doesn't
// need to simultaneously edit playhtml itself, this is fine.
const PLAYHTML_URL = "https://unpkg.com/playhtml@2.9.0";

export function Preview(props: PreviewProps) {
  const { source, roomId, reloadNonce } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<DevStatus>(null);

  // Listen for dev panel status mirroring from the iframe.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== "object") return;
      if (ev.data.type !== "ph:dev-status") return;
      const payload = ev.data.payload as DevStatus;
      if (payload && typeof payload === "object") {
        setStatus(payload);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // (Re)mount the iframe whenever source, roomId, or reloadNonce changes.
  // We replace the iframe element entirely so the old playhtml provider
  // tears down cleanly (per spec §4.9).
  useEffect(() => {
    if (!containerRef.current) return;
    setStatus(null); // Clear stale status on reload

    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts allow-popups");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.style.background = "#faf7f2";
    iframe.title = "playhtml playground preview";

    iframe.srcdoc = buildIframeSrcdoc({
      recipeHtml: source,
      playhtmlUrl: PLAYHTML_URL,
      roomId,
    });

    // Clear any previous iframe and append the new one
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(iframe);

    return () => {
      // Remove iframe on unmount (StrictMode double-invoke or component unmount)
      iframe.remove();
    };
  }, [source, roomId, reloadNonce]);

  return (
    <div className="ph-preview-pane">
      <div className="ph-preview-status">
        <StatusDot connected={status?.connected ?? false} hasStatus={status !== null} />
        <span className="ph-preview-status-count">
          {status ? `${status.clientCount} ${status.clientCount === 1 ? "here" : "here"}` : "connecting…"}
        </span>
        <span className="ph-preview-status-sep">·</span>
        <span className="ph-preview-status-room" title={status?.roomId ?? roomId}>
          room: {truncateRoom(status?.roomId ?? roomId)}
        </span>
        <button
          type="button"
          className="ph-preview-reload"
          onClick={() => {
            // Forcing a re-mount happens via the parent bumping reloadNonce,
            // so this button surfaces a callback. Implementation: just bump
            // a local counter that adds to the parent's reloadNonce. To
            // keep this component pure, the actual reload trigger is a
            // dispatched custom event the parent listens for.
            window.dispatchEvent(new CustomEvent("ph:preview-reload-request"));
          }}
          title="Reload preview"
        >
          ↻
        </button>
      </div>
      <div ref={containerRef} className="ph-preview-iframe-host" />
    </div>
  );
}

function StatusDot({ connected, hasStatus }: { connected: boolean; hasStatus: boolean }) {
  const color = !hasStatus ? "#b0a99e" : connected ? "#4a9a8a" : "#c4724e";
  return (
    <span
      className="ph-preview-status-dot"
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

function truncateRoom(roomId: string): string {
  if (roomId.length <= 36) return roomId;
  return roomId.slice(0, 16) + "…" + roomId.slice(-16);
}
