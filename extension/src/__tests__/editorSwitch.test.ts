// ABOUTME: Tests which collage is handed to the other editor when someone switches editors.
// ABOUTME: An untouched collage goes across exactly as stored; an edited one goes as it stands.

import { describe, expect, it } from "vitest";
import { collageToHandOver } from "../entrypoints/scraps/EditorSwitch";
import type { CollageRecord } from "../entrypoints/scraps/collageRecord";
import type { CollageDraft } from "../entrypoints/scraps/useCollageAutosave";

const stored: CollageRecord = {
  id: "collage_1",
  title: "kept",
  createdAt: 1,
  updatedAt: 2,
  frame: { width: 1500, height: 1000 },
  format: "postcard",
  paper: { color: "#fffdf9", grain: true },
  pieces: [],
  preview: { drawn: false, reason: "not yet" },
};

function draft(title: string, hasContent = true): CollageDraft {
  const { preview: _preview, ...record } = stored;
  return { record: { ...record, title, updatedAt: 3 }, hasContent };
}

describe("collageToHandOver", () => {
  it("hands over an untouched collage exactly as it was opened", () => {
    expect(
      collageToHandOver({
        draft: draft("kept"),
        standing: { kind: "untouched" },
        opened: stored,
        preview: null,
      }),
    ).toBe(stored);
  });

  it("hands over an edited collage as it stands, with the last picture that drew", () => {
    const picture = new Blob(["png"]);
    const handed = collageToHandOver({
      draft: draft("renamed"),
      standing: { kind: "saving" },
      opened: stored,
      preview: picture,
    });
    expect(handed?.title).toBe("renamed");
    expect(handed?.preview).toEqual({ drawn: true, image: picture });
  });

  it("hands over nothing for a fresh collage with nothing in it", () => {
    expect(
      collageToHandOver({
        draft: draft("", false),
        standing: { kind: "untouched" },
        opened: null,
        preview: null,
      }),
    ).toBeNull();
  });
});
