// ABOUTME: Browse saved collages: baked thumbnails, dates, and where each piece came from.
// ABOUTME: Reopens a collage for editing, or deletes one after a confirmation.

import React, { useEffect, useMemo, useState } from "react";
import {
  collageProvenance,
  isUnreadable,
  type CollageEntry,
  type CollageRecord,
} from "./collageRecord";
import { deleteCollage, listCollages, loadCollage } from "./collageStore";
import { webPageHref } from "./scrapLinks";

interface CollageHistoryProps {
  /** Bumped by the studio after a save so the list reloads. */
  revision: number;
  onEdit: (record: CollageRecord) => void;
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<CollageRecord | null>(null);
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

  useEffect(() => {
    if (!expandedId) {
      setExpanded(null);
      return;
    }
    let cancelled = false;
    loadCollage(expandedId)
      .then((record) => {
        if (!cancelled) setExpanded(record);
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
  }, [expandedId]);

  const previewUrls = useMemo(() => {
    const urls = new Map<string, string>();
    for (const entry of entries ?? []) {
      if (!isUnreadable(entry)) {
        urls.set(entry.id, URL.createObjectURL(entry.preview));
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

  const remove = async (id: string) => {
    await deleteCollage(id);
    setConfirmingId(null);
    setExpandedId((current) => (current === id ? null : current));
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
          const open = expandedId === summary.id;
          const record = open ? expanded : null;
          const sources = record ? collageProvenance(record.pieces) : [];
          return (
            <article key={summary.id} className="collage-card">
              <img
                className="collage-card__thumb"
                style={{ background: summary.paper.color }}
                src={previewUrls.get(summary.id)}
                alt={summary.title || "untitled collage"}
                onClick={() => setExpandedId(open ? null : summary.id)}
              />
              <h3 className="collage-card__title">
                {summary.title || "untitled"}
              </h3>
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
                  onClick={() => setExpandedId(open ? null : summary.id)}
                >
                  {open ? "hide sources" : "sources"}
                </button>
                <button
                  type="button"
                  className="collage-action"
                  onClick={() => {
                    void loadCollage(summary.id).then((loaded) => {
                      if (loaded) onEdit(loaded);
                    });
                  }}
                >
                  keep editing
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

              {open && record && (
                <ul className="collage-provenance">
                  {sources.map((source) => {
                    const href = webPageHref(source.pageUrl);
                    const label = source.pageTitle || source.pageUrl;
                    return (
                      <li
                        key={source.pageUrl}
                        className="collage-provenance__entry"
                      >
                        {href ? (
                          <a
                            className="collage-provenance__link"
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {label}
                          </a>
                        ) : (
                          <span>{label}</span>
                        )}
                        <span className="collage-provenance__where">
                          {source.domain} · {source.pieceCount} piece
                          {source.pieceCount === 1 ? "" : "s"} · first seen{" "}
                          {formatDate(source.firstSeenAt)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {open && !record && (
                <p className="collage-studio__label">loading sources...</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
