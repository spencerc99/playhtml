// ABOUTME: Tests which studio command each key press invokes.
// ABOUTME: Guards that typing is never interrupted and modes own their keys.

import { describe, expect, it } from "vitest";
import {
  RESERVED_ACCELERATORS,
  acceleratorName,
  isTypingTarget,
  studioCommandFor,
  STUDIO_SHORTCUTS,
  type KeyEventShape,
  type KeymapContext,
} from "../entrypoints/scraps/studioKeymap";

function press(
  key: string,
  overrides: Partial<KeyEventShape> = {},
): KeyEventShape {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    ...overrides,
  };
}

const IDLE: KeymapContext = {
  mode: "idle",
  hasSelection: true,
  hasClipboard: false,
};

describe("isTypingTarget", () => {
  it("recognizes the fields a person types into", () => {
    expect(isTypingTarget(press("a", { target: { tagName: "INPUT" } }))).toBe(
      true,
    );
    expect(
      isTypingTarget(press("a", { target: { tagName: "TEXTAREA" } })),
    ).toBe(true);
    expect(
      isTypingTarget(press("a", { target: { isContentEditable: true } })),
    ).toBe(true);
  });

  it("does not treat the frame or a button as typing", () => {
    expect(isTypingTarget(press("a", { target: { tagName: "DIV" } }))).toBe(
      false,
    );
    expect(isTypingTarget(press("a", { target: { tagName: "BUTTON" } }))).toBe(
      false,
    );
  });
});

describe("shortcuts while typing", () => {
  it("never fires a command from inside the title field", () => {
    const typing = { target: { tagName: "INPUT" } };
    for (const key of ["r", "s", "c", "b", "Backspace", "Escape", "Tab"]) {
      expect(studioCommandFor(press(key, typing), IDLE)).toBeNull();
    }
    expect(
      studioCommandFor(press("z", { ...typing, metaKey: true }), IDLE),
    ).toBeNull();
    expect(
      studioCommandFor(press("ArrowLeft", typing), IDLE),
    ).toBeNull();
  });
});

describe("modal transforms", () => {
  it("starts rotate and scale on their own keys", () => {
    expect(studioCommandFor(press("r"), IDLE)).toEqual({ kind: "beginRotate" });
    expect(studioCommandFor(press("s"), IDLE)).toEqual({ kind: "beginScale" });
  });

  it("needs a selection to start", () => {
    const empty = { ...IDLE, hasSelection: false };
    expect(studioCommandFor(press("r"), empty)).toBeNull();
    expect(studioCommandFor(press("s"), empty)).toBeNull();
  });

  it("lets only confirm and cancel through while transforming", () => {
    const rotating: KeymapContext = { ...IDLE, mode: "rotate" };
    expect(studioCommandFor(press("Enter"), rotating)).toEqual({
      kind: "confirm",
    });
    expect(studioCommandFor(press("Escape"), rotating)).toEqual({
      kind: "cancel",
    });
    expect(studioCommandFor(press("r"), rotating)).toBeNull();
    expect(studioCommandFor(press("Backspace"), rotating)).toBeNull();
    expect(
      studioCommandFor(press("z", { metaKey: true }), rotating),
    ).toBeNull();
  });

  it("leaves the shift key alone while rotating so snapping can read it", () => {
    expect(
      studioCommandFor(press("Shift"), { ...IDLE, mode: "rotate" }),
    ).toBeNull();
  });
});

describe("crop", () => {
  it("enters crop from C or Enter", () => {
    expect(studioCommandFor(press("c"), IDLE)).toEqual({ kind: "enterCrop" });
    expect(studioCommandFor(press("Enter"), IDLE)).toEqual({
      kind: "enterCrop",
    });
  });

  it("confirms and cancels while cropping", () => {
    const cropping: KeymapContext = { ...IDLE, mode: "crop" };
    expect(studioCommandFor(press("Enter"), cropping)).toEqual({
      kind: "confirm",
    });
    expect(studioCommandFor(press("Escape"), cropping)).toEqual({
      kind: "cancel",
    });
    expect(studioCommandFor(press("c"), cropping)).toBeNull();
  });
});

