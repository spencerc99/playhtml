// ABOUTME: The village guestbook permissions demo: visitors read, verified users sign.
// ABOUTME: Entry creators tend their own notes, while the keeper key moderates the book.
import { playhtml } from "../packages/playhtml/src";

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
// The ladder — which rung you stand on, derived from verified identity state.
// ---------------------------------------------------------------------------

type Rung = "visitor" | "verified" | "keeper";

function myRung(): Rung {
  const { roles, verified } = playhtml.me;
  if (roles.includes("admin")) return "keeper";
  if (verified) return "verified";
  return "visitor";
}

const RUNG_ORDER: Rung[] = ["visitor", "verified", "keeper"];

function describeStanding(rung: Rung, canSign: boolean): {
  standing: string;
  signNote: string;
} {
  if (rung === "keeper") {
    return {
      standing: "you are the keeper · you may tend the whole book",
      signNote: "the book is yours to tend.",
    };
  }

  if (canSign) {
    return {
      standing: "you are verified · you may sign and tend your own entry",
      signNote: "you may sign. you can amend or remove your own entry later.",
    };
  }

  return {
    standing: playhtml.permissionsEnforced
      ? "checking your key…"
      : "you are a visitor · the book is readable, but signing needs verification",
    signNote: "",
  };
}

function renderStanding(): void {
  const rung = myRung();
  const rungIndex = RUNG_ORDER.indexOf(rung);

  document.querySelectorAll<HTMLElement>(".rung").forEach((el) => {
    const idx = RUNG_ORDER.indexOf(el.dataset.rung as Rung);
    el.classList.toggle("held", idx <= rungIndex);
    el.classList.toggle("next", idx === rungIndex + 1);
  });

  const canSign = playhtml.can("create", "#village-guestbook");
  ($("sign-btn") as HTMLButtonElement).disabled = !canSign;
  const copy = describeStanding(rung, canSign);
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
    // Mirrors /.well-known/playhtml.json for client-side affordances.
    elements: {
      "village-guestbook": "create:verified, update:creator, delete:creator|admin",
    },
  },
});

playhtml.ready.then(renderStanding);
renderStanding();
