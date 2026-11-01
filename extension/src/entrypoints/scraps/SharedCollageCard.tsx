// ABOUTME: A shared collage's card in the collage list: an accent edge, a "shared" tag in everyone's colors, and who it's with.
// ABOUTME: Opens the shared page; the card can copy the invite link or take the collage off this person's list.

import React, { useState } from "react";
import type {
  SharedCollageEntry,
  SharedCollagePerson,
} from "../../features/sharedCollages/sharedCollageEntry";
import type { CollageEntry } from "./collageRecord";
import { GLYPHS } from "./PieceActions";

export type CollageCard =
  | { kind: "own"; entry: CollageEntry }
  | { kind: "shared"; entry: SharedCollageEntry };

/**
 * One list, newest change first, so a shared collage sits among the rest by
 * when it last changed.
 */
export function mergeCollageCards(
  own: readonly CollageEntry[],
  shared: readonly SharedCollageEntry[],
): CollageCard[] {
  const changedAt = (card: CollageCard) => card.entry.updatedAt || 0;
  const cards: CollageCard[] = [
    ...own.map((entry): CollageCard => ({ kind: "own", entry })),
    ...shared.map((entry): CollageCard => ({ kind: "shared", entry })),
  ];
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => changedAt(b.card) - changedAt(a.card) || a.index - b.index)
    .map(({ card }) => card);
}

/** "mira and jun", "mira, jun and 2 others", or "2 others" when nobody named themselves. */
export function withLine(people: readonly SharedCollagePerson[]): string {
  const named = people.flatMap((person) => (person.name ? [person.name] : []));
  const unnamed = people.length - named.length;
  const parts = [...named.slice(0, 2)];
  const rest = named.length - parts.length + unnamed;
  if (rest > 0) parts.push(rest === 1 ? "1 other" : `${rest} others`);
  if (parts.length === 0) return "just you so far";
  const last = parts.pop();
  return `with ${parts.length ? `${parts.join(", ")} and ` : ""}${last}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface Props {
  entry: SharedCollageEntry;
  myColor?: string;
  onForget: (id: string) => void;
}

export function SharedCollageCard({ entry, myColor, onForget }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const name = entry.title || "untitled collage";
  const colors = [
    ...(myColor ? [myColor] : []),
    ...entry.people.map((person) => person.color),
  ];

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(entry.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("copy this link to invite people", entry.url);
    }
  };

  return (
    <article className="collage-card collage-card--shared">
      <button
        type="button"
        className="collage-card__open"
        aria-label={`Open ${name}, a shared collage`}
        onClick={() => window.open(entry.url, "_blank", "noopener")}
      >
        <span className="collage-card__thumb collage-card__thumb--shared">
          {entry.cover.pieces.map((piece, index) => (
            <img
              key={`${piece.src}-${index}`}
              src={piece.src}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{
                left: `${piece.x * 100}%`,
                top: `${piece.y * 100}%`,
                width: `${piece.width * 100}%`,
                height: `${piece.height * 100}%`,
                transform: `rotate(${piece.rotation}deg)`,
              }}
            />
          ))}
          {entry.cover.pieces.length === 0 && (
            <span className="collage-studio__label">nothing placed yet</span>
          )}
          <span className="collage-card__shared-tag">
            <span className="collage-card__shared-dots" aria-hidden="true">
              {colors.slice(0, 5).map((color, index) => (
                <i key={index} style={{ background: color }} />
              ))}
            </span>
            shared
          </span>
        </span>
        <span className="collage-card__title">
          {name} <span className="collage-card__away">↗</span>
        </span>
        <span className="collage-card__with">{withLine(entry.people)}</span>
        <span className="collage-card__meta">
          {entry.startedByMe ? "you started it" : "you joined"} ·{" "}
          {formatDate(entry.joinedAt)}
          <br />
          {entry.pieceCount} piece{entry.pieceCount === 1 ? "" : "s"}
        </span>
      </button>
      <div
        className="collage-card__actions"
        onClick={(event) => event.stopPropagation()}
      >
        {confirming ? (
          <>
            <button
              type="button"
              className="collage-action collage-action--danger"
              onClick={() => onForget(entry.id)}
            >
              {entry.startedByMe ? "remove from my list" : "leave"}
            </button>
            <button
              type="button"
              className="collage-action"
              onClick={() => setConfirming(false)}
            >
              keep
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="collage-action"
              onClick={() => void copyInvite()}
            >
              {copied ? "copied" : "copy invite"}
            </button>
            <span className="collage-card__actions-gap" />
            <button
              type="button"
              className="collage-glyph collage-glyph--danger"
              title={entry.startedByMe ? "remove from my list" : "leave"}
              aria-label={`${entry.startedByMe ? "Remove" : "Leave"} ${name}`}
              onClick={() => setConfirming(true)}
            >
              {GLYPHS.remove}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
