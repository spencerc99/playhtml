// ABOUTME: The scraps studio editing a collage that lives in a shared room, with each person's own scraps in the drawer.
// ABOUTME: Adds the room's pieces, others' live drags, an invite link, a name prompt, and the card the extension lists.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  playhtml,
  usePageData,
  usePlayerIdentity,
  usePresence,
  useUsers,
} from "@playhtml/react";
import { CollageStudio } from "@extension/entrypoints/scraps/CollageStudio";
import { COLLAGE_STYLES } from "@movement/components/ScrapCollage";
import { COLLAGE_STUDIO_STYLES } from "@extension/entrypoints/scraps/collageStudioStyles";
import type { CollagePiece } from "@extension/entrypoints/scraps/collageRecord";
import type {
  PiecesChange,
  SharedCollage,
} from "@extension/entrypoints/scraps/sharedCollage";
import {
  SHARED_COLLAGE_REMEMBER,
  SHARED_COLLAGE_SET_NAME,
  SHARED_COLLAGE_SOURCE,
  cleanName,
} from "@extension/features/sharedCollages/sharedCollageEntry";
import { useLibraryScraps } from "./libraryScraps";
import {
  EMPTY_TOGETHER,
  TOGETHER_FRAME,
  applyWrites,
  collageEntry,
  collagePath,
  membersOf,
  pieceWrites,
  removalRefusal,
  safePieces,
  studioPieces,
  withDrafts,
  type Placer,
  type TogetherData,
  type TogetherLive,
} from "./togetherPieces";
import { TOGETHER_STYLES } from "./togetherStyles";

const DATA_NAME = "together-collage";
const DRAG_CHANNEL = "together-collage-drag";
const NAME_ASKED_KEY = "wwo-together-name-asked";
/** How long to wait for the extension to hand over a saved name before asking. */
const NAME_PROMPT_DELAY_MS = 1500;

function postToExtension(message: Record<string, unknown>) {
  window.postMessage(
    { source: SHARED_COLLAGE_SOURCE, ...message },
    window.location.origin,
  );
}

