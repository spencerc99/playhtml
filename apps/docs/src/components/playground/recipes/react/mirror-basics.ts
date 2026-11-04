// ABOUTME: Provides copy-paste React sources for the can-mirror recipes.
// ABOUTME: React owns its DOM, so these keep the same state in withSharedState data.

const sharedStyles = `        :root { color: #1c1c1c; background: #f4efe5; font-family: system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { display: grid; min-height: 100vh; padding: 1rem; place-items: center; }
        main { width: min(34rem, 100%); }
        h1 { margin: 0 0 0.35rem; font-size: clamp(2rem, 8vw, 3.5rem); line-height: 1; }
        .intro { margin: 0 0 1.25rem; line-height: 1.5; }`;

export const emojiMirrorReactSource = `// can-mirror syncs DOM you change by hand. React renders the DOM itself,
// so this version keeps the textarea's text in shared data instead.
import { PlayProvider, withSharedState } from "@playhtml/react";

const emojiOnly = /\\p{Extended_Pictographic}/gu;

const EmojiPad = withSharedState(
  { id: "emoji-pad", defaultData: { text: "" } },
  ({ data, setData }) => (
    <textarea
      rows={4}
      placeholder="emojis only..."
      aria-label="Emoji-only shared textarea"
      value={data.text}
      onChange={(event) => {
        const emojis = event.target.value.match(emojiOnly) ?? [];
        setData({ text: emojis.join("") });
      }}
    />
  ),
);

export default function App() {
  return (
    <PlayProvider>
      <main>
        <EmojiPad />
        <p className="hint">
          Type anything. Only emojis stick, and the filtered value syncs to everyone.
        </p>
      </main>

      <style>{\`
${sharedStyles}
        textarea {
          width: 100%;
          min-height: 8rem;
          resize: vertical;
          padding: 0.85rem 0.95rem;
          border: 1.5px solid #1c1c1c;
          border-radius: 6px;
          background: #f4efe5;
          box-shadow: 2px 2px 0 #1c1c1c;
          color: #1c1c1c;
          font: 1.75rem/1.35 system-ui, sans-serif;
        }
        textarea:focus { outline: 3px solid #274b9e; outline-offset: 3px; }
        .hint { margin: 0.75rem 0 0; color: #6a6761; font: 0.74rem/1.5 ui-monospace, monospace; text-align: center; }
      \`}</style>
    </PlayProvider>
  );
}
`;

export const growingListMirrorReactSource = `// can-mirror syncs DOM you change by hand. React renders the DOM itself,
// so this version keeps the list entries in shared data instead.
import { PlayProvider, withSharedState } from "@playhtml/react";

type Entry = { id: string; text: string };

const SharedList = withSharedState(
  {
    id: "guestbook",
    defaultData: { entries: [{ id: "first", text: "first" }] as Entry[] },
  },
  ({ data, setData }) => (
    <section className="panel">
      <ul>
        {data.entries.map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          setData((draft) => {
            draft.entries.push({
              id: crypto.randomUUID(),
              text: new Date().toLocaleTimeString(),
            });
          });
        }}
      >
        add entry
      </button>
    </section>
  ),
);

export default function App() {
  return (
    <PlayProvider>
      <main>
        <h1>Shared list</h1>
        <p className="intro">Add an item. It appears for everyone.</p>
        <SharedList />
      </main>

      <style>{\`
${sharedStyles}
        .panel { padding: 1rem; border: 2px solid #1c1c1c; background: #ebe4d5; box-shadow: 5px 5px 0 #1c1c1c; }
        ul { min-height: 7rem; margin: 0 0 1rem; padding: 0.75rem 0.75rem 0.75rem 2rem; border: 1px solid #1c1c1c; background: #fffdf8; }
        li + li { margin-top: 0.35rem; }
        button { padding: 0.65rem 0.9rem; border: 2px solid #1c1c1c; background: #f3cf58; box-shadow: 3px 3px 0 #1c1c1c; cursor: pointer; font: 700 1rem/1 system-ui, sans-serif; }
        button:active { translate: 3px 3px; box-shadow: none; }
      \`}</style>
    </PlayProvider>
  );
}
`;
