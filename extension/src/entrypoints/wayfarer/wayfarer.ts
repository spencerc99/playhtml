// ABOUTME: DOM wiring for the wayfarer shell page — frames the internet map and relays the journey.
// ABOUTME: Message shapes and URL building live in features/wayfarer/shell.ts so they stay testable.

import browser from "webextension-polyfill";
import { INTERNET_MAP_URL } from "@movement/config";
import {
  WAYFARER_JOURNEY_KEY,
  WAYFARER_WIDGET_KEY,
  emptyJourney,
  normalizeJourney,
  normalizeWidgetState,
  type Journey,
} from "../../features/wayfarer/journey";
import {
  buildJourneyMessage,
  buildWidgetSrc,
  cursorColorOf,
  isMapMessage,
  mapOrigin,
  openMapUrl,
} from "../../features/wayfarer/shell";

const mapFrame = document.getElementById("map") as HTMLIFrameElement | null;
const caption = document.getElementById("caption");
const toggleButton = document.getElementById("toggle");
const openButton = document.getElementById("open");

const targetOrigin = mapOrigin(INTERNET_MAP_URL);

let journey: Journey = emptyJourney();
let mapReady = false;
/** the person's cursor colour, once the background has said what it is */
let cursorColor: string | null = null;

function sendJourney() {
  if (!mapReady || !mapFrame?.contentWindow) return;
  mapFrame.contentWindow.postMessage(
    buildJourneyMessage(journey, cursorColor),
    targetOrigin,
  );
}

function applyWidgetState(collapsed: boolean) {
  if (toggleButton) {
    toggleButton.textContent = collapsed ? "+" : "–";
    toggleButton.setAttribute("aria-label", collapsed ? "Expand map" : "Collapse map");
  }
  if (mapFrame) mapFrame.hidden = collapsed;
}

if (mapFrame) mapFrame.src = buildWidgetSrc(INTERNET_MAP_URL);

window.addEventListener("message", (event) => {
  if (!mapFrame || event.source !== mapFrame.contentWindow) return;
  if (!isMapMessage(event.data)) return;

  if (event.data.type === "ready") {
    mapReady = true;
    sendJourney();
    return;
  }

  if (caption) {
    caption.textContent = event.data.text;
    caption.parentElement?.classList.toggle("has-caption", event.data.text.length > 0);
  }
});

browser.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[WAYFARER_JOURNEY_KEY]) {
    journey = normalizeJourney(changes[WAYFARER_JOURNEY_KEY].newValue);
    sendJourney();
  }
  if (changes[WAYFARER_WIDGET_KEY]) {
    applyWidgetState(normalizeWidgetState(changes[WAYFARER_WIDGET_KEY].newValue).collapsed);
  }
});

toggleButton?.addEventListener("click", () => {
  const collapsed = mapFrame ? !mapFrame.hidden : false;
  applyWidgetState(collapsed);
  void browser.storage.local
    .set({ [WAYFARER_WIDGET_KEY]: { collapsed } })
    .catch(() => {});
});

openButton?.addEventListener("click", () => {
  void browser.tabs.create({ url: openMapUrl(INTERNET_MAP_URL, journey) }).catch(() => {});
});

async function boot() {
  try {
    cursorColor = cursorColorOf(
      await browser.runtime.sendMessage({ type: "GET_PUBLIC_PLAYER_IDENTITY" }),
    );
  } catch {
    cursorColor = null;
  }

  try {
    const response = (await browser.runtime.sendMessage({
      type: "WAYFARER_GET_JOURNEY",
    })) as { journey?: unknown } | undefined;
    journey = normalizeJourney(response?.journey);
    sendJourney();
  } catch {
    journey = emptyJourney();
  }

  try {
    const stored = await browser.storage.local.get(WAYFARER_WIDGET_KEY);
    applyWidgetState(normalizeWidgetState(stored?.[WAYFARER_WIDGET_KEY]).collapsed);
  } catch {
    applyWidgetState(false);
  }
}

void boot();
