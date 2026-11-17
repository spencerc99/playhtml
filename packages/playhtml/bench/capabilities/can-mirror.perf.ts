// ABOUTME: can-mirror benchmark: the docs' can-mirror playground plus larger forms, lists and boards.
// ABOUTME: Writes deterministic traffic and DOM-write counts (and info-only *_ms) to out/metrics.can-mirror.json.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPresenceSocketForRoom } from "../../src/__tests__/presence-test-utils";
import { playhtml } from "../../src/index";
import {
  countDomWrites,
  initPage,
  measureTraffic,
  median,
  now,
  provider,
  remotePeer,
  resetPage,
  runFrames,
  typeInto,
  writeCapabilityMetrics,
  type Metrics,
} from "./harness";

const metrics: Metrics = {};

// playhtml keeps one document across resets in a test file, so every scenario
// uses its own element ids.
beforeEach(resetPage);
afterAll(() => writeCapabilityMetrics("can-mirror", metrics));

// The demos from apps/docs/src/content/docs/advanced/mirror-playground.mdx, one
// can-mirror element per section. Keep this in step with that page so the
// benchmark covers what people try there.
const PLAYGROUND = `
<div can-mirror id="pg-mirror-hover">Hover me</div>
<input can-mirror id="pg-mirror-focus" type="text" placeholder="Click to focus">
<input can-mirror id="pg-mirror-text" type="text" placeholder="Type here...">
<textarea can-mirror id="pg-mirror-textarea" rows="4" placeholder="Multi-line text..."></textarea>
<div can-mirror id="pg-mirror-checkbox"><label><input type="checkbox"> I agree to the terms</label></div>
<div can-mirror id="pg-mirror-radio"><label><input type="radio" name="pg-color" value="red"> Red</label><br><label><input type="radio" name="pg-color" value="green"> Green</label><br><label><input type="radio" name="pg-color" value="blue" checked> Blue</label></div>
<select can-mirror id="pg-mirror-select"><option value="apple">Apple</option><option value="banana">Banana</option><option value="cherry">Cherry</option><option value="dragonfruit">Dragonfruit</option></select>
<input can-mirror id="pg-mirror-range" type="range" min="0" max="100" value="50">
<input can-mirror id="pg-mirror-color" type="color" value="#ff5722">
<details can-mirror id="pg-mirror-details"><summary>Click to expand</summary><p>Hidden until the details element is opened.</p></details>
<div can-mirror id="pg-mirror-editable" contenteditable="true">Edit this text collaboratively!</div>
<ul can-mirror id="pg-mirror-editable-list" contenteditable="true"><li>First item: type to edit, Enter for new line</li><li>Second item</li></ul>
<div can-mirror id="pg-mirror-mixedform"><div><label>Name: <input type="text" placeholder="Your name"></label></div><div><label><input type="checkbox"> Subscribe to newsletter</label></div><div><select><option>Option A</option><option>Option B</option><option>Option C</option></select></div></div>
<div id="panel"><ul can-mirror id="panel-items"><li>First item</li></ul></div>
`;

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as unknown as T;

