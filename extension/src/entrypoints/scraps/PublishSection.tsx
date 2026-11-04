// ABOUTME: The share popover's link section: uploads the collage as a view-only page, copies its link, and unshares.
// ABOUTME: Once shared, the link updates itself in place a few seconds after the collage or its signature stops changing (see shareLinkState).
// ABOUTME: Both states ask whether to sign it, stamping the share with the maker's cursor colour and name.

import React, { useEffect, useReducer, useState } from "react";
import type { CollageRecord, CollagePublication } from "./collageRecord";
import {
  CollagePublishError,
  buildPublishedCollage,
  deletePublishedCollage,
  publicationContentKey,
  updatePublishedCollage,
  uploadPublishedCollage,
  type CollageCoverBaker,
  type PieceMaterialResolver,
} from "./publishCollage";
import {
  rememberSigning,
  signatureFor,
  signatureName,
  signingWasTurnedOff,
  type CollageSigner,
  type SignerIdentity,
  type SigningChoice,
} from "./collageSignature";
import { SignatureRow } from "./SignatureRow";
import { SignatureStamp } from "./SignatureStamp";
import {
  checkLink,
  createShareLinkState,
  linkStatus,
  stepShareLink,
} from "./shareLinkState";

export { LINK_SETTLE_MS, LINK_UPDATE_GAP_MS } from "./shareLinkState";

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
  /** Who is sharing, for the signature; without one, shares go unsigned. */
  signer?: CollageSigner;
  /** When the stored collage last changed; a shared link catches up after it. */
  changedAt?: number | null;
}

