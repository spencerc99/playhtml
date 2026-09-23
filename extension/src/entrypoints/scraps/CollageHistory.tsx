// ABOUTME: Browse saved collages: baked thumbnails and dates, with a way to read each one's back.
// ABOUTME: Reopens a collage for editing, or deletes one after a confirmation.

import React, { useEffect, useMemo, useState } from "react";
import {
  duplicateCollage,
  isUnreadable,
  summarizeCollage,
  type CollageEntry,
  type CollageRecord,
} from "./collageRecord";
import {
  deleteCollage,
  listCollages,
  loadCollage,
  saveCollage,
} from "./collageStore";
import { paperBackground } from "./paperGrain";

interface CollageHistoryProps {
  /** Bumped by the studio after a save so the list reloads. */
  revision: number;
  /** Opens a collage in the studio, face up or turned over to its sources. */
  onEdit: (record: CollageRecord, side: "front" | "back") => void;
  onStartNew: () => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CollageHistory({
  revision,
  onEdit,
  onStartNew,
}: CollageHistoryProps) {
  const [entries, setSummaries] = useState<CollageEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCollages()
      .then((records) => {
        if (!cancelled) {
          setSummaries(records);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const previewUrls = useMemo(() => {
    const urls = new Map<string, string>();
    for (const entry of entries ?? []) {
      if (!isUnreadable(entry) && entry.preview.drawn) {
        urls.set(entry.id, URL.createObjectURL(entry.preview.image));
      }
    }
    return urls;
  }, [entries]);

  useEffect(
    () => () => {
      for (const url of previewUrls.values()) URL.revokeObjectURL(url);
    },
    [previewUrls],
  );

  /**
   * Makes a separate collage holding the same arrangement. The copy is put at
   * the top of the list straight away rather than waiting for a reload, so it
   * is there to open the moment the button is pressed.
   */
  const duplicate = async (id: string) => {
    const source = await loadCollage(id);
    if (!source) {
      setError("that collage could not be opened to copy");
      return;
    }
    const copy = duplicateCollage(source);
    await saveCollage(copy);
    setError(null);
    setSummaries((current) =>
      current ? [summarizeCollage(copy), ...current] : current,
    );
  };

  const open = (id: string, side: "front" | "back") => {
    void loadCollage(id).then((loaded) => {
      if (loaded) onEdit(loaded, side);
    });
  };

  const remove = async (id: string) => {
    await deleteCollage(id);
    setConfirmingId(null);
    setSummaries((current) =>
      current ? current.filter((entry) => entry.id !== id) : current,
    );
  };

  return (
    <div className="collage-history">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: '"Lora", Georgia, serif',
            fontSize: 19,
            fontWeight: 700,
          }}
        >
          your collages
        </h2>
        <button type="button" className="collage-action" onClick={onStartNew}>
          start a new one
        </button>
      </div>

      {error && (
        <p className="collage-notice" role="status">
          {error}
        </p>
      )}
      {!entries && !error && (
        <p className="collage-studio__label">opening the drawer...</p>
      )}
      {entries?.length === 0 && (
        <p className="collage-studio__label">
          nothing made yet - start a new one
        </p>
      )}

      <div className="collage-history__grid">
        {entries?.map((entry) => {
          if (isUnreadable(entry)) {
            return (
              <article
                key={entry.id || entry.reason}
                className="collage-card collage-card--unreadable"
              >
                <h3 className="collage-card__title">
                  {entry.title || "a collage that could not be read"}
                </h3>
                <p className="collage-card__meta">{entry.reason}</p>
                <div className="collage-card__actions">
                  {confirmingId === entry.id ? (
                    <>
                      <button
                        type="button"
                        className="collage-action collage-action--danger"
                        onClick={() => void remove(entry.id)}
                      >
                        delete for good
                      </button>
                      <button
                        type="button"
                        className="collage-action"
                        onClick={() => setConfirmingId(null)}
                      >
                        keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="collage-action collage-action--danger"
                      onClick={() => setConfirmingId(entry.id)}
                    >
                      delete
                    </button>
                  )}
                </div>
              </article>
            );
          }
          const summary = entry;
          const name = summary.title || "untitled";
          return (
            <article key={summary.id} className="collage-card">
              {summary.preview.drawn ? (
                <img
                  className="collage-card__thumb"
                  style={paperBackground(
                    summary.paper.color,
                    summary.paper.grain,
                    240,
                    160,
                  )}
                  src={previewUrls.get(summary.id)}
                  alt={name}
                />
              ) : (
                <div
                  className="collage-card__thumb collage-card__thumb--undrawn"
                  style={paperBackground(
                    summary.paper.color,
                    summary.paper.grain,
                    240,
                    160,
                  )}
                >
                  <span className="collage-studio__label">
                    no preview yet
                  </span>
                </div>
              )}
              <h3 className="collage-card__title">{name}</h3>
              <p className="collage-card__meta">
                {summary.pieceCount} piece
                {summary.pieceCount === 1 ? "" : "s"}
                <br />
                made {formatDate(summary.createdAt)}
                {summary.updatedAt !== summary.createdAt && (
                  <>
                    <br />
                    changed {formatDate(summary.updatedAt)}
                  </>
                )}
              </p>
              <div className="collage-card__actions">
                <button
                  type="button"
                  className="collage-action"
                  onClick={() => open(summary.id, "back")}
                >
                  sources
                </button>
                <button
                  type="button"
                  className="collage-action"
                  onClick={() => open(summary.id, "front")}
                >
                  keep editing
                </button>
                <button
                  type="button"
                  className="collage-action"
                  onClick={() => void duplicate(summary.id)}
                >
                  duplicate
                </button>
                {confirmingId === summary.id ? (
                  <>
                    <button
                      type="button"
                      className="collage-action collage-action--danger"
                      onClick={() => void remove(summary.id)}
                    >
                      delete for good
                    </button>
                    <button
                      type="button"
                      className="collage-action"
                      onClick={() => setConfirmingId(null)}
                    >
                      keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="collage-action collage-action--danger"
                    onClick={() => setConfirmingId(summary.id)}
                  >
                    delete
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