function fire(el: Element, type: "input" | "change") {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

// One person working through every demo on the playground page, one action
// per frame, the way someone would poke at it in two windows.
function playgroundActions(): Array<() => void> {
  const actions: Array<() => void> = [];
  const repeat = (n: number, action: (i: number) => void) => {
    for (let i = 0; i < n; i += 1) actions.push(() => action(i));
  };
  repeat(20, () => typeInto($("#pg-mirror-text"), "a"));
  repeat(20, () => typeInto($("#pg-mirror-textarea"), "b"));
  actions.push(() => $<HTMLInputElement>("#pg-mirror-checkbox input").click());
  actions.push(() =>
    $<HTMLInputElement>('#pg-mirror-radio input[value="red"]').click(),
  );
  actions.push(() => {
    const select = $<HTMLSelectElement>("#pg-mirror-select");
    select.selectedIndex = 2;
    fire(select, "change");
  });
  repeat(10, (i) => {
    const range = $<HTMLInputElement>("#pg-mirror-range");
    range.value = String(51 + i);
    fire(range, "input");
  });
  actions.push(() => {
    const color = $<HTMLInputElement>("#pg-mirror-color");
    color.value = "#2196f3";
    fire(color, "input");
  });
  actions.push(() =>
    $<HTMLDetailsElement>("#pg-mirror-details").setAttribute("open", ""),
  );
  actions.push(() =>
    $<HTMLDetailsElement>("#pg-mirror-details").removeAttribute("open"),
  );
  repeat(20, () => {
    const editable = $("#pg-mirror-editable");
    editable.firstChild!.textContent += "c";
    fire(editable, "input");
  });
  actions.push(() => {
    const list = $("#pg-mirror-editable-list");
    const li = document.createElement("li");
    li.textContent = "Third item";
    list.appendChild(li);
    fire(list, "input");
  });
  repeat(10, () => typeInto($("#pg-mirror-mixedform input[type=text]"), "d"));
  actions.push(() =>
    $<HTMLInputElement>("#pg-mirror-mixedform input[type=checkbox]").click(),
  );
  actions.push(() => {
    const el = $("#pg-mirror-hover");
    el.classList.add("is-flag");
    el.setAttribute("data-you-changed-this", "yes");
  });
  actions.push(() => {
    const li = document.createElement("li");
    li.textContent = "added via console";
    $("#panel-items").appendChild(li);
  });
  return actions;
}

function form(id: string, fields: number) {
  const inputs = Array.from(
    { length: fields },
    (_, i) => `<label>Field ${i}<input type="text" name="f${i}"></label>`,
  ).join("");
  return `<form can-mirror id="${id}">${inputs}</form>`;
}

function list(id: string, items: number) {
  const lis = Array.from(
    { length: items },
    (_, i) => `<li class="item">Item ${i}</li>`,
  ).join("");
  return `<ul can-mirror id="${id}">${lis}</ul>`;
}

function item(text: string) {
  const li = document.createElement("li");
  li.className = "item";
  li.textContent = text;
  return li;
}

describe("can-mirror", () => {
  it("playground page", async () => {
    document.body.innerHTML = PLAYGROUND;
    const socket = () => getPresenceSocketForRoom(playhtml.roomId);
    await initPage("/bench-mirror-playground");
    metrics.mirror_init_presence_msgs = socket().sent.length;

    const actions = playgroundActions();
    const traffic = await measureTraffic(() =>
      runFrames(actions.length, (frame) => actions[frame - 1]()),
    );
    const store = (playhtml.syncedStore as any)["can-mirror"];
    expect(store["panel-items"].children).toHaveLength(2);
    expect(store["pg-mirror-text"].formState.value).toBe("a".repeat(20));
    metrics.mirror_playground_bytes = traffic.bytes;
    metrics.mirror_playground_doc_growth = traffic.docGrowth;

    // Hovering and focusing each demo once: shared presence, not document writes.
    const presenceBefore = socket().sent.length;
    const demos = [...document.querySelectorAll("[can-mirror]")];
    await runFrames(demos.length * 2, (frame) => {
      const el = demos[Math.floor((frame - 1) / 2)];
      el.dispatchEvent(new Event(frame % 2 ? "mouseenter" : "mouseleave"));
    });
    metrics.mirror_hover_presence_msgs = socket().sent.length - presenceBefore;
  });

  // A sign-up sheet: one can-mirror form with 50 fields, someone types a
  // 50-character answer into one of them.
  it("typing in a 50-field form", async () => {
    document.body.innerHTML = form("signup", 50);
    await initPage("/bench-mirror-form");
    const input = $<HTMLInputElement>('#signup input[name="f25"]');
    const traffic = await measureTraffic(() =>
      runFrames(50, () => typeInto(input, "x")),
    );
    expect(
      (playhtml.syncedStore as any)["can-mirror"].signup.children[25]
        .children[1].formState.value,
    ).toBe("x".repeat(50));
    metrics.mirror_form_type_bytes = traffic.bytes;
    metrics.mirror_form_type_doc_growth = traffic.docGrowth;
  });

  // A shared list of 100 items: add 50 one at a time, add 200 in one go (a
  // paste or a script), then remove 50 from the middle.
  it("list of 100 items", async () => {
    document.body.innerHTML = list("todo", 100);
    await initPage("/bench-mirror-list");
    const ul = $("#todo");

    const append = await measureTraffic(() =>
      runFrames(50, (frame) => ul.appendChild(item(`New ${frame}`))),
    );
    metrics.mirror_list_append_bytes = append.bytes;

    let bulkMs = 0;
    const bulk = await measureTraffic(() =>
      runFrames(1, () => {
        const start = now();
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 200; i += 1)
          fragment.appendChild(item(`Bulk ${i}`));
        // One insert per item, the way a loop of appendChild calls lands.
        for (const li of [...fragment.childNodes]) ul.appendChild(li);
        bulkMs = now() - start;
      }),
    );
    metrics.mirror_list_bulk_bytes = bulk.bytes;

    const remove = await measureTraffic(() =>
      runFrames(50, () => ul.children[50].remove()),
    );
    expect(
      (playhtml.syncedStore as any)["can-mirror"].todo.children,
    ).toHaveLength(300);
    metrics.mirror_list_remove_bytes = remove.bytes;
    metrics.mirror_list_bulk_ms = +bulkMs.toFixed(1);
  });

  // A board (one can-mirror) holding 30 cards that are each their own
  // can-mirror. Someone else rearranges the board's look 20 times; the cards
  // shouldn't be rebuilt each time.
  it("remote board with nested cards", async () => {
    const cards = Array.from(
      { length: 30 },
      (_, i) =>
        `<article can-mirror id="card-${i}" class="card"><h3>Card ${i}</h3><input type="text" value="note ${i}"></article>`,
    ).join("");
    document.body.innerHTML = `<section can-mirror id="board" class="board">${cards}</section>`;
    await initPage("/bench-mirror-board");
    const peer = remotePeer();
    const timings: number[] = [];
    const writes = await countDomWrites($("#board"), () =>
      runFrames(20, (frame) => {
        const start = now();
        peer.edit((play) => {
          play["can-mirror"].board.attributes.class =
            `board layout-${frame % 3}`;
        });
        timings.push(now() - start);
      }),
    );
    expect($("#board").className).toContain("board layout-2");
    expect($("#board").querySelectorAll(".card")).toHaveLength(30);
    metrics.mirror_board_remote_dom_writes = writes;
    metrics.mirror_board_remote_ms = median(timings);
  });
});
