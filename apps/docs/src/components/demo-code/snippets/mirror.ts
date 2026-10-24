// ABOUTME: Copyable sources for the can-mirror demos on the Custom elements page.
// ABOUTME: React owns its DOM, so the React versions keep the same state in shared data.
import type { DemoSnippet } from "../types";

const reactNote =
  "can-mirror syncs DOM that you change by hand. React renders the DOM itself, so the React version keeps the same state in shared data instead.";

export const emojiMirrorSnippet: DemoSnippet = {
  html: `<textarea id="emoji-pad" rows="4" placeholder="emojis only..." can-mirror></textarea>

<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";

  const emojiOnly = /\\p{Extended_Pictographic}/gu;
  const emojiPad = document.getElementById("emoji-pad");

  // Drop anything that isn't an emoji. can-mirror shares the filtered value.
  emojiPad.addEventListener("input", () => {
    emojiPad.value = (emojiPad.value.match(emojiOnly) ?? []).join("");
  });

  playhtml.init();
</script>`,
  reactNote,
  react: `import { withSharedState } from "@playhtml/react";

const emojiOnly = /\\p{Extended_Pictographic}/gu;

export const EmojiPad = withSharedState(
  { id: "emoji-pad", defaultData: { text: "" } },
  ({ data, setData }) => (
    <textarea
      rows={4}
      placeholder="emojis only..."
      value={data.text}
      onChange={(event) => {
        const emojis = event.target.value.match(emojiOnly) ?? [];
        setData({ text: emojis.join("") });
      }}
    />
  ),
);`,
};

export const growingListMirrorSnippet: DemoSnippet = {
  html: `<ul id="guestbook" can-mirror>
  <li>first</li>
</ul>
<button id="guestbook-add">add entry</button>

<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";

  const list = document.getElementById("guestbook");

  // Appending a direct child is enough: can-mirror shares it with everyone.
  document.getElementById("guestbook-add").addEventListener("click", () => {
    const item = document.createElement("li");
    item.textContent = new Date().toLocaleTimeString();
    list.append(item);
  });

  playhtml.init();
</script>`,
  reactNote,
  react: `import { withSharedState } from "@playhtml/react";

type Entry = { id: string; text: string };

export const GrowingList = withSharedState(
  {
    id: "guestbook",
    defaultData: { entries: [{ id: "first", text: "first" }] as Entry[] },
  },
  ({ data, setData }) => (
    <>
      <ul>
        {data.entries.map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ul>
      <button
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
    </>
  ),
);`,
};