describe("ordering", () => {
  it("maps the bare brackets to stacking moves", () => {
    expect(
      studioCommandFor(press("]", { code: "BracketRight" }), IDLE),
    ).toEqual({ kind: "order", to: "forward" });
    expect(studioCommandFor(press("[", { code: "BracketLeft" }), IDLE)).toEqual(
      { kind: "order", to: "backward" },
    );
  });

  it("still reads the bracket when shift rewrites it to a brace", () => {
    // Shift+[ prints "{", so matching on the character alone would miss.
    expect(
      studioCommandFor(
        press("}", { shiftKey: true, code: "BracketRight" }),
        IDLE,
      ),
    ).toEqual({ kind: "order", to: "front" });
    expect(
      studioCommandFor(
        press("{", { shiftKey: true, code: "BracketLeft" }),
        IDLE,
      ),
    ).toEqual({ kind: "order", to: "back" });
  });

  it("falls back to the character when no physical key is reported", () => {
    expect(studioCommandFor(press("]"), IDLE)).toEqual({
      kind: "order",
      to: "forward",
    });
  });

  it("never claims the accelerator brackets, which the browser keeps", () => {
    // Cmd+Shift+[ switches tabs and cannot be intercepted; Cmd+[ goes back.
    for (const held of [
      { metaKey: true },
      { ctrlKey: true },
      { metaKey: true, shiftKey: true },
      { ctrlKey: true, shiftKey: true },
    ]) {
      expect(
        studioCommandFor(press("]", { ...held, code: "BracketRight" }), IDLE),
      ).toBeNull();
      expect(
        studioCommandFor(press("[", { ...held, code: "BracketLeft" }), IDLE),
      ).toBeNull();
    }
  });

  it("does nothing without a selection", () => {
    expect(
      studioCommandFor(press("]", { code: "BracketRight" }), {
        ...IDLE,
        hasSelection: false,
      }),
    ).toBeNull();
  });
});

describe("reserved accelerators", () => {
  /** Every accelerator the studio could plausibly be asked about. */
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  const digits = "123456789".split("");

  it("claims none of the combinations the browser keeps for itself", () => {
    const contexts = [
      IDLE,
      { ...IDLE, hasClipboard: true },
      { ...IDLE, hasSelection: false },
    ];
    for (const key of [...letters, ...digits, "[", "]", "Tab"]) {
      for (const shiftKey of [false, true]) {
        for (const held of [{ metaKey: true }, { ctrlKey: true }]) {
          const event = press(key, { ...held, shiftKey });
          const name = acceleratorName(event);
          if (!name || !RESERVED_ACCELERATORS.includes(name)) continue;
          for (const context of contexts) {
            expect(
              studioCommandFor(event, context),
              `${name} is reserved by the browser and must not be bound`,
            ).toBeNull();
          }
        }
      }
    }
  });

  it("names an accelerator the way the reserved list spells it", () => {
    expect(acceleratorName(press("w", { metaKey: true }))).toBe("accel+w");
    expect(
      acceleratorName(press("t", { ctrlKey: true, shiftKey: true })),
    ).toBe("accel+shift+t");
    expect(acceleratorName(press("r"))).toBeNull();
  });

  it("lists the combinations that cannot be intercepted at all", () => {
    for (const reserved of [
      "accel+w",
      "accel+t",
      "accel+n",
      "accel+q",
      "accel+shift+[",
      "accel+shift+]",
    ]) {
      expect(RESERVED_ACCELERATORS).toContain(reserved);
    }
  });
});

describe("nudging", () => {
  it("moves one frame unit per arrow", () => {
    expect(studioCommandFor(press("ArrowLeft"), IDLE)).toEqual({
      kind: "nudge",
      dx: -1,
      dy: 0,
    });
    expect(studioCommandFor(press("ArrowDown"), IDLE)).toEqual({
      kind: "nudge",
      dx: 0,
      dy: 1,
    });
  });

  it("moves ten with shift held", () => {
    expect(studioCommandFor(press("ArrowRight", { shiftKey: true }), IDLE)).toEqual(
      { kind: "nudge", dx: 10, dy: 0 },
    );
  });

  it("leaves arrows to the page when nothing is selected", () => {
    expect(
      studioCommandFor(press("ArrowUp"), { ...IDLE, hasSelection: false }),
    ).toBeNull();
  });
});

