import React, { useEffect, useState } from "react";
import { withSharedState } from "@playhtml/react";
import words from "profane-words";

type PromptKey = "building" | "learned";

interface GuestbookEntry {
  id: string;
  prompt: PromptKey;
  text: string;
  at: number;
}

const PROMPTS: Record<PromptKey, string> = {
  building: "I'm building…",
  learned: "I learned…",
};

const MAX_ENTRIES = 20;
const MAX_TEXT = 140;

/**
 * "just now" (<60s) · "Nm ago" (<60m) · "Nh ago" (<24h) · "yesterday" (<48h) ·
 * locale date otherwise. `nowMs` is threaded in so a parent interval can
 * re-render relative labels without each entry owning its own timer.
 */
function formatRelativeTime(fromMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - fromMs);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "yesterday";
  return new Date(fromMs).toLocaleDateString();
}

// Mirrors website/index.tsx guestbook filter: word-boundary, case-insensitive.
function isProfane(text: string): boolean {
  return words.some((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    return regex.test(text);
  });
}

function makeEntryId(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

const DocsGuestbookInner = withSharedState(
  {
    defaultData: { entries: [] as GuestbookEntry[] },
    id: "ph-cap-docs-guestbook",
  },
  ({ data, setData }) => {
    const [prompt, setPrompt] = useState<PromptKey>("building");
    const [draft, setDraft] = useState("");
    const [now, setNow] = useState(() => Date.now());

    // Ticks the relative-time labels without re-rendering on every frame.
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 30_000);
      return () => clearInterval(id);
    }, []);

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed) {
        setDraft("");
        return;
      }
      if (isProfane(trimmed)) {
        // Silent reject: clear the field, don't post, don't alert.
        setDraft("");
        return;
      }
      const entry: GuestbookEntry = {
        id: makeEntryId(),
        prompt,
        text: trimmed.slice(0, MAX_TEXT),
        at: Date.now(),
      };
      setData((d) => {
        d.entries.push(entry);
        // FIFO cap enforced at write time so late writers also trim.
        const overflow = d.entries.length - MAX_ENTRIES;
        if (overflow > 0) d.entries.splice(0, overflow);
      });
      setDraft("");
    };

    const entriesNewestFirst = [...data.entries].reverse();
    const remaining = MAX_TEXT - draft.length;

    return (
      <div id="ph-cap-docs-guestbook" className="ph-docs-guestbook">
        <form className="ph-docs-guestbook__form" onSubmit={handleSubmit}>
          <fieldset className="ph-docs-guestbook__prompts">
            <legend className="ph-docs-guestbook__legend">Prompt</legend>
            {(Object.keys(PROMPTS) as PromptKey[]).map((key) => (
              <label
                key={key}
                className={
                  "ph-docs-guestbook__prompt" +
                  (prompt === key ? " is-active" : "")
                }
              >
                <input
                  type="radio"
                  name="ph-docs-guestbook-prompt"
                  value={key}
                  checked={prompt === key}
                  onChange={() => setPrompt(key)}
                />
                <span>{PROMPTS[key]}</span>
              </label>
            ))}
          </fieldset>

          <label className="ph-docs-guestbook__field">
            <span className="ph-docs-guestbook__label">Your entry</span>
            <textarea
              className="ph-docs-guestbook__textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_TEXT))}
              maxLength={MAX_TEXT}
              rows={2}
              placeholder={PROMPTS[prompt]}
            />
          </label>

          <div className="ph-docs-guestbook__actions">
            <span
              className={
                "ph-docs-guestbook__count" +
                (remaining <= 20 ? " is-tight" : "")
              }
              aria-live="off"
            >
              {remaining}
            </span>
            <button
              type="submit"
              className="ph-docs-guestbook__submit"
              disabled={!draft.trim()}
            >
              Post
            </button>
          </div>
        </form>

        <div className="ph-docs-guestbook__list-wrap">
          <ul
            className="ph-docs-guestbook__list"
            aria-live="polite"
            aria-label="Recent guestbook entries"
          >
            {entriesNewestFirst.length === 0 ? (
              <li className="ph-docs-guestbook__empty">
                No entries yet — be the first.
              </li>
            ) : (
              entriesNewestFirst.map((entry) => (
                <li key={entry.id} className="ph-docs-guestbook__entry">
                  <span
                    className={
                      "ph-docs-guestbook__kicker ph-docs-guestbook__kicker--" +
                      entry.prompt
                    }
                  >
                    {PROMPTS[entry.prompt]}
                  </span>
                  <p className="ph-docs-guestbook__text">{entry.text}</p>
                  <time
                    className="ph-docs-guestbook__time"
                    dateTime={new Date(entry.at).toISOString()}
                  >
                    {formatRelativeTime(entry.at, now)}
                  </time>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    );
  },
  { standalone: true },
);

/** Two-prompt shared guestbook — live log for the can-play capability demo. */
export function DocsGuestbook(): React.ReactElement {
  return <DocsGuestbookInner />;
}
