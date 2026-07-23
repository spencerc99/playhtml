// ABOUTME: Top-level playground shell. Wires recipe-loader, Editor, Preview;
// ABOUTME: handles silent draft restore, edited indicator, and URL hash sync.
import { useCallback, useEffect, useRef, useState } from "react";
import { Editor } from "./Editor";
import { Preview } from "./Preview";
import { starterRecipe } from "./recipes/_starter";
import { getPlayableRecipe } from "./recipes";
import {
  parseHash,
  encodeHashPayload,
  loadDraft,
  saveDraft,
  discardDraft,
  pruneStaleDrafts,
} from "./recipe-loader";
import { crossSiteLinks } from "../cross-site-links";
import "./playground.css";

export function Playground() {
  // The "canonical" source for the loaded recipe. We diff against this to
  // know whether the user has edited away from the canonical recipe (controls the
  // "edited" indicator and the visibility of the Reset button).
  const [recipeId, setRecipeId] = useState<string>("_starter");
  const [canonicalSource, setCanonicalSource] = useState<string>(starterRecipe.html);
  const [editorSource, setEditorSource] = useState<string>(starterRecipe.html);
  const [roomId, setRoomId] = useState<string>("");
  const [seedNonce, setSeedNonce] = useState<number>(0);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  // Flashes "✓ Copied" inside the Copy source button for ~1.5s after a
  // successful copy, then reverts to "Copy source".
  const [copyJustHappened, setCopyJustHappened] = useState<boolean>(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  // Track whether this session was loaded from a payload (someone else's
  // remix). On first edit, we'll fork to a fresh editor room and update
  // the URL accordingly.
  const fromPayloadRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string>(""); // current sessionId used for URL encoding

  // Initial load: parse hash, prune stale drafts, silently restore draft if
  // one exists. No banner — the reader gets back exactly where they were.
  // The "edited" indicator + reset button make the
  // edited state legible without being in the way every refresh.
  useEffect(() => {
    pruneStaleDrafts();

    function loadRecipeFromHash() {
      const loaded = parseHash(window.location.hash, getPlayableRecipe, starterRecipe);
      const canonical = getPlayableRecipe(loaded.recipeId)?.html ?? starterRecipe.html;
      setRecipeId(loaded.recipeId);
      setCanonicalSource(canonical);
      setRoomId(loaded.roomId);
      fromPayloadRef.current = loaded.fromPayload;

      // Derive sessionId for URL encoding. If loaded from payload, the room
      // id is `recipe:<base>:<sessionId>`; else it's the localStorage editor
      // room id and that's also our sessionId.
      if (loaded.fromPayload) {
        const parts = loaded.roomId.split(":");
        sessionIdRef.current = parts[parts.length - 1] ?? "";
      } else {
        sessionIdRef.current = loaded.roomId;
      }

      // A payload is the explicit source of truth. Canonical links may restore
      // a local draft when it differs from the registered recipe.
      if (loaded.fromPayload) {
        setEditorSource(loaded.source);
      } else {
        const draft = loadDraft(loaded.recipeId);
        setEditorSource(
          draft && draft.source !== canonical ? draft.source : loaded.source,
        );
      }

      setSeedNonce((n) => n + 1);
    }

    loadRecipeFromHash();
    window.addEventListener("hashchange", loadRecipeFromHash);
    return () => window.removeEventListener("hashchange", loadRecipeFromHash);
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
      // Oversize remixes silently keep the previous hash because the editor
      // does not expose a sharing action for payloads above the URL limit.
      if (source === canonicalSource) {
        replaceCanonicalHash(recipeId, roomId);
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
    [recipeId, canonicalSource, roomId],
  );

  // Reset to the canonical recipe. Confirms once before discarding because
  // the action is destructive (any unsaved edits go away).
  const handleResetToStarter = useCallback(() => {
    const ok = window.confirm(
      "Discard your edits and reset to this example? This cannot be undone.",
    );
    if (!ok) return;
    discardDraft(recipeId);
    setEditorSource(canonicalSource);
    setSeedNonce((n) => n + 1);
    replaceCanonicalHash(recipeId, roomId);
  }, [recipeId, canonicalSource, roomId]);

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

  // Derived: true when the editor source has diverged from the canonical
  // recipe. Drives both the "edited" indicator and the Reset button.
  const isEdited = editorSource !== canonicalSource;

  return (
    <div className="ph-play-root">
      <div className="ph-play-topbar">
        {/* Wordmark visually mirrors the docs SiteTitle (Carter One, 1.55rem,
            "play" stem links home). The live `can-toggle` letter behavior
            from docs is intentionally NOT replicated here — playhtml runs
            inside the preview iframe, not on the /play host page, and adding
            a second playhtml room just to animate the chrome wordmark would
            cost a connection without meaningfully changing the surface. The
            preview iframe owns the live-demo affordance on /play. */}
        <span className="ph-play-wordmark" translate="no">
          <a href="/" className="ph-play-wordmark__home" aria-label="playhtml home">
            <span className="ph-play-wordmark__stem">play</span>
          </a>
          <span className="ph-play-wordmark__letter">h</span>
          <span className="ph-play-wordmark__letter">t</span>
          <span className="ph-play-wordmark__letter">m</span>
          <span className="ph-play-wordmark__letter">l</span>
        </span>
        <nav className="ph-play-crossnav" aria-label="playhtml sites">
          {crossSiteLinks.map((link) => (
            <a
              key={link.key}
              href={link.href}
              className={
                "ph-play-crossnav__link" +
                (link.key === "play" ? " is-active" : "")
              }
              aria-current={link.key === "play" ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <span className="ph-play-topbar-divider" aria-hidden="true" />
        <span className="ph-play-title">
          {recipeId !== "_starter" ? (
            <span className="ph-play-title-recipe">{recipeId}</span>
          ) : (
            <span className="ph-play-title-recipe">starter</span>
          )}
          {isEdited && <span className="ph-play-title-edited"> · edited</span>}
        </span>
        <span className="ph-play-spacer" />
        {isEdited && (
          <button
            type="button"
            className="ph-play-reset-btn"
            onClick={handleResetToStarter}
            title="Discard your edits and reload this example"
          >
            Reset example
          </button>
        )}
      </div>

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

function replaceCanonicalHash(recipeId: string, roomId: string): void {
  const baseUrl = window.location.pathname + window.location.search;
  if (recipeId === "_starter") {
    history.replaceState(null, "", baseUrl);
    return;
  }

  const params = new URLSearchParams({ id: recipeId, room: roomId });
  history.replaceState(null, "", `${baseUrl}#${params}`);
}
