// ABOUTME: Tests basic playhtml element setup and state behavior.
// ABOUTME: Verifies handler lifecycle, SyncedStore writes, and element cleanup.
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  vi,
} from "vitest";
import { playhtml } from "../index";

async function waitForCondition(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

beforeAll(async () => {
  // Initialize playhtml with SyncedStore as primary storage
  await playhtml.init({});
  await new Promise((r) => setTimeout(r, 0));
});

describe("playhtml basic setup with SyncedStore", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("initializes and sets up elements by attribute", async () => {
    const el = document.createElement("div");
    el.id = "foo";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-toggle");

    const handler = playhtml.elementHandlers!.get("can-toggle")!.get("foo");
    expect(handler).toBeTruthy();
    expect(handler!.data).toEqual({ on: false });

    // Verify element has the generic playhtml class for easy selection
    expect(el.classList.contains("__playhtml-element")).toBe(true);
    // Verify element has the attribute for CSS targeting
    expect(el.hasAttribute("can-toggle")).toBe(true);

    // Verify data is stored in SyncedStore
    expect(playhtml.syncedStore["can-toggle"]).toBeDefined();
    expect(playhtml.syncedStore["can-toggle"]["foo"]).toEqual({ on: false });
  });

  it("keeps can-play element props scoped when combined with can-move", async () => {
    const el = document.createElement("img");
    el.id = "composed-candle";
    el.setAttribute("can-play", "");
    el.setAttribute("can-move", "");
    (el as any).defaultData = { on: true };
    (el as any).onClick = (_event: MouseEvent, { data, setData }: any) => {
      setData({ on: !data.on });
    };
    (el as any).updateElement = ({ element, data }: any) => {
      element.setAttribute("data-lit", String(data.on));
    };
    document.body.appendChild(el);

    playhtml.setupPlayElement(el);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const playHandler = playhtml
      .elementHandlers!.get("can-play")!
      .get("composed-candle");
    const moveHandler = playhtml
      .elementHandlers!.get("can-move")!
      .get("composed-candle");

    expect(playHandler).toBeTruthy();
    expect(moveHandler).toBeTruthy();
    expect(playHandler!.data).toEqual({ on: true });
    expect(moveHandler!.data).toEqual({ x: 0, y: 0 });
    expect(el.getAttribute("data-lit")).toBe("true");
    expect(el.style.transform).toBe("translate(0px, 0px)");
  });

  it("sets up can-play elements that only render awareness", async () => {
    const el = document.createElement("div");
    el.id = "presence-only-widget";
    el.setAttribute("can-play", "");
    (el as any).myDefaultAwareness = { seated: false };
    (el as any).updateElementAwareness = vi.fn(({ element, myAwareness }) => {
      element.setAttribute("data-seated", String(myAwareness?.seated));
    });
    document.body.appendChild(el);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await playhtml.setupPlayElementForTag(el, "can-play");

    expect(errorSpy).not.toHaveBeenCalled();
    const handler = playhtml
      .elementHandlers!.get("can-play")!
      .get("presence-only-widget");
    expect(handler).toBeTruthy();

    (el as any).updateElementAwareness.mockClear();
    handler!.setMyAwareness({ seated: true });

    expect((el as any).updateElementAwareness).toHaveBeenCalledWith(
      expect.objectContaining({
        myAwareness: { seated: true },
      }),
    );
  });

  it("sets up can-play elements with awareness updates and no default awareness", async () => {
    const el = document.createElement("div");
    el.id = "external-presence-widget";
    el.setAttribute("can-play", "");
    (el as any).updateElementAwareness = vi.fn();
    document.body.appendChild(el);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await playhtml.setupPlayElementForTag(el, "can-play");

    expect(errorSpy).not.toHaveBeenCalled();
    const handler = playhtml
      .elementHandlers!.get("can-play")!
      .get("external-presence-widget");
    expect(handler).toBeTruthy();

    handler!.setMyAwareness({ active: true });

    expect((el as any).updateElementAwareness).toHaveBeenCalledWith(
      expect.objectContaining({
        myAwareness: { active: true },
      }),
    );
  });

  it("reports incomplete can-play initializer pairs", () => {
    const cases: Array<{
      id: string;
      props: Record<string, unknown>;
      message: string;
    }> = [
      {
        id: "empty-widget",
        props: {},
        message: "updateElement, view, or updateElementAwareness",
      },
      {
        id: "data-without-render",
        props: { defaultData: {} },
        message: "defaultData requires updateElement or view",
      },
      {
        id: "data-with-awareness-render-only",
        props: { defaultData: {}, updateElementAwareness: vi.fn() },
        message: "defaultData requires updateElement or view",
      },
      {
        id: "render-without-data",
        props: { updateElement: vi.fn() },
        message: "updateElement or view requires defaultData",
      },
      {
        id: "view-without-data",
        props: { view: vi.fn() },
        message: "updateElement or view requires defaultData",
      },
      {
        id: "render-with-awareness-render-without-data",
        props: { updateElement: vi.fn(), updateElementAwareness: vi.fn() },
        message: "updateElement or view requires defaultData",
      },
      {
        id: "awareness-without-render",
        props: { myDefaultAwareness: { seated: false } },
        message: "myDefaultAwareness requires updateElementAwareness",
      },
      {
        id: "awareness-with-data-render-only",
        props: {
          defaultData: {},
          updateElement: vi.fn(),
          myDefaultAwareness: { seated: false },
        },
        message: "myDefaultAwareness requires updateElementAwareness",
      },
      {
        id: "primitive-default-data",
        props: { defaultData: 0, updateElement: vi.fn() },
        message: "defaultData must be an object or function",
      },
      {
        id: "null-default-data",
        props: { defaultData: null, updateElement: vi.fn() },
        message: "defaultData must be an object or function",
      },
    ];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const { id, props, message } of cases) {
      const callCount = errorSpy.mock.calls.length;
      const el = document.createElement("div");
      el.id = id;
      el.setAttribute("can-play", "");
      Object.assign(el, props);
      document.body.appendChild(el);

      playhtml.setupPlayElement(el);

      expect(errorSpy).toHaveBeenCalledTimes(callCount + 1);
      expect(errorSpy).toHaveBeenLastCalledWith(
        expect.stringContaining(message),
      );
    }
  });

  it("handles awareness changes per element (no updateElementAwareness)", async () => {
    const el = document.createElement("div");
    el.id = "bar";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-toggle");

    const handler = playhtml.elementHandlers!.get("can-toggle")!.get("bar")!;
    // Trigger local awareness update; for can-toggle, updateElementAwareness is undefined, but this should not throw
    expect(() => handler.setMyAwareness({ active: true } as any)).not.toThrow();

    // Verify element can be found using the generic class
    const playhtmlElements = document.querySelectorAll(".__playhtml-element");
    expect(playhtmlElements.length).toBe(1);
    expect(playhtmlElements[0]).toBe(el);
  });

  it("supports both mutator and value forms for setData", async () => {
    const el = document.createElement("div");
    el.id = "toggle-test";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-toggle");

    const handler = playhtml
      .elementHandlers!.get("can-toggle")!
      .get("toggle-test")!;

    // Test value form
    handler.setData({ on: true });
    // Wait for sync layer to update handler.data
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(handler.data).toEqual({ on: true });
    expect(playhtml.syncedStore["can-toggle"]["toggle-test"]).toEqual({
      on: true,
    });
    expect(el.classList.contains("toggled")).toBe(true);
    expect(el.classList.contains("clicked")).toBe(true);

    // Test mutator form
    handler.setData((draft: any) => {
      draft.on = false;
    });
    // Wait for sync layer to update handler.data
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(handler.data).toEqual({ on: false });
    expect(playhtml.syncedStore["can-toggle"]["toggle-test"]).toEqual({
      on: false,
    });
    expect(el.classList.contains("toggled")).toBe(false);
    expect(el.classList.contains("clicked")).toBe(false);
  });

  it("removes handlers for unmounted elements so replacements can register", async () => {
    const first = document.createElement("div");
    first.id = "remount-test";
    first.setAttribute("can-move", "");
    document.body.appendChild(first);
    await playhtml.setupPlayElementForTag(first, "can-move");

    expect(
      playhtml.elementHandlers!.get("can-move")!.get("remount-test")!.element,
    ).toBe(first);

    playhtml.removePlayElement(first);
    expect(playhtml.elementHandlers!.get("can-move")!.has("remount-test")).toBe(
      false,
    );

    const replacement = document.createElement("div");
    replacement.id = "remount-test";
    replacement.setAttribute("can-move", "");
    document.body.appendChild(replacement);
    await playhtml.setupPlayElementForTag(replacement, "can-move");

    expect(
      playhtml.elementHandlers!.get("can-move")!.get("remount-test")!.element,
    ).toBe(replacement);
  });

  it("skips already-registered elements when ignoreIfAlreadySetup is true", async () => {
    const el = document.createElement("div");
    el.id = "skip-existing";
    el.setAttribute("can-move", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-move");

    const handler = playhtml.elementHandlers!.get("can-move")!.get("skip-existing")!;
    const reinitialize = vi.spyOn(handler, "reinitializeElementData");

    playhtml.setupPlayElement(el, { ignoreIfAlreadySetup: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reinitialize).not.toHaveBeenCalled();
  });

  it("deleteElementData cleans up all data and handlers", async () => {
    const el = document.createElement("div");
    el.id = "cleanup-test";
    el.setAttribute("can-move", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-move");

    // Verify element is set up
    const handler = playhtml.elementHandlers!.get("can-move")!.get("cleanup-test");
    expect(handler).toBeTruthy();
    expect(playhtml.syncedStore["can-move"]["cleanup-test"]).toEqual({
      x: 0,
      y: 0,
    });

    // Move the element to create some data
    handler!.setData({ x: 100, y: 200 });
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(playhtml.syncedStore["can-move"]["cleanup-test"]).toEqual({
      x: 100,
      y: 200,
    });

    // Remove the element data
    playhtml.deleteElementData("can-move", "cleanup-test");

    // Verify handler is removed
    expect(playhtml.elementHandlers!.get("can-move")!.has("cleanup-test")).toBe(
      false
    );

    // Verify data is removed from SyncedStore
    expect(playhtml.syncedStore["can-move"]["cleanup-test"]).toBeUndefined();
  });

  it("does not add a mouseleave listener on every can-grow hover", async () => {
    const el = document.createElement("div");
    el.id = "grow-hover-listeners";
    el.setAttribute("can-grow", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-grow");

    const addEventListener = vi.spyOn(el, "addEventListener");

    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(
      addEventListener.mock.calls.filter(([type]) => type === "mouseleave"),
    ).toHaveLength(0);
  });

  it("sets up mirrored chair descendants with playhtml capabilities", async () => {
    const mirror = document.createElement("div");
    mirror.id = "musicalChairs4";
    mirror.setAttribute("can-mirror", "");
    document.body.appendChild(mirror);
    await playhtml.setupPlayElementForTag(mirror, "can-mirror");

    const handler = playhtml.elementHandlers!
      .get("can-mirror")!
      .get("musicalChairs4")!;

    handler.setData({
      nodeType: "HTMLElement",
      tagName: "div",
      attributes: {
        id: "musicalChairs4",
        "can-mirror": "",
      },
      children: [
        {
          nodeType: "HTMLElement",
          tagName: "div",
          attributes: {
            id: "chair-example",
            class: "chair",
            "can-toggle": "",
            "can-spin": "",
          },
          children: [
            {
              nodeType: "HTMLElement",
              tagName: "img",
              attributes: {
                src: "/red-stool.png",
                alt: "chair",
              },
              children: [],
            },
          ],
        },
      ],
    });

    await waitForCondition(
      () =>
        document.getElementById("chair-example") !== null &&
        playhtml.elementHandlers!.get("can-toggle")!.has("chair-example") &&
        playhtml.elementHandlers!.get("can-spin")!.has("chair-example"),
      "Expected can-mirror to register the mirrored chair",
    );

    const mirroredChair = document.getElementById("chair-example")!;
    expect(mirroredChair).toBeTruthy();
    expect(mirroredChair.classList.contains("chair")).toBe(true);
    expect(mirroredChair.querySelector("img")?.getAttribute("src")).toBe(
      "/red-stool.png",
    );
    expect(mirroredChair.querySelector("img")?.alt).toBe("chair");
    expect(
      playhtml.elementHandlers!.get("can-toggle")!.get("chair-example")!
        .element,
    ).toBe(mirroredChair);
    expect(
      playhtml.elementHandlers!.get("can-spin")!.get("chair-example")!.element,
    ).toBe(mirroredChair);

    handler.setData({
      nodeType: "HTMLElement",
      tagName: "div",
      attributes: {
        id: "musicalChairs4",
        "can-mirror": "",
      },
      children: [],
    });
    await waitForCondition(
      () =>
        document.getElementById("chair-example") === null &&
        !playhtml.elementHandlers!.get("can-toggle")!.has("chair-example") &&
        !playhtml.elementHandlers!.get("can-spin")!.has("chair-example"),
      "Expected can-mirror to unregister the removed chair",
    );

    handler.setData({
      nodeType: "HTMLElement",
      tagName: "div",
      attributes: {
        id: "musicalChairs4",
        "can-mirror": "",
      },
      children: [
        {
          nodeType: "HTMLElement",
          tagName: "div",
          attributes: {
            id: "chair-example",
            class: "chair",
            "can-toggle": "",
            "can-spin": "",
          },
          children: [],
        },
      ],
    });
    await waitForCondition(
      () =>
        document.getElementById("chair-example") !== null &&
        playhtml.elementHandlers!.get("can-toggle")!.has("chair-example") &&
        playhtml.elementHandlers!.get("can-spin")!.has("chair-example"),
      "Expected can-mirror to register the re-added chair",
    );

    const readdedChair = document.getElementById("chair-example")!;
    expect(
      playhtml.elementHandlers!.get("can-toggle")!.get("chair-example")!
        .element,
    ).toBe(readdedChair);
    expect(
      playhtml.elementHandlers!.get("can-spin")!.get("chair-example")!.element,
    ).toBe(readdedChair);
  });

  it("rebinds a locally re-added mirrored descendant with the same id", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mirror = document.createElement("div");
    mirror.id = "local-mirror-readd";
    mirror.setAttribute("can-mirror", "");
    mirror.innerHTML = `
      <div id="local-mirror-slot">
        <button id="local-mirror-toggle" can-toggle>Toggle</button>
      </div>
    `;
    document.body.appendChild(mirror);
    await playhtml.setupPlayElementForTag(mirror, "can-mirror");

    await waitForCondition(
      () =>
        playhtml.elementHandlers!.get("can-toggle")!.get("local-mirror-toggle")
          ?.element === document.getElementById("local-mirror-toggle"),
      "Expected can-mirror to register the initial toggle",
    );

    const firstToggle = document.getElementById("local-mirror-toggle")!;
    document.getElementById("local-mirror-slot")!.replaceChildren();
    expect(firstToggle.isConnected).toBe(false);

    const secondToggle = document.createElement("button");
    secondToggle.id = "local-mirror-toggle";
    secondToggle.setAttribute("can-toggle", "");
    secondToggle.textContent = "Toggle";
    document.getElementById("local-mirror-slot")!.appendChild(secondToggle);
    playhtml.setupPlayElement(secondToggle);

    await waitForCondition(
      () =>
        playhtml.elementHandlers!.get("can-toggle")!.get("local-mirror-toggle")
          ?.element === secondToggle,
      "Expected can-mirror to bind the re-added toggle",
    );

    secondToggle.click();
    await waitForCondition(
      () => secondToggle.classList.contains("toggled"),
      "Expected the re-added toggle to respond to clicks",
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
