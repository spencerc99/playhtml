// ABOUTME: The share popover's link section: uploads the collage as a view-only page, copies its link, and unshares.
// ABOUTME: Shows "make a link" until the collage is shared, then the link with copy, open, update and unshare.
// ABOUTME: Both ask whether to sign it, stamping the share with the maker's cursor colour and name.

import React, { useEffect, useState } from "react";
import type { CollageRecord, CollagePublication } from "./collageRecord";
import {
  CollagePublishError,
  buildPublishedCollage,
  deletePublishedCollage,
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
}

type Busy = "idle" | "sharing" | "unsharing";

const LINE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
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
}: PublishSectionProps) {
  const [busy, setBusy] = useState<Busy>("idle");
  const [copied, setCopied] = useState(false);
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
    setBusy("sharing");
    setCopied(false);
    try {
      const signature = await signNow();
      const built = await buildPublishedCollage(
        record(),
        materialFor,
        coverFor,
        signature,
      );
      const next = await uploadPublishedCollage(workerUrl, built);
      onShared(signature ? { ...next, signature } : next);
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
      const signature = await signNow();
      const built = await buildPublishedCollage(
        record(),
        materialFor,
        coverFor,
        signature,
      );
      const next = await uploadPublishedCollage(workerUrl, built);
      onShared(signature ? { ...next, signature } : next);
      setChangingSignature(false);
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
      {copied && (
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
          {!changingSignature && (
            <button
              type="button"
              className="collage-share__change"
              onClick={() => setChangingSignature(true)}
            >
              change
            </button>
          )}
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
          onClick={() => void copyText(share.url).then(setCopied)}
        />
        <button
          type="button"
          className="collage-share__icon"
          aria-label="Copy link"
          title="Copy link"
          onClick={() => void copyText(share.url).then(setCopied)}
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
      <div className="collage-export__row">
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
