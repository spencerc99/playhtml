// ABOUTME: Entry point for the "journeys" visualization — loads browsing data and
// ABOUTME: boots the p5 swarm sketch, wiring the minimal monochrome HUD controls.

import "./journeys.scss";
import { loadJourneys } from "./data";
import { startSketch, SketchState, StyleName } from "./sketch";

const root = document.getElementById("journeys-root")!;

const STYLES: StyleName[] = ["channels", "currents", "ink"];
function styleFromUrl(): StyleName {
  const raw = new URLSearchParams(window.location.search).get("style");
  return STYLES.includes(raw as StyleName) ? (raw as StyleName) : "currents";
}

const canvasHost = document.createElement("div");
canvasHost.className = "canvas-host";
root.appendChild(canvasHost);

// ── HUD ───────────────────────────────────────────────────────────────────────
root.insertAdjacentHTML(
  "beforeend",
  `
  <header class="hud-title">
    <h1>we were online — <em>journeys</em></h1>
    <p>every page you open is a request crossing the planet. each comet is one
       visit, routed along the real submarine cables it most likely rode, paced
       by the speed of light in glass.</p>
  </header>
  <div class="hud-bar">
    <button id="playToggle" class="btn" aria-label="play / pause">❚❚</button>
    <button id="styleToggle" class="btn" aria-label="cycle style">currents</button>
    <span class="speed">
      <button class="speed-btn" data-speed="0.5">0.5×</button>
      <button class="speed-btn active" data-speed="1">1×</button>
      <button class="speed-btn" data-speed="2">2×</button>
      <button class="speed-btn" data-speed="4">4×</button>
    </span>
    <span class="readout" id="clockReadout">loading…</span>
    <span class="source-pill" id="sourcePill"></span>
  </div>
  <div class="empty" id="emptyState">tracing the cables…</div>
`,
);

const state: SketchState = {
  journeys: [],
  paused: false,
  speed: 1,
  style: styleFromUrl(),
};

const clockReadout = document.getElementById("clockReadout")!;
const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});
let lastClockUpdate = 0;
state.onClock = (dataTs, active, total) => {
  const now = performance.now();
  if (now - lastClockUpdate < 120) return; // throttle DOM writes
  lastClockUpdate = now;
  clockReadout.textContent = `${fmt.format(new Date(dataTs))}  ·  ${active} in flight  ·  ${total} journeys`;
};

// ── Controls ──────────────────────────────────────────────────────────────────
const playToggle = document.getElementById("playToggle")!;
playToggle.addEventListener("click", () => {
  state.paused = !state.paused;
  playToggle.textContent = state.paused ? "▶" : "❚❚";
});

const styleToggle = document.getElementById("styleToggle")!;
styleToggle.textContent = state.style!;
styleToggle.addEventListener("click", () => {
  const next = STYLES[(STYLES.indexOf(state.style!) + 1) % STYLES.length];
  state.style = next;
  styleToggle.textContent = next;
});

document.querySelectorAll<HTMLButtonElement>(".speed-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.speed = parseFloat(btn.dataset.speed!);
    document.querySelectorAll(".speed-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
loadJourneys().then(({ journeys, source }) => {
  state.journeys = journeys;
  document.getElementById("emptyState")?.remove();

  const pill = document.getElementById("sourcePill")!;
  pill.textContent = source === "live" ? "live data" : "synthetic swarm";
  pill.classList.add(source);

  startSketch(canvasHost, state);
});
