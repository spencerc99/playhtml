import type { PlayHTMLComponents } from "./index";
import { normalizePath } from "@playhtml/common";

export function listSharedElements() {
  const out: Array<{
    type: "source" | "consumer";
    elementId: string;
    dataSource: string;
    normalized: string;
    permissions?: "read-only" | "read-write";
    element: HTMLElement;
  }> = [];

  document.querySelectorAll("[shared]").forEach((el) => {
    const element = el as HTMLElement;
    const id = element.id;
    if (!id) return;
    const ds = `${window.location.host}${normalizePath(
      window.location.pathname
    )}#${id}`;
    out.push({
      type: "source",
      elementId: id,
      dataSource: ds,
      normalized: ds,
      permissions: element.getAttribute("shared")?.includes("read-only")
        ? "read-only"
        : "read-write",
      element,
    });
  });

  document.querySelectorAll("[data-source]").forEach((el) => {
    const element = el as HTMLElement;
    const raw = element.getAttribute("data-source") || "";
    const [domainAndPath, elementId] = raw.split("#");
    if (!domainAndPath || !elementId) return;
    const firstSlash = domainAndPath.indexOf("/");
    const domain =
      firstSlash === -1 ? domainAndPath : domainAndPath.slice(0, firstSlash);
    const path = firstSlash === -1 ? "/" : domainAndPath.slice(firstSlash);
    const normalized = `${domain}${normalizePath(path)}#${elementId}`;
    out.push({
      type: "consumer",
      elementId,
      dataSource: raw,
      normalized,
      element,
    });
  });

  try {
    console.table(
      out.map((e) => ({
        type: e.type,
        elementId: e.elementId,
        dataSource: e.dataSource,
        normalized: e.normalized,
        permissions: e.permissions || "",
      }))
    );
  } catch {}
  return out;
}

