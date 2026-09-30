// ABOUTME: Browse saved collages: each card is its baked thumbnail, title, date and size.
// ABOUTME: A card opens its collage; glyph buttons duplicate it, save it to a file, or delete it; a file can be imported as a collage.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  duplicateCollage,
  isUnreadable,
  summarizeCollage,
  type CollageEntry,
  type CollageRecord,
  type CollageSummary,
} from "./collageRecord";
import { collagesSummaryLine, newestCollage } from "./collageHistorySummary";
import {
  deleteCollage,
  listCollages,
  loadCollage,
  saveCollage,
} from "./collageStore";
import {
  collageFileName,
  encodeCollageFile,
  importCollageFile,
} from "./collageFile";
import { paperBackground } from "./paperGrain";
import { GLYPHS } from "./PieceActions";
import {
  inBackground,
  keepCollageImages,
  releaseCollageImages,
} from "./localScrapImages";

interface CollageHistoryProps {
  /** Bumped by the studio after a save so the list reloads. */
  revision: number;
  onEdit: (record: CollageRecord) => void;
  onStartNew: () => void;
}

/** A day, so a collage touched again the day it was made reads as unchanged. */
const DAY_MS = 86_400_000;

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
  const filePicker = useRef<HTMLInputElement>(null);

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
    inBackground(keepCollageImages(copy));
    setError(null);
    setSummaries((current) =>
      current ? [summarizeCollage(copy), ...current] : current,
    );
  };

  const open = (id: string) => {
    void loadCollage(id).then((loaded) => {
      if (loaded) onEdit(loaded);
      else setError("that collage could not be opened");
    });
  };

  const readable = useMemo(
    () =>
      (entries ?? []).filter(
        (entry): entry is CollageSummary => !isUnreadable(entry),
      ),
    [entries],
  );
  const newest = newestCollage(readable);
  const newestPreview = newest ? previewUrls.get(newest.id) : undefined;

  /** Downloads one collage as a self-contained file to open elsewhere. */
  const saveFile = async (id: string) => {
    try {
      const record = await loadCollage(id);
      if (!record) {
        setError("that collage could not be opened to save as a file");
        return;
      }
      const text = await encodeCollageFile(record);
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = collageFileName(record.title);
      link.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (saveError) {
      setError(
        `could not save that collage as a file — ${saveError instanceof Error ? saveError.message : String(saveError)}`,
      );
    }
  };

  /**
   * Brings a collage file in as a collage of its own. It goes to the top of
   * the list straight away, like a duplicate, so it is there to open the
   * moment it lands; it keeps the dates it was made with, so a later reload
   * files it among the rest by when it was last changed.
   */
  const openFile = async (file: File) => {
    try {
      const record = importCollageFile(await file.text());
      await saveCollage(record);
      inBackground(keepCollageImages(record));
      setError(null);
      setSummaries((current) =>
        current ? [summarizeCollage(record), ...current] : current,
      );
    } catch (openError) {
      setError(
        `could not open ${file.name} — ${openError instanceof Error ? openError.message : String(openError)}`,
      );
    }
  };

  const remove = async (id: string) => {
    await deleteCollage(id);
    inBackground(releaseCollageImages(id));
    setConfirmingId(null);
    setSummaries((current) =>
      current ? current.filter((entry) => entry.id !== id) : current,
    );
  };

  return (
    <div className="collage-history">
      <header className="collage-history__head">
        <div className="collage-history__title">
          {/* A torn scrap of the newest collage, or bare kraft before one. */}
          <span className="collage-history__scrap" aria-hidden="true">
            <span className="collage-history__scrap-paper">
              {newestPreview && <img src={newestPreview} alt="" />}
            </span>
          </span>
          <div>
            <h2 className="collage-history__heading">scrap collages</h2>
            {entries && (
              <p className="collage-history__summary">
                {collagesSummaryLine(readable)}
              </p>
            )}
          </div>
        </div>
        <div className="collage-history__start">
          <p className="collage-history__tagline">
            turn browsing artifacts into self-portrait collages
          </p>
          <button type="button" className="collage-action" onClick={onStartNew}>
            new collage
          </button>
          {/* Secondary to starting a new one, so it reads as a quiet link. */}
          <button
            type="button"
            className="collage-history__import"
            aria-label="import a collage file"
            onClick={() => filePicker.current?.click()}
          >
            import collage
          </button>
          <input
            ref={filePicker}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="collage file to open"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              // Cleared so picking the same file again still opens it again.
              event.currentTarget.value = "";
              if (file) void openFile(file);
            }}
          />
        </div>
      </header>

      {error && (
        <p className="collage-notice" role="status">
          {error}
        </p>
      )}
      {!entries && !error && (
        <p className="collage-studio__label">opening the drawer...</p>
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
          const paper = paperBackground(
            summary.paper.color,
            summary.paper.grain,
            240,
            160,
          );
          return (
            <article key={summary.id} className="collage-card">
              {/* The whole card is the way in: thumbnail, title and all. */}
              <button
                type="button"
                className="collage-card__open"
                aria-label={`Open ${name}`}
                onClick={() => open(summary.id)}
              >
                {summary.preview.drawn ? (
                  <img
                    className="collage-card__thumb"
                    style={paper}
                    src={previewUrls.get(summary.id)}
                    alt=""
                  />
                ) : (
                  <span
                    className="collage-card__thumb collage-card__thumb--undrawn"
                    style={paper}
                  >
                    <span className="collage-studio__label">no preview yet</span>
                  </span>
                )}
                <span className="collage-card__title">{name}</span>
                <span className="collage-card__meta">
                  made {formatDate(summary.createdAt)}
                  {summary.updatedAt - summary.createdAt > DAY_MS && (
                    <>
                      <br />
                      changed {formatDate(summary.updatedAt)}
                    </>
                  )}
                  <br />
                  {summary.pieceCount} piece
                  {summary.pieceCount === 1 ? "" : "s"}
                </span>
              </button>
              <div
                className="collage-card__actions"
                onClick={(event) => event.stopPropagation()}
              >
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
                  <>
                    <button
                      type="button"
                      className="collage-glyph"
                      title="duplicate"
                      aria-label={`Duplicate ${name}`}
                      onClick={() => void duplicate(summary.id)}
                    >
                      {GLYPHS.duplicate}
                    </button>
                    <button
                      type="button"
                      className="collage-glyph"
                      title="save file"
                      aria-label={`Save ${name} as a file`}
                      onClick={() => void saveFile(summary.id)}
                    >
                      {GLYPHS.saveFile}
                    </button>
                    {/* Keeps delete at the row's far end, away from the rest. */}
                    <span className="collage-card__actions-gap" />
                    <button
                      type="button"
                      className="collage-glyph collage-glyph--danger"
                      title="delete"
                      aria-label={`Delete ${name}`}
                      onClick={() => setConfirmingId(summary.id)}
                    >
                      {GLYPHS.remove}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
