// ABOUTME: Implementations of the built-in <play-*> tags, loaded on first use.
// ABOUTME: Each tag binds itself with register() and renders with a lit-html view.
import { html, svg, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import type { ElementInitializer } from "@playhtml/common";
import type { PrebuiltRuntime, PrebuiltTag } from "./index";

const STYLE_ID = "playhtml-prebuilt-styles";

// Tags get zero-specificity defaults (`:where`). Internal parts use single
// class selectors: enough to beat a site's bare `button` rule, while any
// class-level site rule still wins.
const PREBUILT_CSS = `
:where(play-lamp, play-reaction, play-online-count) { display: inline-block; }
:where(play-guestbook) { display: block; }
.play-lamp__button {
  display: block; padding: 0; border: 0; background: none; cursor: pointer;
  width: var(--play-lamp-size, 8rem); color: inherit; font: inherit;
  transition: filter 300ms ease;
}
.play-lamp__button img, .play-lamp__button svg { display: block; width: 100%; height: auto; }
.play-lamp__button[aria-pressed="true"] {
  filter: brightness(1.15) saturate(1.4)
    drop-shadow(0 0 2.5rem var(--play-lamp-glow, rgba(247, 220, 156, 0.85)));
}
.play-lamp__paper { fill: var(--play-lamp-paper, #f4efe4); transition: fill 300ms ease; }
.play-lamp__button[aria-pressed="true"] .play-lamp__paper { fill: var(--play-lamp-paper-on, #ffe7a8); }
.play-reaction__button {
  display: inline-flex; align-items: center; gap: 0.4em; cursor: pointer;
  font: inherit; color: inherit; background: none;
  border: 1px solid currentColor; border-radius: 999px; padding: 0.25em 0.75em;
}
.play-reaction__button[aria-pressed="true"] { background: var(--play-reaction-active, rgba(127, 127, 127, 0.2)); }
.play-guestbook__form { display: grid; gap: 0.5em; margin-bottom: 1em; }
.play-guestbook__form input, .play-guestbook__form textarea { font: inherit; }
.play-guestbook__entries { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75em; }
.play-guestbook__meta { opacity: 0.7; font-size: 0.85em; }
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PREBUILT_CSS;
  document.head.prepend(style);
}

// The text an author wrote inside a tag (e.g. a reaction's symbol), captured
// before the first render replaces it. Kept per element so a moved element
// re-mounts with the same label.
const authoredLabels = new WeakMap<HTMLElement, string>();

const preparedElements = new WeakSet<HTMLElement>();

function takeAuthoredLabel(element: HTMLElement): string {
  let label = authoredLabels.get(element);
  if (label === undefined) {
    label = element.textContent?.trim() ?? "";
    authoredLabels.set(element, label);
    element.replaceChildren();
  }
  return label;
}

/**
 * Gives an id-less tag a predictable id (its tag name) when that id is free, so
 * a single `<play-online-count>` works without one. Returns false when the
 * element still has no usable id.
 */
function ensureId(tag: PrebuiltTag, element: HTMLElement): boolean {
  if (element.id) return true;
  if (!document.getElementById(tag)) {
    element.id = tag;
    return true;
  }
  console.error(
    `[playhtml] <${tag}> needs a unique id when there is more than one on a page, e.g. <${tag} id="my-${tag.replace("play-", "")}">.`,
  );
  return false;
}

function myPid(runtime: PrebuiltRuntime): string | undefined {
  try {
    return runtime.users.me.pid;
  } catch {
    return undefined;
  }
}

const defaultLampArt = svg`
  <svg viewBox="0 0 100 150" aria-hidden="true" focusable="false">
    <path class="play-lamp__paper" stroke="currentColor" stroke-width="2"
      d="M50 8 C82 8 92 40 92 62 C92 88 76 104 50 104 C24 104 8 88 8 62 C8 40 18 8 50 8 Z" />
    <g fill="none" stroke="currentColor" stroke-width="1" opacity="0.35">
      <path d="M14 34 Q50 26 86 34" />
      <path d="M9 52 Q50 44 91 52" />
      <path d="M9 72 Q50 64 91 72" />
      <path d="M16 90 Q50 82 84 90" />
    </g>
    <path fill="none" stroke="currentColor" stroke-width="2" d="M50 104 V140 M34 142 H66" />
  </svg>
`;

interface LampData {
  on: boolean;
}

function lamp(): ElementInitializer<LampData> {
  return {
    defaultData: (element: HTMLElement) => ({
      on: element.hasAttribute("on"),
    }),
    view: ({ data, setData, element }) => {
      const src = element.getAttribute("src");
      const srcOn = element.getAttribute("src-on");
      const label = element.getAttribute("label") ?? "lamp";
      const image = src
        ? html`<img src=${data.on && srcOn ? srcOn : src} alt="" draggable="false" />`
        : defaultLampArt;
      return html`<button
        type="button"
        class="play-lamp__button"
        aria-pressed=${data.on ? "true" : "false"}
        aria-label=${label}
        @click=${() =>
          setData((draft) => {
            draft.on = !draft.on;
          })}
      >
        ${image}
      </button>`;
    },
  };
}

interface ReactionData {
  reactors: Record<string, true>;
}

function reaction(
  element: HTMLElement,
  runtime: PrebuiltRuntime,
): ElementInitializer<ReactionData> {
  const label = takeAuthoredLabel(element) || "♥";
  return {
    defaultData: { reactors: {} },
    view: ({ data, setData }) => {
      const reactors = data.reactors ?? {};
      const pid = myPid(runtime);
      const reacted = pid !== undefined && Boolean(reactors[pid]);
      const count = Object.keys(reactors).length;
      return html`<button
        type="button"
        class="play-reaction__button"
        aria-pressed=${reacted ? "true" : "false"}
        @click=${() => {
          const me = myPid(runtime);
          if (!me) return;
          // Keyed by person, so double clicks and concurrent clicks converge.
          setData((draft) => {
            draft.reactors ??= {};
            if (draft.reactors[me]) delete draft.reactors[me];
            else draft.reactors[me] = true;
          });
        }}
      >
        <span class="play-reaction__label">${label}</span>
        <span class="play-reaction__count">${count}</span>
      </button>`;
    },
  };
}

function onlineCount(): ElementInitializer<
  Record<string, never>,
  undefined,
  { here: true }
> {
  return {
    defaultData: {},
    live: { here: true },
    view: ({ users, element }) => {
      const label = element.getAttribute("label") ?? "here now";
      const count = Math.max(1, users.length);
      return html`<span class="play-online-count__count">${count}</span>
        <span class="play-online-count__label">${label}</span>`;
    },
  };
}

interface GuestbookEntry {
  name: string;
  message: string;
  at: number;
}

interface GuestbookData {
  entries: Record<string, GuestbookEntry>;
}

const NAME_MAX = 40;
const MESSAGE_MAX = 280;

function readLimit(element: HTMLElement): number {
  const parsed = Number.parseInt(element.getAttribute("limit") ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

function guestbook(): ElementInitializer<GuestbookData> {
  return {
    defaultData: { entries: {} },
    view: ({ data, setData, element }) => {
      const entries = Object.entries(data.entries ?? {})
        .filter(([, entry]) => entry && typeof entry.message === "string")
        .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
        .slice(0, readLimit(element));

      const onSubmit = (event: SubmitEvent) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const fields = new FormData(form);
        const name = String(fields.get("name") ?? "").trim().slice(0, NAME_MAX);
        const message = String(fields.get("message") ?? "")
          .trim()
          .slice(0, MESSAGE_MAX);
        if (!message) return;
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        // A keyed upsert, so concurrent signatures never collide.
        setData((draft) => {
          draft.entries ??= {};
          draft.entries[id] = { name, message, at: Date.now() };
        });
        form.reset();
      };

      return html`<form class="play-guestbook__form" @submit=${onSubmit}>
          <input
            name="name"
            maxlength=${NAME_MAX}
            placeholder="your name"
            aria-label="your name"
            autocomplete="nickname"
          />
          <textarea
            name="message"
            maxlength=${MESSAGE_MAX}
            placeholder="leave a note"
            aria-label="your note"
            required
          ></textarea>
          <button type="submit">sign</button>
        </form>
        ${entries.length === 0
          ? html`<p class="play-guestbook__empty">
              No notes yet. Be the first to sign.
            </p>`
          : html`<ol class="play-guestbook__entries">
              ${repeat(
                entries,
                ([id]) => id,
                ([, entry]) => html`<li class="play-guestbook__entry">
                  <div class="play-guestbook__message">${entry.message}</div>
                  <div class="play-guestbook__meta">
                    ${entry.name || "anonymous"}
                    ${entry.at
                      ? html` · <time datetime=${new Date(entry.at).toISOString()}
                            >${new Date(entry.at).toLocaleDateString()}</time
                          >`
                      : nothing}
                  </div>
                </li>`,
              )}
            </ol>`}`;
    },
  };
}

function initializerFor(
  tag: PrebuiltTag,
  element: HTMLElement,
  runtime: PrebuiltRuntime,
): ElementInitializer {
  switch (tag) {
    case "play-lamp":
      return lamp();
    case "play-reaction":
      return reaction(element, runtime);
    case "play-online-count":
      return onlineCount();
    case "play-guestbook":
      return guestbook();
  }
}

/** Binds one connected built-in tag. Returns null when it can't bind. */
export function mountPrebuiltElement(
  tag: PrebuiltTag,
  element: HTMLElement,
  runtime: PrebuiltRuntime,
): { unregister(): void } | null {
  injectStyles();
  if (!ensureId(tag, element)) return null;
  const init = initializerFor(tag, element, runtime);
  // The view owns the element's contents: drop authored children once, before
  // the first render. A re-mount (the element moved) keeps lit's rendered DOM.
  if (!preparedElements.has(element)) {
    preparedElements.add(element);
    if (tag !== "play-reaction") element.replaceChildren();
  }
  return runtime.register(element, init);
}
