// ABOUTME: Film strip of the scraps the extension collected during this browsing session.
// ABOUTME: Click a scrap to drop it on the table, or drag it to a spot; hidden without the extension.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { requestSessionScraps, type SessionScrap } from "./scrapsBridge";
import {
  SCRAP_DRAG_TYPE,
  scrapDragPayload,
  type ScrapInput,
} from "./scrapInput";

interface Props {
  /** Image sources already on the table, dimmed in the panel. */
  placedSrcs: Set<string>;
  onPick: (input: ScrapInput) => void;
}

export function toScrapInput(scrap: SessionScrap): ScrapInput {
  return {
    src: scrap.src,
    ...(scrap.pageUrl ? { pageUrl: scrap.pageUrl } : {}),
    ...(scrap.alt ? { alt: scrap.alt } : {}),
    ...(scrap.width && scrap.height
      ? { naturalWidth: scrap.width, naturalHeight: scrap.height }
      : {}),
  };
}

/** Newest first, so what someone just saved on the walk is at hand. */
export function newestFirst(scraps: SessionScrap[]): SessionScrap[] {
  return [...scraps].sort((a, b) => b.capturedAt - a.capturedAt);
}

export function ScrapsPanel({ placedSrcs, onPick }: Props) {
  const [scraps, setScraps] = useState<SessionScrap[] | null>(null);
  const [open, setOpen] = useState(true);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const result = await requestSessionScraps();
    inFlight.current = false;
    // A missed answer on a later refresh keeps what we already have.
    if (result) setScraps(newestFirst(result));
  }, []);

  // People come back to this tab from walking, so fetch again whenever it
  // regains focus rather than asking them to refresh.
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onFocus = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // No extension answered: there is nothing to place, so this person watches.
  if (scraps === null) return null;

  return (
    <aside
      className={`scraps-panel ${open ? "scraps-panel--open" : "scraps-panel--closed"}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="scraps-panel__tab"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} your walk · {scraps.length}
      </button>
      {open && (
        <div className="scraps-panel__list">
          {scraps.length === 0 && (
            <p className="scraps-panel__empty">
              nothing collected yet, save some scraps while you walk
            </p>
          )}
          {scraps.map((scrap) => {
            const placed = placedSrcs.has(scrap.src);
            return (
              <button
                key={scrap.id}
                className={`scraps-panel__scrap ${
                  placed ? "scraps-panel__scrap--placed" : ""
                }`}
                title={placed ? "already on the table" : "place on the table"}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    SCRAP_DRAG_TYPE,
                    scrapDragPayload(toScrapInput(scrap)),
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPick(toScrapInput(scrap))}
              >
                <img
                  src={scrap.src}
                  alt={scrap.alt ?? ""}
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
