// ABOUTME: Top-level playground shell. Wires recipe-loader, Editor, Preview;
// ABOUTME: handles draft restore banner and URL hash sync.
import { useCallback, useEffect, useRef, useState } from "react";
import { Editor } from "./Editor";
import { Preview } from "./Preview";
import { starterRecipe } from "./recipes/_starter";
import {
  parseHash,
  encodeHashPayload,
  loadDraft,
  saveDraft,
  discardDraft,
  pruneStaleDrafts,
  formatRelativeTime,
} from "./recipe-loader";
import "./playground.css";

type DraftBanner = {
  recipeId: string;
  source: string;
  updatedAt: number;
};

export function Playground() {
  // The "canonical" source for the loaded recipe (used to detect when the
  // editor has been edited away from canonical, so saveDraft can clear
  // the draft when the user reverts).
  const [recipeId, setRecipeId] = useState<string>("_starter");
  const [canonicalSource, setCanonicalSource] = useState<string>(starterRecipe.html);
  const [editorSource, setEditorSource] = useState<string>(starterRecipe.html);
  const [roomId, setRoomId] = useState<string>("");
  const [seedNonce, setSeedNonce] = useState<number>(0);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [banner, setBanner] = useState<DraftBanner | null>(null);
  // Flashes "✓ Copied" inside the Copy source button for ~1.5s after a
  // successful copy, then reverts to "Copy source".
  const [copyJustHappened, setCopyJustHappened] = useState<boolean>(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  // Track whether this session was loaded from a payload (someone else's
  // remix). On first edit, we'll fork to a fresh editor room and update
  // the URL accordingly.
  const fromPayloadRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string>(""); // current sessionId used for URL encoding

  // Initial load: parse hash, prune stale drafts, check for draft restore.
  useEffect(() => {
    pruneStaleDrafts();

    // Determine canonical source for the recipe id (Phase 1: only _starter)
    const canonicalForId = (id: string): string => {
      if (id === "_starter") return starterRecipe.html;
      // Phase 2 will add canonical recipe lookup here.
      return starterRecipe.html;
    };

    const loaded = parseHash(window.location.hash, starterRecipe.html);
    const canon = canonicalForId(loaded.recipeId);
    setRecipeId(loaded.recipeId);
    setCanonicalSource(canon);
    setRoomId(loaded.roomId);
    fromPayloadRef.current = loaded.fromPayload;

    // Derive sessionId for URL encoding. If loaded from payload, the room
    // id is `recipe:<base>:<sessionId>`; else it's the localStorage editor
    // room id and that's also our sessionId.
    if (loaded.fromPayload) {
      const parts = loaded.roomId.split(":");
      sessionIdRef.current = parts[parts.length - 1] ?? "";
    } else {
      sessionIdRef.current = loaded.roomId; // edit-<recipe>-<random>
    }

    // Check for draft (only when not loaded from payload — payload URLs
    // are authoritative; never silently mix in a local draft).
    if (!loaded.fromPayload) {
      const draft = loadDraft(loaded.recipeId);
      if (draft && draft.source !== canon) {
        setBanner({
          recipeId: loaded.recipeId,
          source: draft.source,
          updatedAt: draft.updatedAt,
        });
        setEditorSource(canon); // Show clean recipe; banner offers restore
      } else {
        setEditorSource(loaded.source);
      }
    } else {
      setEditorSource(loaded.source);
    }

    setSeedNonce((n) => n + 1);
  }, []);

  // Listen for the Preview's reload request (the reload button dispatches
  // a custom event so Preview stays decoupled).
  useEffect(() => {
    function onReloadRequest() {
      setReloadNonce((n) => n + 1);
    }
    window.addEventListener("ph:preview-reload-request", onReloadRequest as EventListener);
    return () => window.removeEventListener("ph:preview-reload-request", onReloadRequest as EventListener);
  }, []);

  // Debounced editor change: update editorSource (which causes Preview to
  // re-render with new srcdoc), save draft, and update URL hash.
  const handleEditorChange = useCallback(
    (source: string) => {
      setEditorSource(source);

      // Fork-on-first-edit if this session was loaded from someone else's
      // payload. Mint a fresh editor room id, switch room, and reset the
      // payload flag so subsequent edits don't keep forking.
      if (fromPayloadRef.current) {
        const freshRoom = `edit-${recipeId}-${Math.random().toString(16).slice(2, 10)}`;
        sessionIdRef.current = freshRoom;
        setRoomId(freshRoom);
        // Persist the fresh room as this user's editor room for this
        // recipe so subsequent loads of the same recipe land here.
        try {
          localStorage.setItem(`playhtml:editor-room:${recipeId}`, freshRoom);
        } catch {}
        fromPayloadRef.current = false;
      }

      // Save draft (skipped if source matches canonical)
      saveDraft(recipeId, source, canonicalSource);

      // Update URL hash with payload (or strip if source matches canonical).
      // Oversize remixes silently keep the previous hash — sharing UI is
      // hidden in Phase 1 until we have a proper named-remix backend, so
      // there's no point surfacing the size limit to the reader yet.
      if (source === canonicalSource) {
        if (window.location.hash) {
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
        return;
      }
      const enc = encodeHashPayload({
        recipeId,
        sessionId: sessionIdRef.current,
        source,
      });
      if (enc.tooLarge) return; // Skip URL update; payload too large
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${enc.hash}`);
    },
    [recipeId, canonicalSource],
  );

  const handleRestoreDraft = useCallback(() => {
    if (!banner) return;
    setEditorSource(banner.source);
    setSeedNonce((n) => n + 1);
    setBanner(null);
  }, [banner]);

  const handleDiscardDraft = useCallback(() => {
    if (!banner) return;
    discardDraft(banner.recipeId);
    setBanner(null);
  }, [banner]);

  const handleCopySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editorSource);
      setCopyJustHappened(true);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopyJustHappened(false);
        copyResetTimeoutRef.current = null;
      }, 1500);
    } catch {
      // Clipboard write can fail in restricted contexts (e.g., insecure
      // origin); silently no-op rather than alarm the reader.
    }
  }, [editorSource]);

  // Cleanup the copy-confirm timer on unmount.
  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="ph-play-root">
      <div className="ph-play-topbar">
        <span className="ph-play-title">
          playhtml playground
          {recipeId !== "_starter" && (
            <span className="ph-play-title-recipe"> · {recipeId}</span>
          )}
        </span>
        <span className="ph-play-spacer" />
      </div>

      {banner && (
        <div className="ph-play-banner">
          <span className="ph-play-banner-msg">
            You have unsaved edits from {formatRelativeTime(banner.updatedAt)}.
          </span>
          <button type="button" className="ph-play-banner-btn" onClick={handleRestoreDraft}>
            Restore
          </button>
          <button type="button" className="ph-play-banner-btn" onClick={handleDiscardDraft}>
            Discard
          </button>
        </div>
      )}

      <div className="ph-play-panes">
        <div className="ph-play-pane ph-play-pane-editor">
          <div className="ph-play-pane-header">
            <span>index.html</span>
            <span className="ph-play-pane-header-spacer" />
            <button
              type="button"
              className="ph-play-pane-header-btn ph-play-copy-btn"
              data-copied={copyJustHappened ? "true" : "false"}
              onClick={handleCopySource}
            >
              {copyJustHappened ? "✓ Copied" : "Copy source"}
            </button>
          </div>
          <div className="ph-play-pane-body">
            <Editor
              initialValue={editorSource}
              seedNonce={seedNonce}
              onChange={handleEditorChange}
            />
          </div>
        </div>

        <div className="ph-play-pane ph-play-pane-preview">
          <Preview source={editorSource} roomId={roomId} reloadNonce={reloadNonce} />
        </div>
      </div>
    </div>
  );
}
