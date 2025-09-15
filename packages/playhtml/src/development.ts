import { playhtml } from "./index";
const { syncedStore: store, elementHandlers } = playhtml;

export function setupDevUI() {
  const devUi = document.createElement("div");
  devUi.id = "playhtml-dev-ui";
  devUi.style.position = "fixed";
  devUi.style.bottom = "10px";
  devUi.style.left = "10px";
  devUi.style.zIndex = "10000";

  const resetDataButton = document.createElement("button");
  resetDataButton.innerText = "Reset Data";
  resetDataButton.onclick = () => {
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

  let logObjectMode = false;
  const logObjectDataButton = document.createElement("button");
  logObjectDataButton.innerText = "Log Object Data";

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
