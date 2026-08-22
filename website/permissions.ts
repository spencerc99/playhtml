// ABOUTME: Manual test page for identity & permissions — identity panel, an
// ABOUTME: admin-gated title, and creator-owned notes with live event logging.
import { playhtml } from "../packages/playhtml/src";

const $ = (id: string) => document.getElementById(id)!;

function log(message: string): void {
  const el = $("event-log");
  const time = new Date().toLocaleTimeString();
  el.textContent = `[${time}] ${message}\n` + (el.textContent ?? "");
}

// ---------------------------------------------------------------------------
// Identity panel
// ---------------------------------------------------------------------------

function renderMe(): void {
  const me = playhtml.me;
  $("my-pid").textContent = `pid: ${me.pid ? me.pid.slice(0, 16) + "…" : "…"}`;
  $("my-pid").dataset.pid = me.pid ?? "";
  $("my-source").textContent = `source: ${me.source ?? "legacy"}`;
  $("my-verified").textContent = me.verified ? "verified ✓" : "unverified";
  $("my-verified").classList.toggle("on", me.verified);
  $("my-enforced").textContent = playhtml.permissionsEnforced
    ? "enforcement: server"
    : "enforcement: client-only";
  $("my-enforced").classList.toggle("on", playhtml.permissionsEnforced);
  $("my-roles").textContent = `roles: ${me.roles.length ? me.roles.join(", ") : "—"}`;
  // Lock icon mirrors whether *you* hold the title key right now.
  $("title-lock").textContent = playhtml.can("write", "#locked-title") ? "🔓" : "🔒";
}

$("my-pid").addEventListener("click", () => {
  const pid = $("my-pid").dataset.pid;
  if (!pid) return;
  void navigator.clipboard.writeText(pid);
  log(`copied pid to clipboard: ${pid}`);
});

$("verify-btn").addEventListener("click", async () => {
  log("verify() — running key handshake…");
  const ok = await playhtml.verify();
  log(`verify() resolved: ${ok}`);
});

// ---------------------------------------------------------------------------
// Admin-gated title (write:admin)
// ---------------------------------------------------------------------------

interface TitleData {
  text: string;
}

const titleEl = $("locked-title");
(titleEl as any).defaultData = { text: "untitled room" } satisfies TitleData;
(titleEl as any).updateElement = ({ data }: { data: TitleData }) => {
  titleEl.textContent = data.text || "untitled room";
};

let setTitleData: ((data: TitleData) => void) | null = null;
(titleEl as any).onMount = ({ setData }: { setData: (d: TitleData) => void }) => {
  setTitleData = setData;
};

$("title-save").addEventListener("click", () => {
  const text = ($("title-input") as HTMLInputElement).value.trim();
  if (!text || !setTitleData) return;
  log(`attempting title write: "${text}" (can: ${playhtml.can("write", "#locked-title")})`);
  setTitleData({ text });
});

// ---------------------------------------------------------------------------
// Creator-owned notes (create:verified, update:creator, delete:creator|admin)
// ---------------------------------------------------------------------------

interface Note {
  text: string;
  name?: string;
  createdBy?: string; // stamped by the server; client value is advisory
  at: number;
}
type Notes = Record<string, Note>;

const notesEl = $("playground-notes");
let notesApi: {
  getData: () => Notes;
  setData: (updater: Notes | ((draft: Notes) => void)) => void;
} | null = null;

(notesEl as any).defaultData = {} satisfies Notes;
(notesEl as any).updateElement = ({ data }: { data: Notes }) => renderNotes(data);
(notesEl as any).onMount = (api: typeof notesApi) => {
  notesApi = api;
  renderNotes(api!.getData());
};

function renderNotes(notes: Notes): void {
  notesEl.innerHTML = "";
  const entries = Object.entries(notes ?? {}).sort((a, b) => a[1].at - b[1].at);
  for (const [id, note] of entries) {
    const row = document.createElement("div");
    row.className = "note";
    const mine = playhtml.me.owns(note);
    const body = document.createElement("span");
    body.textContent = note.text;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = mine ? "you" : (note.createdBy ?? "?").slice(0, 10) + "…";
    row.append(body, who);

    if (playhtml.can("update", "#playground-notes", { entry: note })) {
      const edit = document.createElement("button");
      edit.textContent = "✏️";
      edit.onclick = () => {
        const text = prompt("edit your note:", note.text);
        if (text === null || !notesApi) return;
        notesApi.setData({ ...notesApi.getData(), [id]: { ...note, text } });
      };
      row.append(edit);
    }
    if (playhtml.can("delete", "#playground-notes", { entry: note })) {
      const del = document.createElement("button");
      del.textContent = "🗑";
      del.onclick = () => {
        if (!notesApi) return;
        const next = { ...notesApi.getData() };
        delete next[id];
        notesApi.setData(next);
      };
      row.append(del);
    }
    notesEl.append(row);
  }
}

$("note-add").addEventListener("click", () => {
  const input = $("note-input") as HTMLInputElement;
  const text = input.value.trim();
  if (!text || !notesApi) return;
  const id = crypto.randomUUID().slice(0, 8);
  log(`pinning note (can create: ${playhtml.can("create", "#playground-notes")})`);
  notesApi.setData({
    ...notesApi.getData(),
    // createdBy is advisory client-side; the server re-stamps it with the
    // verified pid when enforcement is on.
    [id]: { text, name: playhtml.me.name, at: Date.now(), createdBy: playhtml.me.pid },
  });
  input.value = "";
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

document.addEventListener("permissiondenied", (e) => {
  const detail = (e as CustomEvent).detail;
  log(`⛔ permissiondenied: ${detail.action} on #${detail.elementId} — ${detail.reason}`);
  const el = document.getElementById(detail.elementId);
  el?.classList.add("denied");
  setTimeout(() => el?.classList.remove("denied"), 400);
});

playhtml.onIdentityChange((me) => {
  log(`identity change: pid=${me.pid?.slice(0, 12)}… verified=${me.verified} roles=[${me.roles}]`);
  renderMe();
  // Ownership affordances depend on identity — re-render notes.
  if (notesApi) renderNotes(notesApi.getData());
});

// ---------------------------------------------------------------------------
// Init — client rules mirror the well-known file (minus `create:verified`,
// so the page still works in client-only mode where nobody can verify).
// ---------------------------------------------------------------------------

void playhtml.init({
  permissions: {
    elements: {
      "locked-title": "write:admin",
      "playground-notes": "update:creator, delete:creator|admin",
    },
  },
});

playhtml.ready.then(() => {
  log(`connected to room ${playhtml.roomId}`);
  renderMe();
});
renderMe();
