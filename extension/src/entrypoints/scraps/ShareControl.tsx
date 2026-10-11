// ABOUTME: The studio's "share link" action: uploads the collage as a view-only page, copies its link, and unshares.
// ABOUTME: Sits beside the exports; the link and its take-down live in a small popover above the bar.

import React, { useEffect, useRef, useState } from "react";
import type { CollageRecord, CollageShare } from "./collageRecord";
import {
  CollageShareError,
  buildSharedCollage,
  deleteSharedCollage,
  uploadSharedCollage,
  type PieceMaterialResolver,
} from "./shareCollage";

interface ShareControlProps {
  /** The live share, if this collage has one. */
  share: CollageShare | undefined;
  /** False while there is nothing on the collage to share. */
  canShare: boolean;
  /** The collage as it stands at the moment of sharing. */
  record: () => Pick<CollageRecord, "title" | "frame" | "paper" | "pieces">;
  workerUrl: string;
  materialFor: PieceMaterialResolver;
  onShared: (share: CollageShare) => void;
  onUnshared: () => void;
  onProblem: (text: string) => void;
}

type Busy = "idle" | "sharing" | "unsharing";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function reason(error: unknown): string {
  if (error instanceof CollageShareError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function ShareControl({
  share,
  canShare,
  record,
  workerUrl,
  materialFor,
  onShared,
  onUnshared,
  onProblem,
}: ShareControlProps) {
  const [busy, setBusy] = useState<Busy>("idle");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!holderRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const shareNow = async () => {
    setBusy("sharing");
    setCopied(false);
    try {
      const built = await buildSharedCollage(record(), materialFor);
      const next = await uploadSharedCollage(workerUrl, built);
      onShared(next);
      setCopied(await copyText(next.url));
      setOpen(true);
    } catch (error) {
      onProblem(`could not share — ${reason(error)}`);
    } finally {
      setBusy("idle");
    }
  };

  const unshareNow = async () => {
    if (!share) return;
    setBusy("unsharing");
    try {
      await deleteSharedCollage(workerUrl, share);
      onUnshared();
      setOpen(false);
    } catch (error) {
      onProblem(`could not unshare — ${reason(error)}`);
    } finally {
      setBusy("idle");
    }
  };

  /** Sharing again replaces the old link, so it never outlives the new one. */
  const reshareNow = async () => {
    if (!share) return;
    setBusy("unsharing");
    try {
      await deleteSharedCollage(workerUrl, share);
      onUnshared();
    } catch (error) {
      onProblem(`could not update the link — ${reason(error)}`);
      setBusy("idle");
      return;
    }
    await shareNow();
  };

  return (
    <div className="collage-share" ref={holderRef}>
      <button
        type="button"
        className={`collage-action${share ? " collage-action--primary" : ""}`}
        disabled={busy !== "idle" || (!share && !canShare)}
        aria-expanded={share ? open : undefined}
        title={
          share
            ? "This collage has a view-only link"
            : "Make a view-only link anyone can open"
        }
        data-share-state={share ? "shared" : busy}
        onClick={() => {
          if (share) setOpen((value) => !value);
          else void shareNow();
        }}
      >
        {busy === "sharing"
          ? "sharing…"
          : busy === "unsharing"
            ? "unsharing…"
            : share
              ? "shared link"
              : "share link"}
      </button>
      {open && share && (
        <div
          className="collage-share-popover"
          role="dialog"
          aria-label="Shared link"
        >
          <p className="collage-studio__label">
            {copied
              ? "link copied · anyone with it can view"
              : "anyone with the link can view"}
          </p>
          <input
            className="collage-share-popover__url"
            readOnly
            value={share.url}
            aria-label="Shared link"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="collage-format__row">
            <button
              type="button"
              className="collage-action"
              onClick={() => void copyText(share.url).then(setCopied)}
            >
              copy
            </button>
            <a
              className="collage-action"
              href={share.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              open
            </a>
            <button
              type="button"
              className="collage-action"
              disabled={busy !== "idle" || !canShare}
              title="Replace the link with one showing the collage as it is now"
              onClick={() => void reshareNow()}
            >
              update
            </button>
            <button
              type="button"
              className="collage-action collage-action--danger"
              disabled={busy !== "idle"}
              onClick={() => void unshareNow()}
            >
              unshare
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
