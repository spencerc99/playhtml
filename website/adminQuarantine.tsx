// ABOUTME: Renders global and per-room quarantine state in the admin console.
// ABOUTME: Gives operators a read-only path from the quarantine index to room details.
import React from "react";

export interface RoomQuarantineStatus {
  roomId: string;
  quarantined: boolean;
  reason: "manual" | "repeated-failures" | null;
  detail: string | null;
  quarantinedAt: string | null;
  failures: {
    load: number;
    alarm: number;
    quarantineAfter: number;
    loadRetryAfter: string | null;
    alarmRetryAfter: string | null;
  };
  compaction: {
    disabled: boolean;
    disabledAt: string | null;
    failures: number;
    disableAfter: number;
    retryAfter: string | null;
  };
  loadDeferred: {
    active: boolean;
    until: string | null;
  };
  externalQuarantineFlag: string | null;
}

export interface QuarantinedRoomSummary {
  roomId: string;
  detail: string;
}

export type QuarantineOverviewState =
  | { state: "loading"; rooms: QuarantinedRoomSummary[] }
  | { state: "ready"; rooms: QuarantinedRoomSummary[] }
  | { state: "error"; rooms: QuarantinedRoomSummary[]; message: string };

function formatRoomId(roomId: string): string {
  try {
    return decodeURIComponent(roomId);
  } catch {
    return roomId;
  }
}

function formatDate(timestamp: string | null): string {
  if (timestamp === null) return "Not set";
  return new Date(timestamp).toLocaleString();
}

export const QuarantinedRoomsOverview: React.FC<{
  overview: QuarantineOverviewState;
  onRefresh: () => void;
  onSelectRoom: (roomId: string) => void;
}> = ({ overview, onRefresh, onSelectRoom }) => (
  <section className="quarantine-overview" aria-labelledby="quarantine-heading">
    <div className="quarantine-overview-header">
      <div>
        <h2 id="quarantine-heading">Quarantined rooms</h2>
        <p>
          Rooms currently stopped by the production quarantine control plane.
        </p>
      </div>
      <button
        type="button"
        className="quarantine-refresh"
        onClick={onRefresh}
        disabled={overview.state === "loading"}
      >
        {overview.state === "loading" ? "Refreshing…" : "Refresh"}
      </button>
    </div>

    {overview.state === "error" && (
      <div className="quarantine-overview-error" role="alert">
        {overview.message}
      </div>
    )}

    {overview.state === "ready" && overview.rooms.length === 0 && (
      <div className="quarantine-overview-empty">
        No rooms are currently quarantined.
      </div>
    )}

    {overview.rooms.length > 0 && (
      <div className="quarantine-room-list">
        {overview.rooms.map((room) => (
          <button
            type="button"
            className="quarantine-room-row"
            key={room.roomId}
            onClick={() => onSelectRoom(room.roomId)}
          >
            <span>
              <strong>{formatRoomId(room.roomId)}</strong>
              <code>{room.roomId}</code>
            </span>
            <span>{room.detail}</span>
            <span aria-hidden="true">View room →</span>
          </button>
        ))}
      </div>
    )}
  </section>
);

export const RoomQuarantinePanel: React.FC<{
  status: RoomQuarantineStatus;
}> = ({ status }) => {
  const state = status.quarantined
    ? {
        label:
          status.reason === "repeated-failures"
            ? "Automatically quarantined"
            : "Manually quarantined",
        tone: "danger",
      }
    : status.loadDeferred.active
      ? { label: "Load deferred", tone: "warning" }
      : status.compaction.disabled
        ? { label: "Automatic compaction disabled", tone: "warning" }
        : status.compaction.retryAfter
          ? { label: "Compaction retry delayed", tone: "warning" }
          : { label: "Healthy", tone: "healthy" };

  return (
    <div className={`room-quarantine-panel ${state.tone}`}>
      <div className="room-quarantine-title">
        <strong>Room safety state</strong>
        <span>{state.label}</span>
      </div>

      {(status.quarantined ||
        status.loadDeferred.active ||
        status.compaction.disabled ||
        status.compaction.retryAfter) && (
        <div className="room-quarantine-details">
          {status.detail && (
            <div>
              <strong>Reason</strong>
              <span>{status.detail}</span>
            </div>
          )}
          {status.quarantinedAt && (
            <div>
              <strong>Quarantined at</strong>
              <span>{formatDate(status.quarantinedAt)}</span>
            </div>
          )}
          <div>
            <strong>Failure ledger</strong>
            <span>
              {status.failures.load} load / {status.failures.alarm} alarm
              failures; quarantine at {status.failures.quarantineAfter}
            </span>
          </div>
          {status.loadDeferred.active && (
            <div>
              <strong>Next load retry</strong>
              <span>{formatDate(status.loadDeferred.until)}</span>
            </div>
          )}
          {(status.compaction.disabled || status.compaction.retryAfter) && (
            <div>
              <strong>Compaction</strong>
              <span>
                {status.compaction.failures} vanished attempts; disable after{" "}
                {status.compaction.disableAfter}
              </span>
            </div>
          )}
          {status.compaction.retryAfter && (
            <div>
              <strong>Next compaction retry</strong>
              <span>{formatDate(status.compaction.retryAfter)}</span>
            </div>
          )}
          {status.compaction.disabledAt && (
            <div>
              <strong>Compaction disabled at</strong>
              <span>{formatDate(status.compaction.disabledAt)}</span>
            </div>
          )}
          <div>
            <strong>External control flag</strong>
            <span>{status.externalQuarantineFlag ?? "Not set"}</span>
          </div>
        </div>
      )}
    </div>
  );
};
