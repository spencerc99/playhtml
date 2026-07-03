// ABOUTME: The village guestbook — canonical earned-roles example: visitors read,
// ABOUTME: returning visitors sign, regulars moderate, the keeper (owner pk) holds the deed.
import { playhtml } from "../packages/playhtml/src";
import {
  describeGuestbookStanding,
  type GuestbookCounterName,
} from "./utils/guestbookStanding";

const $ = (id: string) => document.getElementById(id)!;

interface Entry {
  name: string;
  message: string;
  at: number;
  color?: string;
  createdBy?: string; // server-stamped when enforcement is on
}
type Book = Record<string, Entry>;

const bookEl = $("village-guestbook");
let api: {
  getData: () => Book;
  setData: (updater: Book | ((draft: Book) => void)) => void;
} | null = null;

(bookEl as any).defaultData = {} satisfies Book;
(bookEl as any).updateElement = ({ data }: { data: Book }) => renderBook(data);
(bookEl as any).onMount = (mounted: typeof api) => {
  api = mounted;
  renderBook(mounted!.getData());
};

// ---------------------------------------------------------------------------
// The ladder — which rung you stand on, derived from server-attested state.
// ---------------------------------------------------------------------------

type Rung = "visitor" | "returning" | "regular" | "keeper";

function myRung(): Rung {
  const { roles } = playhtml.me;
  if (roles.includes("admin")) return "keeper";
  if (roles.includes("regular")) return "regular";
  if (roles.includes("returning")) return "returning";
  return "visitor";
}

const RUNG_ORDER: Rung[] = ["visitor", "returning", "regular", "keeper"];
const STANDING_COUNTER: GuestbookCounterName = "sessions";
const REGULAR_THRESHOLD = 5;

function renderStanding(): void {
  const me = playhtml.me;
  const rung = myRung();
  const rungIndex = RUNG_ORDER.indexOf(rung);

  document.querySelectorAll<HTMLElement>(".rung").forEach((el) => {
    const idx = RUNG_ORDER.indexOf(el.dataset.rung as Rung);
    el.classList.toggle("held", idx <= rungIndex);
    el.classList.toggle("next", idx === rungIndex + 1);
  });

  const canSign = playhtml.can("create", "#village-guestbook");
  ($("sign-btn") as HTMLButtonElement).disabled = !canSign;
  const copy = describeGuestbookStanding({
    rung,
    counterName: STANDING_COUNTER,
    counters: me.counters,
    permissionsEnforced: playhtml.permissionsEnforced,
    canSign,
    regularThreshold: REGULAR_THRESHOLD,
  });
  $("standing").textContent = copy.standing;
  $("sign-note").textContent = copy.signNote;
}

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

function renderBook(book: Book): void {
  bookEl.innerHTML = "";
  const entries = Object.entries(book ?? {}).sort((a, b) => b[1].at - a[1].at);

  if (entries.length === 0) {
    const blank = document.createElement("p");
    blank.className = "hint";
    blank.textContent = "the book lies open to its first page…";
    bookEl.append(blank);
  }

  for (const [id, entry] of entries) {
    const row = document.createElement("div");
    row.className = "entry";

    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = entry.message;

    const meta = document.createElement("div");
    meta.className = "meta";
    const when = new Date(entry.at).toLocaleDateString();
    meta.textContent = `— ${entry.name || "someone"}, ${when}${
      playhtml.me.owns(entry) ? " (you)" : ""
    }`;
    if (entry.color) meta.style.color = entry.color;

    const tools = document.createElement("div");
    tools.className = "tools";
    if (playhtml.can("update", "#village-guestbook", { entry })) {
      const edit = document.createElement("button");
      edit.textContent = "amend";
      edit.onclick = () => {
        const message = prompt("amend your entry:", entry.message);
        if (message === null || !api) return;
        api.setData({ ...api.getData(), [id]: { ...entry, message } });
      };
      tools.append(edit);
    }
    if (playhtml.can("delete", "#village-guestbook", { entry })) {
      const sweep = document.createElement("button");
      // Regulars sweeping someone else's entry vs. removing your own.
      sweep.textContent = playhtml.me.owns(entry) ? "remove" : "sweep up";
      sweep.onclick = () => {
        if (!api || !confirm("remove this entry from the book?")) return;
        const next = { ...api.getData() };
        delete next[id];
        api.setData(next);
      };
      tools.append(sweep);
    }

    row.append(msg, meta, tools);
    bookEl.append(row);
  }
}

$("sign-btn").addEventListener("click", () => {
  const name = ($("sign-name") as HTMLInputElement).value.trim();
  const message = ($("sign-message") as HTMLInputElement).value.trim();
  if (!message || !api) return;
  const identity = playhtml.cursorClient?.getMyPlayerIdentity();
  const id = crypto.randomUUID().slice(0, 8);
  api.setData({
    ...api.getData(),
    [id]: {
      name: name || playhtml.me.name || "someone",
      message,
      at: Date.now(),
      color: identity?.playerStyle.colorPalette[0],
      // Advisory in client-only mode; the server re-stamps with the verified pid.
      createdBy: playhtml.me.pid,
    },
  });
  ($("sign-message") as HTMLInputElement).value = "";
});

document.addEventListener("permissiondenied", (e) => {
  const detail = (e as CustomEvent).detail;
  bookEl.classList.add("denied");
  setTimeout(() => bookEl.classList.remove("denied"), 400);
  $("sign-note").textContent = `⛔ the book declined (${detail.reason})`;
  setTimeout(renderStanding, 3000);
});

playhtml.onIdentityChange(() => {
  renderStanding();
  if (api) renderBook(api.getData());
});

void playhtml.init({
  cursors: { enabled: true },
  permissions: {
    // Mirrors /.well-known/playhtml.json. `create:returning` is deliberately
    // NOT mirrored: earned counters only exist server-side, so in client-only
    // mode signing stays open rather than impossible.
    elements: {
      "village-guestbook": "update:creator, delete:creator|regular|admin",
    },
  },
});

playhtml.ready.then(renderStanding);
renderStanding();