export function setupDevUI(playhtml: PlayHTMLComponents) {
  const { syncedStore: store, elementHandlers } = playhtml;

  const devUi = document.createElement("div");
  devUi.id = "playhtml-dev-ui";
  devUi.style.position = "fixed";
  devUi.style.bottom = "10px";
  devUi.style.left = "10px";
  devUi.style.zIndex = "10000";

  const infoBar = document.createElement("div");
  infoBar.style.display = "flex";
  infoBar.style.gap = "8px";
  infoBar.style.marginBottom = "6px";
  infoBar.style.padding = "8px";
  infoBar.style.background = "rgba(17,17,17,0.9)";
  infoBar.style.border = "1px solid #444";
  infoBar.style.borderRadius = "8px";
  infoBar.style.color = "#fff";

  function makeChip(label: string, value: string) {
    const chip = document.createElement("span");
    chip.style.display = "inline-flex";
    chip.style.alignItems = "center";
    chip.style.gap = "6px";
    chip.style.background = "#222";
    chip.style.border = "1px solid #555";
    chip.style.borderRadius = "6px";
    chip.style.padding = "4px 8px";
    chip.style.cursor = "pointer";
    const lbl = document.createElement("strong");
    lbl.textContent = label;
    lbl.style.color = "#8ab4ff";
    const val = document.createElement("span");
    val.textContent = value;
    chip.appendChild(lbl);
    chip.appendChild(val);
    chip.title = `Click to copy ${label}`;
    chip.onclick = async () => {
      try {
        await navigator.clipboard.writeText(value);
        chip.style.outline = "2px solid #8ab4ff";
        setTimeout(() => (chip.style.outline = "none"), 600);
      } catch {}
    };
    return chip;
  }

  const decodedRoom = (() => {
    try {
      return decodeURIComponent(playhtml.roomId);
    } catch {
      return playhtml.roomId;
    }
  })();

  const roomChip = makeChip("room", decodedRoom);
  const hostChip = makeChip("host", playhtml.host);
  infoBar.appendChild(roomChip);
  infoBar.appendChild(hostChip);
  devUi.appendChild(infoBar);

  const resetDataButton = document.createElement("button");
  resetDataButton.innerText = "Reset Data";
  resetDataButton.style.background = "#b00020";
  resetDataButton.style.color = "#fff";
  resetDataButton.style.border = "none";
  resetDataButton.style.borderRadius = "6px";
  resetDataButton.style.padding = "6px 10px";
  resetDataButton.onclick = () => {
    const ids: string[] = [];
    Object.keys(store).forEach((tag) => {
      const tagData = store[tag];
      if (tagData) ids.push(...Object.keys(tagData));
    });
    const warning = ids.length
      ? `This will clear ${ids.length} element(s):\n${ids.join(", ")}`
      : "No elements found to clear. Proceed?";
    const ok = window.confirm(warning);
    if (!ok) return;
    Object.keys(store).forEach((tag) => {
      const tagData = store[tag];
      if (tagData) {
        Object.keys(tagData).forEach((elementId) => {
          delete tagData[elementId];
        });
      }
    });
  };
  devUi.appendChild(resetDataButton);

  // Removed manual refresh; list will be (re)rendered below

  let logObjectMode = false;
  const logObjectDataButton = document.createElement("button");
  logObjectDataButton.innerText = "Log Object Mode";

  // Create overlay elements
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.pointerEvents = "none";
  overlay.style.border = "2px solid #ff0000";
  overlay.style.backgroundColor = "rgba(255, 0, 0, 0.1)";
  overlay.style.zIndex = "9999";
  overlay.style.display = "none";

  const idLabel = document.createElement("div");
  idLabel.style.position = "fixed";
  idLabel.style.backgroundColor = "#ff0000";
  idLabel.style.color = "#ffffff";
  idLabel.style.padding = "2px 5px";
  idLabel.style.fontSize = "12px";
  idLabel.style.zIndex = "10000";
  idLabel.style.display = "none";

  document.body.appendChild(overlay);
  document.body.appendChild(idLabel);

  logObjectDataButton.onclick = () => {
    logObjectMode = !logObjectMode;
    logObjectDataButton.innerText = logObjectMode
      ? "Exit Log Mode"
      : "Log Object Data";
    document.body.style.cursor = logObjectMode ? "pointer" : "default";
    if (!logObjectMode) {
      overlay.style.display = "none";
      idLabel.style.display = "none";
    }
  };
  devUi.appendChild(logObjectDataButton);

  const sharedList = document.createElement("div");
  sharedList.style.maxHeight = "200px";
  sharedList.style.overflow = "auto";
  sharedList.style.marginTop = "6px";
  sharedList.style.padding = "6px";
  sharedList.style.background = "rgba(0,0,0,0.6)";
  sharedList.style.color = "white";
  sharedList.style.fontSize = "12px";
  sharedList.style.borderRadius = "6px";
  devUi.appendChild(sharedList);

  function highlightElement(el: HTMLElement | null) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    idLabel.style.display = "block";
    idLabel.style.left = `${rect.left}px`;
    idLabel.style.top = `${rect.top - 20}px`;
    idLabel.textContent = `#${el.id}`;
  }

  function renderSharedList() {
    sharedList.innerHTML = "";
    const header = document.createElement("div");
    header.textContent = "Shared Elements";
    header.style.fontSize = "12px";
    header.style.fontWeight = "bold";
    header.style.marginBottom = "6px";
    header.style.color = "white";
    sharedList.appendChild(header);
    const items = listSharedElements();
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No shared elements found";
      sharedList.appendChild(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "6px";
      row.style.alignItems = "center";
      const badge = document.createElement("span");
      badge.textContent = item.type === "source" ? "SRC" : "REF";
      badge.style.padding = "2px 4px";
      badge.style.borderRadius = "4px";
      badge.style.background = item.type === "source" ? "#2b8a3e" : "#364fc7";
      const text = document.createElement("span");
      text.textContent = `${item.elementId} — ${item.normalized}`;
      row.appendChild(badge);
      row.appendChild(text);
      row.onmouseenter = () => highlightElement(item.element);
      row.onmouseleave = () => {
        overlay.style.display = "none";
        idLabel.style.display = "none";
      };
      row.onclick = () =>
        item.element.scrollIntoView({ behavior: "smooth", block: "center" });
      sharedList.appendChild(row);
    });
  }

  renderSharedList();

  document.body.appendChild(devUi);

  // Add mousemove event listener for highlighting
  document.addEventListener("mousemove", (event) => {
    if (!logObjectMode) return;

    const target = event.target as HTMLElement;
    const playElement = target.closest("[class^='__playhtml-']");

    if (playElement && playElement instanceof HTMLElement) {
      const rect = playElement.getBoundingClientRect();
      overlay.style.display = "block";
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      idLabel.style.display = "block";
      idLabel.style.left = `${rect.left}px`;
      idLabel.style.top = `${rect.top - 20}px`;
      idLabel.textContent = `#${playElement.id}`;
    } else {
      overlay.style.display = "none";
      idLabel.style.display = "none";
    }
  });

  // Add click event listener to log data
  document.addEventListener("click", (event) => {
    if (!logObjectMode) return;

    const target = event.target as HTMLElement;
    const playElement = target.closest("[class^='__playhtml-']");

    if (playElement && playElement instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();

      const elementId = playElement.id;
      const tagType = Array.from(playElement.classList)
        .find((cls) => cls.startsWith("__playhtml-"))
        ?.replace("__playhtml-", "");

      if (tagType && elementHandlers.has(tagType)) {
        const handler = elementHandlers.get(tagType)!.get(elementId);
        if (handler) {
          console.log(
            `Data for element #${elementId} (${tagType}):`,
            handler.__data
          );
        } else {
          console.log(`No data found for element #${elementId} (${tagType})`);
        }
      } else {
        console.log(`Unable to find data for element #${elementId}`);
      }
    }
  });
}
