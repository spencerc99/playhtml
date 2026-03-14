// ABOUTME: Test page for page-level shared data and presence API.
// ABOUTME: Demonstrates createPageData and playhtml.presence with live UI.

import { playhtml } from "../../packages/playhtml/src";

async function main() {
  await playhtml.init({
    cursors: {
      enabled: true,
    },
  });

  // --- Page Data: Shared Counter ---

  const counter = playhtml.createPageData("test-counter", { count: 0 });

  const counterValue = document.getElementById("counterValue")!;
  function renderCounter(data: { count: number }) {
    counterValue.textContent = String(data.count);
  }
  renderCounter(counter.getData());
  counter.onUpdate(renderCounter);

  document.getElementById("incrementBtn")!.addEventListener("click", () => {
    counter.setData((draft) => {
      draft.count += 1;
    });
  });
  document.getElementById("decrementBtn")!.addEventListener("click", () => {
    counter.setData((draft) => {
      draft.count -= 1;
    });
  });
  document.getElementById("resetBtn")!.addEventListener("click", () => {
    counter.setData({ count: 0 });
  });

  // --- Page Data: Click Map ---

  type ClickMapData = { clicks: Record<string, number> };
  const clickMap = playhtml.createPageData<ClickMapData>("test-click-map", {
    clicks: {},
  });

  const clickMapEl = document.getElementById("clickMap")!;
  function renderClickMap(data: ClickMapData) {
    clickMapEl.innerHTML = "";
    const entries = Object.entries(data.clicks).sort(
      ([, a], [, b]) => b - a,
    );
    if (entries.length === 0) {
      clickMapEl.textContent = "(no clicks yet)";
      return;
    }
    for (const [item, count] of entries) {
      const el = document.createElement("div");
      el.textContent = `${item}: ${count}`;
      clickMapEl.appendChild(el);
    }
  }
  renderClickMap(clickMap.getData());
  clickMap.onUpdate(renderClickMap);

  document.querySelectorAll(".click-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = (btn as HTMLElement).dataset.item!;
      clickMap.setData((draft) => {
        const clicks = draft.clicks as Record<string, number>;
        clicks[item] = (clicks[item] ?? 0) + 1;
      });
    });
  });

  // --- Presence: Who's Here ---

  const myIdentity = playhtml.presence.getMyIdentity();
  const myIdentityEl = document.getElementById("myIdentity")!;
  myIdentityEl.textContent = myIdentity.publicKey.slice(0, 12) + "...";
  const primaryColor = myIdentity.playerStyle.colorPalette[0] ?? "#999";
  myIdentityEl.style.color = primaryColor;

  const userListEl = document.getElementById("userList")!;
  const statusListEl = document.getElementById("statusList")!;
  const debugStateEl = document.getElementById("debugState")!;

  function renderPresences(presences: Map<string, any>) {
    // User list
    if (presences.size === 0) {
      userListEl.innerHTML =
        '<li style="color: #8a8279;">(no other users)</li>';
    } else {
      userListEl.innerHTML = "";
      presences.forEach((p, id) => {
        const li = document.createElement("li");
        const color =
          p.playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#999";
        const name = p.playerIdentity?.name ?? id.slice(0, 12) + "...";
        const cursorInfo = p.cursor
          ? ` [cursor: ${Math.round(p.cursor.x)}, ${Math.round(p.cursor.y)}]`
          : "";
        li.innerHTML = `<span class="color-dot" style="background:${color}"></span>${name}${cursorInfo}`;
        userListEl.appendChild(li);
      });
    }

    // Status list
    const statuses: string[] = [];
    presences.forEach((p, id) => {
      if (p.status) {
        const name =
          p.playerIdentity?.name ?? id.slice(0, 12) + "...";
        statuses.push(`${name}: ${p.status.text}`);
      }
    });
    if (statuses.length === 0) {
      statusListEl.innerHTML =
        '<li style="color: #8a8279;">(no statuses)</li>';
    } else {
      statusListEl.innerHTML = statuses
        .map((s) => `<li>${s}</li>`)
        .join("");
    }

    // Debug
    const debugData: Record<string, any> = {};
    presences.forEach((p, id) => {
      debugData[id.slice(0, 12)] = p;
    });
    debugStateEl.textContent = JSON.stringify(
      {
        counter: counter.getData(),
        clickMap: clickMap.getData(),
        presences: debugData,
      },
      null,
      2,
    );
  }

  // Initial render
  renderPresences(playhtml.presence.getPresences());
  playhtml.presence.onPresenceChange(renderPresences);

  // --- Presence: Custom Channels ---

  document.getElementById("setStatusOnline")!.addEventListener("click", () => {
    playhtml.presence.setMyPresence("status", { text: "online" });
  });
  document.getElementById("setStatusBusy")!.addEventListener("click", () => {
    playhtml.presence.setMyPresence("status", { text: "busy" });
  });
  document.getElementById("setStatusAway")!.addEventListener("click", () => {
    playhtml.presence.setMyPresence("status", { text: "away" });
  });
  document.getElementById("clearStatus")!.addEventListener("click", () => {
    playhtml.presence.setMyPresence("status", null);
  });
}

main();
