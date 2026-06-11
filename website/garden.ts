// ABOUTME: Community garden — each visitor claims one plot (keyed by their pid),
// ABOUTME: only the plot's creator can tend it; gated by entry-level permissions.
import { playhtml } from "../packages/playhtml/src";

// Growth stages by tend count thresholds.
const STAGES = ["🌱", "🌿", "🪴", "🌷", "🌻", "🌳"];
const TENDS_PER_STAGE = 3;

interface Plot {
  seed: number; // picks the flower variety implicitly via stage art
  tends: number;
  name?: string;
  color?: string;
  plantedAt: number;
  createdBy?: string; // stamped by the server
}
type Garden = Record<string, Plot>; // keyed by gardener pid — one plot each

const gardenEl = document.getElementById("community-garden")!;
const statusEl = document.getElementById("garden-status")!;

let api: {
  getData: () => Garden;
  setData: (updater: Garden | ((draft: Garden) => void)) => void;
} | null = null;

(gardenEl as any).defaultData = {} satisfies Garden;
(gardenEl as any).updateElement = ({ data }: { data: Garden }) => render(data);
(gardenEl as any).onMount = (mounted: typeof api) => {
  api = mounted;
  render(mounted!.getData());
};

function stageFor(plot: Plot): string {
  const stage = Math.min(
    Math.floor(plot.tends / TENDS_PER_STAGE),
    STAGES.length - 1,
  );
  return STAGES[stage];
}

function render(garden: Garden): void {
  gardenEl.innerHTML = "";
  const me = playhtml.me;
  const entries = Object.entries(garden ?? {}).sort(
    (a, b) => a[1].plantedAt - b[1].plantedAt,
  );

  for (const [pid, plot] of entries) {
    const el = document.createElement("div");
    el.className = "plot" + (me.owns(plot) || pid === me.pid ? " mine" : "");
    if (plot.color) el.style.borderColor = plot.color;

    const plant = document.createElement("span");
    plant.className = "plant";
    plant.textContent = stageFor(plot);

    const gardener = document.createElement("span");
    gardener.className = "gardener";
    gardener.textContent = plot.name || pid.slice(0, 10) + "…";

    const tends = document.createElement("span");
    tends.className = "tends";
    tends.textContent = `tended ${plot.tends}×`;

    el.append(plant, gardener, tends);

    if (playhtml.can("update", "#community-garden", { entry: plot })) {
      const water = document.createElement("button");
      water.textContent = "💧 water";
      water.onclick = () => tend(pid);
      el.append(water);
    }
    if (playhtml.can("delete", "#community-garden", { entry: plot })) {
      const uproot = document.createElement("button");
      uproot.textContent = "uproot";
      uproot.onclick = () => {
        if (!api || !confirm("uproot your plant?")) return;
        const next = { ...api.getData() };
        delete next[pid];
        api.setData(next);
      };
      el.append(uproot);
    }
    gardenEl.append(el);
  }

  // One empty plot invites the visitor to claim theirs.
  const myPid = me.pid;
  if (myPid && !(garden ?? {})[myPid]) {
    const empty = document.createElement("div");
    empty.className = "plot empty";
    empty.textContent = "＋ claim a plot";
    empty.onclick = claimPlot;
    gardenEl.append(empty);
  }

  statusEl.textContent = `${entries.length} plot(s) · ${
    playhtml.permissionsEnforced
      ? "keys checked by the server 🗝️"
      : "client-only mode (run the dev server + well-known file for real enforcement)"
  }`;
}

function claimPlot(): void {
  const me = playhtml.me;
  if (!api || !me.pid) return;
  const identity = playhtml.cursorClient?.getMyPlayerIdentity();
  api.setData({
    ...api.getData(),
    [me.pid]: {
      seed: Math.floor(Math.random() * 1000),
      tends: 0,
      name: me.name,
      color: identity?.playerStyle.colorPalette[0],
      plantedAt: Date.now(),
      // Advisory in client-only mode; the server re-stamps it with the
      // verified pid when enforcement is on (forgeries are ignored there).
      createdBy: me.pid,
    },
  });
}

function tend(pid: string): void {
  if (!api) return;
  const garden = api.getData();
  const plot = garden[pid];
  if (!plot) return;
  api.setData({ ...garden, [pid]: { ...plot, tends: plot.tends + 1 } });
}

document.addEventListener("permissiondenied", (e) => {
  const detail = (e as CustomEvent).detail;
  gardenEl.classList.add("denied");
  setTimeout(() => gardenEl.classList.remove("denied"), 400);
  statusEl.textContent = `⛔ that's not your plot (${detail.reason})`;
});

playhtml.onIdentityChange(() => {
  if (api) render(api.getData());
});

void playhtml.init({
  cursors: { enabled: true },
  permissions: {
    // Mirrors /.well-known/playhtml.json (minus create:verified so claiming
    // still works in client-only mode; the server enforces `verified`).
    elements: {
      "community-garden": "update:creator, delete:creator|admin",
    },
  },
});