const LINE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const STATUS_TEXT: Record<ReturnType<typeof linkStatus>, string> = {
  updating: "updating…",
  notUpdated: "not updated · edit to retry",
  pending: "changes go up in a moment",
  upToDate: "up to date",
};

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
  signer,
  changedAt = null,
}: PublishSectionProps) {
  const [link, dispatch] = useReducer(
    stepShareLink,
    undefined,
    createShareLinkState,
  );
  const busy = link.work;
  const [identity, setIdentity] = useState<SignerIdentity | null>(null);
  // A collage already shared starts from how it was signed then.
  const [choice, setChoice] = useState<SigningChoice>(() => ({
    signing: share ? share.signature !== undefined : !signingWasTurnedOff(),
    name: share?.signature?.name ?? "",
    withName: share?.signature ? share.signature.name !== undefined : true,
  }));
  const [changingSignature, setChangingSignature] = useState(false);

  useEffect(() => {
    if (!signer) return;
    let cancelled = false;
    signer
      .load()
      .then((next) => {
        if (!cancelled) setIdentity(next);
      })
      .catch((error: unknown) =>
        console.warn("[collage publish] could not read who is sharing:", error),
      );
    return () => {
      cancelled = true;
    };
  }, [signer]);

  /** The stamp this share carries; a typed name becomes the maker's name everywhere. */
  const signNow = async () => {
    const signature = signatureFor(identity, choice);
    if (identity) rememberSigning(choice.signing);
    const typed = signatureName(choice.name);
    if (
      signer &&
      signature &&
      identity &&
      identity.name === undefined &&
      typed
    ) {
      try {
        await signer.saveName(typed);
        setIdentity({ ...identity, name: typed });
        // The name was just signed with, so it stays on the stamp.
        setChoice((current) => ({ ...current, withName: true }));
      } catch (error) {
        console.warn("[collage publish] could not save the name:", error);
      }
    }
    return signature;
  };

  const shareNow = async () => {
    dispatch({ kind: "shareStarted" });
    try {
      const signature = await signNow();
      const snapshot = record();
      const built = await buildPublishedCollage(
        snapshot,
        materialFor,
        coverFor,
        signature,
      );
      const next = await uploadPublishedCollage(workerUrl, built);
      const at = Date.now();
      onShared({
        ...next,
        ...(signature ? { signature } : {}),
        contentKey: publicationContentKey(snapshot, signature),
      });
      dispatch({
        kind: "shareSucceeded",
        at,
        copied: await copyText(next.url),
      });
    } catch (error) {
      dispatch({ kind: "shareFailed" });
      onProblem(`could not share — ${reason(error)}`);
    }
  };

  const unshareNow = async () => {
    if (!share) return;
    dispatch({ kind: "unshareStarted" });
    try {
      await deletePublishedCollage(workerUrl, share);
      onUnshared();
    } catch (error) {
      onProblem(`could not unshare — ${reason(error)}`);
    } finally {
      dispatch({ kind: "unshareFinished" });
    }
  };

  /**
   * Brings the link up to date in place: same address, same token. A failed
   * update leaves the link showing what it showed, and tries again on the
   * next change.
   */
  const updateNow = async (current: CollagePublication) => {
    dispatch({ kind: "updateStarted", at: Date.now() });
    let key: string | null = null;
    try {
      const signature = await signNow();
      const snapshot = record();
      key = publicationContentKey(snapshot, signature);
      const built = await buildPublishedCollage(
        snapshot,
        materialFor,
        coverFor,
        signature,
      );
      const next = await updatePublishedCollage(workerUrl, current, built);
      const { signature: _old, ...rest } = next;
      onShared({
        ...rest,
        ...(signature ? { signature } : {}),
        contentKey: key,
      });
      dispatch({ kind: "updateSucceeded" });
    } catch (error) {
      dispatch({ kind: "updateFailed", key });
      onProblem(`could not update the link — ${reason(error)}`);
    }
  };

  // A shared link follows the collage: once it and its signature have been
  // still for a moment, the link catches up. Nothing runs until the maker is
  // known, so a link is never re-signed as anonymous while they load.
  const ready = !signer || identity !== null;
  useEffect(() => {
    const check = {
      key:
        share && ready && canShare
          ? publicationContentKey(record(), signatureFor(identity, choice))
          : null,
      publishedKey: share?.contentKey,
      now: Date.now(),
    };
    // The reducer makes the same decision from the same state, so the status
    // and the timer never disagree.
    dispatch({ kind: "checked", ...check });
    const { updateInMs } = checkLink(link, check);
    if (!share || updateInMs === null) return;
    const timer = window.setTimeout(() => void updateNow(share), updateInMs);
    return () => window.clearTimeout(timer);
    // updateNow and record read the latest values when they run; the link's
    // own staleness is the effect's output, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    share,
    ready,
    canShare,
    changedAt,
    choice,
    identity,
    link.work,
    link.failedKey,
  ]);

  const signatureRow = identity && (
    <SignatureRow
      identity={identity}
      choice={choice}
      onChoice={setChoice}
      disabled={busy !== "idle"}
    />
  );

  if (!share) {
    return (
      <>
        {signatureRow}
        <div className="collage-export__row" data-share-state={busy}>
          <button
            type="button"
            className="collage-action"
            disabled={busy !== "idle" || !canShare}
            title="Make a view-only link anyone can open"
            onClick={() => void shareNow()}
          >
            {busy === "sharing" ? "sharing…" : "make a link"}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="collage-share" data-share-state="shared">
      {link.copied && (
        <p className="collage-studio__label collage-export__note">
          link copied
        </p>
      )}
      {identity && (
        <p className="collage-studio__label collage-share__signed">
          {share.signature ? (
            <>
              signed as <SignatureStamp signature={share.signature} />
            </>
          ) : (
            "not signed"
          )}
          {/* A change goes up with the link's next update, like any edit. */}
          <button
            type="button"
            className="collage-share__change"
            aria-expanded={changingSignature}
            onClick={() => setChangingSignature((value) => !value)}
          >
            {changingSignature ? "done" : "change"}
          </button>
        </p>
      )}
      {changingSignature && signatureRow}
      {/* The link copies itself when clicked; copy and open sit inside its field. */}
      <div className="collage-share__link">
        <input
          className="collage-share__url"
          readOnly
          value={share.url}
          aria-label="Shared link"
          title="Click to copy"
          onFocus={(event) => event.currentTarget.select()}
          onClick={() =>
            void copyText(share.url).then((ok) =>
              dispatch({ kind: "copied", ok }),
            )
          }
        />
        <button
          type="button"
          className="collage-share__icon"
          aria-label="Copy link"
          title="Copy link"
          onClick={() =>
            void copyText(share.url).then((ok) =>
              dispatch({ kind: "copied", ok }),
            )
          }
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1" {...LINE} />
            <path d="M10.5 3.5v-1h-8v8h1" {...LINE} />
          </svg>
        </button>
        <a
          className="collage-share__icon"
          href={share.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open link"
          title="Open link"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M9 2.5h4.5V7M13.5 2.5 7 9" {...LINE} />
            <path d="M11.5 9.5v4h-9v-9h4" {...LINE} />
          </svg>
        </a>
      </div>
      <div className="collage-export__row collage-share__foot">
        <span className="collage-studio__label" aria-live="polite">
          {STATUS_TEXT[linkStatus(link)]}
        </span>
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
