// ABOUTME: Test page for page-level shared data and presence API.
// ABOUTME: Demonstrates createPageData and playhtml.people with live UI.

import { playhtml, type Person } from "../../packages/playhtml/src";

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

  // --- People: Who's Here ---

  const people = playhtml.people;
  const myIdentityEl = document.getElementById("myIdentity")!;
  myIdentityEl.textContent = people.me.name ?? people.me.pid.slice(0, 12) + "...";
  myIdentityEl.style.color = people.me.color || "#999";

  const userListEl = document.getElementById("userList")!;
  const statusListEl = document.getElementById("statusList")!;
  const debugStateEl = document.getElementById("debugState")!;

  const labelFor = (person: Person) =>
    (person.name ?? person.pid.slice(0, 12) + "...") +
    (person.isMe ? " (you)" : "");

  function renderUserList(everyone: Person[]) {
    if (everyone.length === 0) {
      userListEl.innerHTML = '<li style="color: #8a8279;">(no users)</li>';
      return;
    }
    userListEl.innerHTML = "";
    for (const person of everyone) {
      const li = document.createElement("li");
      const cursor = person.presence.cursor;
      const cursorInfo = cursor
        ? ` [cursor: ${Math.round(cursor.x)}, ${Math.round(cursor.y)}]`
        : "";
      li.innerHTML = `<span class="color-dot" style="background:${person.color || "#999"}"></span>${labelFor(person)}${cursorInfo}`;
      userListEl.appendChild(li);
    }
  }

  function renderStatuses(everyone: Person[]) {
    const statuses: string[] = [];
    for (const person of everyone) {
      const status = person.presence.status as { text: string } | undefined;
      if (status) statuses.push(`${labelFor(person)}: ${status.text}`);
    }
    if (statuses.length === 0) {
      statusListEl.innerHTML = '<li style="color: #8a8279;">(no statuses)</li>';
    } else {
      statusListEl.innerHTML = statuses.map((s) => `<li>${s}</li>`).join("");
    }
  }

  function renderDebug() {
    const debugData: Record<string, unknown> = {};
    for (const person of people.everyone) {
      debugData[person.pid.slice(0, 12)] = person;
    }
    debugStateEl.textContent = JSON.stringify(
      {
        counter: counter.getData(),
        clickMap: clickMap.getData(),
        people: debugData,
      },
      null,
      2,
    );
  }

  // Watch cursors for the user list (includes position)
  people.onChange("cursor", (everyone) => {
    renderUserList(everyone);
    renderDebug();
  });

  // Watch statuses
  people.onChange("status", (everyone) => {
    renderStatuses(everyone);
    renderDebug();
  });

  // --- People: Custom presence keys ---

  document.getElementById("setStatusOnline")!.addEventListener("click", () => {
    people.setMyPresence("status", { text: "online" });
  });
  document.getElementById("setStatusBusy")!.addEventListener("click", () => {
    people.setMyPresence("status", { text: "busy" });
  });
  document.getElementById("setStatusAway")!.addEventListener("click", () => {
    people.setMyPresence("status", { text: "away" });
  });
  document.getElementById("clearStatus")!.addEventListener("click", () => {
    people.setMyPresence("status", null);
  });
}

main();
