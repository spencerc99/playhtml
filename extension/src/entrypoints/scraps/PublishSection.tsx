// ABOUTME: The share popover's link section: uploads the collage as a view-only page, copies its link, and unshares.
// ABOUTME: Shows "make a link" until the collage is shared, then the link with copy, open, update and unshare.

import { useState } from "react";
import type { CollageRecord, CollagePublication } from "./collageRecord";
import {
  CollagePublishError,
  buildPublishedCollage,
  deletePublishedCollage,
  uploadPublishedCollage,
  type CollageCoverBaker,
  type PieceMaterialResolver,
} from "./publishCollage";

export interface PublishSectionProps {
  /** The live share, if this collage has one. */
  share: CollagePublication | undefined;
  /** False while there is nothing on the collage to share, or another export runs. */
  canShare: boolean;
  /** The collage as it stands at the moment of sharing. */
  record: () => Pick<
    CollageRecord,
    "title" | "createdAt" | "frame" | "paper" | "pieces" | "backShows"
  >;
  workerUrl: string;
  materialFor: PieceMaterialResolver;
  /** Draws the picture the link previews with where it is pasted. */
  coverFor?: CollageCoverBaker;
  onShared: (share: CollagePublication) => void;
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
  if (error instanceof CollagePublishError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function PublishSection({
  share,
  canShare,
  record,
  workerUrl,
  materialFor,
  coverFor,
  onShared,
  onUnshared,
  onProblem,
}: PublishSectionProps) {
  const [busy, setBusy] = useState<Busy>("idle");
  const [copied, setCopied] = useState(false);

  const shareNow = async () => {
    setBusy("sharing");
    setCopied(false);
    try {
      const built = await buildPublishedCollage(
        record(),
        materialFor,
        coverFor,
      );
      const next = await uploadPublishedCollage(workerUrl, built);
      onShared(next);
      setCopied(await copyText(next.url));
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
      await deletePublishedCollage(workerUrl, share);
      onUnshared();
    } catch (error) {
      onProblem(`could not unshare — ${reason(error)}`);
    } finally {
      setBusy("idle");
    }
  };

  /**
   * Sharing again replaces the old link. The new one goes up first, so a failed
   * upload leaves the old link working; the old one comes down only after.
   */
  const reshareNow = async () => {
    if (!share) return;
    const old = share;
    setBusy("sharing");
    setCopied(false);
    try {
      const built = await buildPublishedCollage(
        record(),
        materialFor,
        coverFor,
      );
      const next = await uploadPublishedCollage(workerUrl, built);
      onShared(next);
      setCopied(await copyText(next.url));
      deletePublishedCollage(workerUrl, old).catch((error: unknown) =>
        console.warn(
          "[collage publish] could not take the old link down:",
          error,
        ),
      );
    } catch (error) {
      onProblem(`could not update the link — ${reason(error)}`);
    } finally {
      setBusy("idle");
    }
  };

  if (!share) {
    return (
      <div className="collage-export__row" data-share-state={busy}>
        <button
          type="button"
          className="collage-action"
          disabled={busy !== "idle" || !canShare}
          title="Make a view-only link anyone can open"
          onClick={() => void shareNow()}
        >
          {busy === "sharing" ? "sharing…" : "make a view-only link"}
        </button>
      </div>
    );
  }

  return (
    <div className="collage-share" data-share-state="shared">
      {copied && (
        <p className="collage-studio__label collage-export__note">
          link copied
        </p>
      )}
      <input
        className="collage-share__url"
        readOnly
        value={share.url}
        aria-label="Shared link"
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="collage-export__row">
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
          {busy === "sharing" ? "updating…" : "update"}
        </button>
        <button
          type="button"
          className="collage-action collage-action--danger"
          disabled={busy !== "idle"}
          onClick={() => void unshareNow()}
        >
          {busy === "unsharing" ? "unsharing…" : "unshare"}
        </button>
      </div>
    </div>
  );
}
