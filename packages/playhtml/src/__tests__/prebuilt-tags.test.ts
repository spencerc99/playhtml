// ABOUTME: Covers the built-in <play-*> tags that init defines automatically.
// ABOUTME: Verifies each tag binds, renders from shared data, and writes on interaction.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { playhtml } from "../index";

const tick = () => new Promise((r) => setTimeout(r, 0));

async function settle() {
  // The tag module loads with a dynamic import on first connect.
  for (let i = 0; i < 5; i++) await tick();
}

async function mount(markup: string): Promise<HTMLElement> {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.appendChild(host);
  await settle();
  return host.firstElementChild as HTMLElement;
}

beforeAll(async () => {
  await playhtml.init({});
  await playhtml.ready;
  // Warm the lazily loaded tag module so each test only waits on microtasks.
  await import("../prebuilt/elements");
  await tick();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("prebuilt tags", () => {
  it("defines every tag during init", () => {
    for (const tag of [
      "play-lamp",
      "play-reaction",
      "play-online-count",
      "play-guestbook",
    ]) {
      expect(customElements.get(tag)).toBeDefined();
    }
  });

  it("play-lamp toggles shared on/off state", async () => {
    const lamp = await mount(`<play-lamp id="lamp-a"></play-lamp>`);
    const button = lamp.querySelector("button")!;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(lamp.querySelector("svg")).not.toBeNull();

    button.click();
    await tick();

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(playhtml.getHandle("lamp-a").getData()).toEqual({ on: true });
  });

  it("play-lamp swaps in the author's images", async () => {
    const lamp = await mount(
      `<play-lamp id="lamp-b" src="/off.png" src-on="/on.png"></play-lamp>`,
    );
    const img = () => lamp.querySelector("img")!;
    expect(img().getAttribute("src")).toBe("/off.png");

    lamp.querySelector("button")!.click();
    await tick();

    expect(img().getAttribute("src")).toBe("/on.png");
  });

  it("play-reaction keeps the authored label and counts one per person", async () => {
    const reaction = await mount(
      `<play-reaction id="reaction-a">★</play-reaction>`,
    );
    const button = reaction.querySelector("button")!;
    expect(reaction.querySelector(".play-reaction__label")!.textContent).toBe(
      "★",
    );
    expect(reaction.querySelector(".play-reaction__count")!.textContent).toBe(
      "0",
    );

    button.click();
    await tick();
    expect(reaction.querySelector(".play-reaction__count")!.textContent).toBe(
      "1",
    );
    expect(button.getAttribute("aria-pressed")).toBe("true");

    // A second click from the same person takes the reaction back.
    button.click();
    await tick();
    expect(reaction.querySelector(".play-reaction__count")!.textContent).toBe(
      "0",
    );
  });

  it("play-online-count works without an id and counts this visitor", async () => {
    const count = await mount(`<play-online-count></play-online-count>`);
    expect(count.id).toBe("play-online-count");
    expect(count.querySelector(".play-online-count__count")!.textContent).toBe(
      "1",
    );
    expect(count.querySelector(".play-online-count__label")!.textContent).toBe(
      "here now",
    );
  });

  it("asks for an id when a second id-less tag of the same kind appears", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await mount(`<play-online-count></play-online-count>`);
    const second = await mount(`<play-online-count></play-online-count>`);
    expect(second.id).toBe("");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("needs a unique id"),
    );
    error.mockRestore();
  });

  it("play-guestbook adds a signed note to the shared list", async () => {
    const book = await mount(`<play-guestbook id="book-a"></play-guestbook>`);
    expect(book.querySelector(".play-guestbook__empty")).not.toBeNull();

    const form = book.querySelector("form")!;
    (form.querySelector("[name=name]") as HTMLInputElement).value = "ada";
    (form.querySelector("[name=message]") as HTMLTextAreaElement).value =
      "hello from the guestbook";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();

    const entries = book.querySelectorAll(".play-guestbook__entry");
    expect(entries.length).toBe(1);
    expect(entries[0].querySelector(".play-guestbook__message")!.textContent).toBe(
      "hello from the guestbook",
    );
    expect(entries[0].textContent).toContain("ada");
    expect((form.querySelector("[name=message]") as HTMLTextAreaElement).value).toBe(
      "",
    );
  });

  it("play-guestbook ignores an empty note", async () => {
    const book = await mount(`<play-guestbook id="book-b"></play-guestbook>`);
    const form = book.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();
    expect(book.querySelectorAll(".play-guestbook__entry").length).toBe(0);
  });

  it("a moved tag keeps its shared state", async () => {
    const lamp = await mount(`<play-lamp id="lamp-c"></play-lamp>`);
    lamp.querySelector("button")!.click();
    await tick();

    const elsewhere = document.createElement("section");
    document.body.appendChild(elsewhere);
    elsewhere.appendChild(lamp);
    await settle();

    const buttons = lamp.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
  });
});