function nameAsked(): boolean {
  try {
    return localStorage.getItem(NAME_ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function markNameAsked() {
  try {
    localStorage.setItem(NAME_ASKED_KEY, "1");
  } catch {
    // Asking again next time is the only cost.
  }
}

/** The address to share: this collage, and nothing else from the address bar. */
function inviteUrl(collageId: string): string {
  return new URL(collagePath(collageId), window.location.origin).toString();
}

/** How many other people the bar names before counting the rest. */
const NAMES_SHOWN = 3;

interface Props {
  collageId: string;
  startedByMe: boolean;
}

export function TogetherStudio({ collageId, startedByMe }: Props) {
  const [data, setData] = usePageData<TogetherData>(DATA_NAME, EMPTY_TOGETHER);
  const { presences, setMyPresence } = usePresence<
    typeof DRAG_CHANNEL,
    TogetherLive
  >(DRAG_CHANNEL);
  const { pid, name, color } = usePlayerIdentity();
  const users = useUsers();
  const scraps = useLibraryScraps();
  const [copied, setCopied] = useState(false);
  const [askingName, setAskingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  // Anyone with the link can write to the room, so its pieces are rebuilt
  // from known-safe fields before anything draws them.
  const rawKey = JSON.stringify(data?.pieces ?? {});
  const stored = useMemo(
    () => safePieces(data?.pieces),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawKey],
  );
  const storedRef = useRef(stored);
  storedRef.current = stored;

  const peers = Array.from(presences.values()).map((view) => ({
    isMe: view.isMe,
    live: view[DRAG_CHANNEL],
  }));
  const shown = withDrafts(stored, peers);
  const shownKey = JSON.stringify(shown);
  const pieces = useMemo(
    () => studioPieces(shown),
    // `shown` is a new object every render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownKey],
  );

  const me = useCallback(
    (): Placer => ({
      pid: pid || "someone",
      ...(name ? { name } : {}),
      color: color || "#888888",
    }),
    [pid, name, color],
  );

  // ---- Edits --------------------------------------------------------------

  const onChange = useCallback(
    (change: PiecesChange) => {
      const { writes, removedIds } = pieceWrites(
        change,
        storedRef.current,
        me(),
      );
      if (writes.length === 0 && removedIds.length === 0) return;
      setData((draft) => {
        if (!draft.pieces) draft.pieces = {};
        applyWrites(draft.pieces, writes, removedIds);
      });
    },
    [me, setData],
  );

  const lastDraftAt = useRef(0);
  const onDraft = useCallback(
    (draft: PiecesChange | null) => {
      if (draft === null) {
        setMyPresence({ draft: null });
        return;
      }
      // Live previews ride presence; a few a second is enough to follow.
      const at = performance.now();
      if (at - lastDraftAt.current < 50) return;
      lastDraftAt.current = at;
      setMyPresence({ draft: draft.upserts });
    },
    [setMyPresence],
  );

  const refusal = useCallback(
    (piece: CollagePiece) => removalRefusal(storedRef.current[piece.id], pid),
    [pid],
  );

  const pieceOwner = useCallback((piece: CollagePiece) => {
    const by = storedRef.current[piece.id]?.by;
    if (!by) return null;
    return { name: by.name || "someone", color: by.color };
  }, []);

  // ---- Title --------------------------------------------------------------

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const title = typeof data?.title === "string" ? data.title.slice(0, 120) : "";
  const saveTitle = () => {
    if (titleDraft === null) return;
    const next = titleDraft.replace(/\s+/g, " ").trim().slice(0, 120);
    setTitleDraft(null);
    if (next === title) return;
    setData((draft) => {
      draft.title = next;
    });
  };

  // ---- Name ---------------------------------------------------------------

  // Ask once, after the extension has had a moment to hand over a saved name.
  useEffect(() => {
    if (name || nameAsked()) {
      setAskingName(false);
      return;
    }
    const timer = window.setTimeout(
      () => setAskingName(true),
      NAME_PROMPT_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [name]);

  const saveName = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = cleanName(nameDraft);
    if (!clean) return;
    playhtml.users.me.name = clean;
    postToExtension({ type: SHARED_COLLAGE_SET_NAME, name: clean });
    markNameAsked();
    setAskingName(false);
  };

  const skipName = () => {
    markNameAsked();
    setAskingName(false);
  };

  // ---- Keeping it in the extension's list -----------------------------------

  const entryKey = JSON.stringify([title, rawKey]);
  useEffect(() => {
    if (!pid) return;
    // Settles first, so a burst of edits sends one summary.
    const timer = window.setTimeout(() => {
      postToExtension({
        type: SHARED_COLLAGE_REMEMBER,
        collage: collageEntry({
          id: collageId,
          url: inviteUrl(collageId),
          data: { title, pieces: storedRef.current },
          myPid: pid,
          startedByMe,
          now: Date.now(),
        }),
      });
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey, pid, collageId, startedByMe]);

  // ---- Invite -------------------------------------------------------------

  const invite = async () => {
    const link = inviteUrl(collageId);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("copy this link to invite people", link);
    }
  };

  // ---- Render -------------------------------------------------------------

  const members = membersOf(stored, users, pid);
  const overlay =
    pieces.length === 0 ? (
      <p className="together-empty">
        {scraps === null
          ? "get we were online to bring your own scraps here"
          : "pick scraps from your drawer to start"}
      </p>
    ) : null;

  const toolbar = (
    <span className="together-bar">
      <button
        type="button"
        className="together-share"
        title="copy the link that invites people to this collage"
        onClick={() => void invite()}
      >
        <span className="together-share__dot" aria-hidden="true" />
        shared · {copied ? "link copied" : "invite"}
      </button>
      {members.length === 0 ? (
        <span className="collage-studio__label">just you so far</span>
      ) : (
        <span className="together-with">
          <span className="collage-studio__label">with</span>
          {members.slice(0, NAMES_SHOWN).map((member) => (
            <span
              key={member.pid}
              className={`together-person${
                member.here ? " together-person--here" : ""
              }`}
              style={{ "--person": member.color } as React.CSSProperties}
              title={member.here ? "here now" : "not here right now"}
            >
              {member.name || "someone"}
            </span>
          ))}
          {members.length > NAMES_SHOWN && (
            <span className="collage-studio__label">
              +{members.length - NAMES_SHOWN}
            </span>
          )}
        </span>
      )}
    </span>
  );

  const caption = (
    <span className="together-caption">
      <input
        className="together-title"
        aria-label="collage name"
        placeholder="untitled collage"
        value={titleDraft ?? title}
        onChange={(event) => setTitleDraft(event.target.value)}
        onBlur={saveTitle}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setTitleDraft(null);
            event.currentTarget.blur();
          }
          event.stopPropagation();
        }}
      />
      <span className="collage-studio__label">
        {pieces.length} piece{pieces.length === 1 ? "" : "s"} · made together
      </span>
    </span>
  );

  const shared: SharedCollage = {
    frame: TOGETHER_FRAME,
    pieces,
    onChange,
    onDraft,
    removalRefusal: refusal,
    pieceOwner,
    overlay,
    toolbar,
    caption,
  };

  return (
    <div className="together">
      <style>{COLLAGE_STYLES}</style>
      <style>{COLLAGE_STUDIO_STYLES}</style>
      <style>{TOGETHER_STYLES}</style>
      <CollageStudio
        scraps={scraps ?? []}
        editing={null}
        onSaved={() => {}}
        onLeave={() => {}}
        shared={shared}
      />
      {askingName && (
        <form className="together-name" onSubmit={saveName}>
          <label htmlFor="together-name-input">
            what should people here call you?
          </label>
          <p>
            Your name shows next to your cursor and on the scraps you place.
          </p>
          <input
            id="together-name-input"
            autoFocus
            maxLength={32}
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <span className="together-name__actions">
            <button
              type="button"
              className="together-name__skip"
              onClick={skipName}
            >
              skip
            </button>
            <button
              type="submit"
              className="collage-action together-join"
              disabled={!cleanName(nameDraft)}
            >
              join
            </button>
          </span>
        </form>
      )}
    </div>
  );
}
