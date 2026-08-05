// ABOUTME: Provides copy-paste React sources for the shared counter and guestbook recipes.
// ABOUTME: Keeps persistent writes in explicit user handlers with bounded list updates.

export const sharedCounterReactSource = `// ABOUTME: Renders one persistent counter shared by every connected browser.
// ABOUTME: Increments the current value with a merge-safe mutator write.
import { PlayProvider, withSharedState } from "@playhtml/react";

type CounterData = { count: number };

const SharedCounter = withSharedState<CounterData>(
  {
    id: "shared-counter",
    defaultData: { count: 0 },
  },
  ({ data, setData }) => (
    <button
      id="shared-counter"
      className="counter"
      type="button"
      onClick={() => {
        setData((draft) => {
          draft.count += 1;
        });
      }}
    >
      <span aria-hidden="true">heart</span>
      <strong>{data.count}</strong>
      <span>shared clicks</span>
    </button>
  ),
);

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <h1>Shared counter</h1>
        <p>Click the counter. Every connected browser increments the same value.</p>
        <SharedCounter />
      </main>

      <style>{\`
        :root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { display: grid; min-height: 100vh; padding: 1.5rem; place-items: center; }
        main { width: min(30rem, 100%); text-align: center; }
        h1 { margin: 0 0 0.35rem; font-size: clamp(2rem, 9vw, 3.5rem); }
        p { margin: 0 0 1.25rem; line-height: 1.5; }
        .counter {
          display: grid;
          width: 100%;
          gap: 0.45rem;
          padding: 1.4rem;
          border: 2px solid #1c1c1c;
          background: #f2a7b7;
          box-shadow: 5px 5px 0 #1c1c1c;
          cursor: pointer;
          font: 700 1rem/1 system-ui, sans-serif;
        }
        .counter strong { font-size: 4rem; line-height: 1; }
        .counter:active { translate: 5px 5px; box-shadow: none; }
      \`}</style>
    </PlayProvider>
  );
}
`;

export const sharedGuestbookReactSource = `// ABOUTME: Keeps a bounded guestbook shared across connected browsers.
// ABOUTME: Stores form drafts locally and writes entries only on submit.
import { useState, type FormEvent } from "react";
import { PlayProvider, withSharedState } from "@playhtml/react";
import words from "profane-words";

type Prompt = "building" | "learned";
type Entry = { id: string; prompt: Prompt; text: string };
type GuestbookData = { entries: Entry[] };

const MAX_ENTRIES = 20;
const MAX_TEXT = 140;
const PROMPTS: Record<Prompt, string> = {
  building: "I'm building…",
  learned: "I learned…",
};

function isProfane(text: string): boolean {
  return words.some((word) =>
    new RegExp("\\\\b" + word + "\\\\b", "i").test(text),
  );
}

const SharedGuestbook = withSharedState<GuestbookData>(
  {
    id: "shared-guestbook",
    defaultData: { entries: [] },
  },
  function SharedGuestbookView({ data, setData }) {
    const [prompt, setPrompt] = useState<Prompt>("building");
    const [draft, setDraft] = useState("");

    function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const text = draft.trim().slice(0, MAX_TEXT);
      if (!text || isProfane(text)) {
        setDraft("");
        return;
      }

      setData((shared) => {
        shared.entries.push({
          id: crypto.randomUUID(),
          prompt,
          text,
        });
        if (shared.entries.length > MAX_ENTRIES) {
          shared.entries.splice(0, shared.entries.length - MAX_ENTRIES);
        }
      });
      setDraft("");
    }

    return (
      <section id="shared-guestbook" className="guestbook">
        <form onSubmit={submit}>
          <label>
            Prompt
            <select
              value={prompt}
              onChange={(event) => setPrompt(event.target.value as Prompt)}
            >
              <option value="building">I'm building…</option>
              <option value="learned">I learned…</option>
            </select>
          </label>
          <label>
            Your entry
            <textarea
              value={draft}
              maxLength={MAX_TEXT}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={PROMPTS[prompt]}
            />
          </label>
          <button type="submit" disabled={!draft.trim()}>Post</button>
        </form>

        <ul aria-live="polite">
          {[...data.entries].reverse().map((entry) => (
            <li key={entry.id}>
              <strong>{PROMPTS[entry.prompt]}</strong>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  },
);

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <h1>Shared guestbook</h1>
        <p>Add a short note. The latest 20 entries remain for everyone.</p>
        <SharedGuestbook />
      </main>

      <style>{\`
        :root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { min-height: 100vh; padding: 1.5rem; }
        main { width: min(42rem, 100%); margin: 0 auto; }
        h1 { margin: 0 0 0.35rem; font-size: clamp(2rem, 8vw, 3.5rem); }
        main > p { margin: 0 0 1.25rem; }
        .guestbook { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 1rem; }
        form, ul {
          margin: 0;
          padding: 1rem;
          border: 2px solid #1c1c1c;
          background: #ebe4d5;
          box-shadow: 4px 4px 0 #1c1c1c;
        }
        label { display: grid; gap: 0.35rem; margin-bottom: 0.75rem; font-weight: 700; }
        textarea, select, button { padding: 0.65rem; border: 2px solid #1c1c1c; font: inherit; }
        textarea, select { width: 100%; background: #fffdf8; }
        button { background: #f3cf58; box-shadow: 2px 2px 0 #1c1c1c; cursor: pointer; font-weight: 700; }
        button:disabled { cursor: default; opacity: 0.5; }
        ul { min-height: 14rem; list-style: none; }
        li { display: grid; gap: 0.25rem; padding: 0.65rem; background: #fffdf8; }
        li + li { margin-top: 0.55rem; }
        li strong { color: #274b9e; font-size: 0.78rem; }
        @media (max-width: 36rem) { .guestbook { grid-template-columns: 1fr; } }
      \`}</style>
    </PlayProvider>
  );
}
`;