describe("edit commands", () => {
  it("duplicates, copies and pastes on their accelerators", () => {
    expect(studioCommandFor(press("d", { metaKey: true }), IDLE)).toEqual({
      kind: "duplicate",
    });
    expect(studioCommandFor(press("c", { metaKey: true }), IDLE)).toEqual({
      kind: "copy",
    });
    expect(
      studioCommandFor(press("v", { metaKey: true }), {
        ...IDLE,
        hasClipboard: true,
      }),
    ).toEqual({ kind: "paste" });
  });

  it("does not paste an empty clipboard", () => {
    expect(studioCommandFor(press("v", { metaKey: true }), IDLE)).toBeNull();
  });

  it("undoes and redoes", () => {
    expect(studioCommandFor(press("z", { metaKey: true }), IDLE)).toEqual({
      kind: "undo",
    });
    expect(
      studioCommandFor(press("z", { metaKey: true, shiftKey: true }), IDLE),
    ).toEqual({ kind: "redo" });
    expect(studioCommandFor(press("y", { ctrlKey: true }), IDLE)).toEqual({
      kind: "redo",
    });
  });

  it("undoes even with nothing selected", () => {
    expect(
      studioCommandFor(press("z", { metaKey: true }), {
        ...IDLE,
        hasSelection: false,
      }),
    ).toEqual({ kind: "undo" });
  });
});

describe("selection", () => {
  it("steps through pieces with tab", () => {
    expect(studioCommandFor(press("Tab"), IDLE)).toEqual({
      kind: "selectNext",
    });
    expect(studioCommandFor(press("Tab", { shiftKey: true }), IDLE)).toEqual({
      kind: "selectPrevious",
    });
  });

  it("deselects on escape when nothing else is running", () => {
    expect(studioCommandFor(press("Escape"), IDLE)).toEqual({
      kind: "deselect",
    });
  });

  it("removes the selected piece", () => {
    expect(studioCommandFor(press("Backspace"), IDLE)).toEqual({
      kind: "delete",
    });
    expect(studioCommandFor(press("Delete"), IDLE)).toEqual({ kind: "delete" });
  });
});

describe("keys the studio does not own", () => {
  it("leaves unrelated accelerators to the browser", () => {
    for (const key of ["a", "f", "p", "t", "w", "l", "n"]) {
      expect(
        studioCommandFor(press(key, { metaKey: true }), IDLE),
      ).toBeNull();
    }
  });

  it("leaves plain typing keys alone", () => {
    for (const key of ["a", "q", "z", "1", " "]) {
      expect(studioCommandFor(press(key), IDLE)).toBeNull();
    }
  });

  it("leaves alt combinations alone", () => {
    expect(studioCommandFor(press("r", { altKey: true }), IDLE)).toBeNull();
  });
});

describe("flipping", () => {
  it("flips across on H and down on V", () => {
    expect(studioCommandFor(press("h"), IDLE)).toEqual({
      kind: "flip",
      axis: "x",
    });
    expect(studioCommandFor(press("v"), IDLE)).toEqual({
      kind: "flip",
      axis: "y",
    });
  });

  it("does not collide with paste, which needs the accelerator", () => {
    expect(
      studioCommandFor(press("v", { metaKey: true }), {
        ...IDLE,
        hasClipboard: true,
      }),
    ).toEqual({ kind: "paste" });
  });

  it("needs a piece to flip", () => {
    const empty = { ...IDLE, hasSelection: false };
    expect(studioCommandFor(press("h"), empty)).toBeNull();
    expect(studioCommandFor(press("v"), empty)).toBeNull();
  });
});

describe("the drawer", () => {
  it("tucks away on the backslash", () => {
    expect(studioCommandFor(press("\\"), IDLE)).toEqual({
      kind: "toggleDrawer",
    });
  });

  it("works with nothing selected", () => {
    expect(
      studioCommandFor(press("\\"), { ...IDLE, hasSelection: false }),
    ).toEqual({ kind: "toggleDrawer" });
  });
});

describe("cutout", () => {
  it("starts a cutout on its own key", () => {
    expect(studioCommandFor(press("b"), IDLE)).toEqual({ kind: "cutout" });
  });
});

describe("the shortcut list", () => {
  it("documents every group without repeating a key line", () => {
    const lines = STUDIO_SHORTCUTS.flatMap((group) =>
      group.entries.map((entry) => entry.keys),
    );
    expect(new Set(lines).size).toBe(lines.length);
    expect(STUDIO_SHORTCUTS.length).toBeGreaterThan(0);
  });

  it("carries no emoji", () => {
    const text = JSON.stringify(STUDIO_SHORTCUTS);
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });
});
