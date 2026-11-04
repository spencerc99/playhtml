// ABOUTME: Holds CSS and helper code shared by the Vanilla HTML and React docs-demo recipes.
// ABOUTME: Lives apart from both versions so neither imports the other.

export const doodleStripCss = `main { display: grid; gap: 0.75rem; justify-items: start; }
.pad {
  width: 192px;
  height: 192px;
  border: 1.5px solid #1c1c1c;
  background: white;
  image-rendering: pixelated;
  touch-action: none;
  cursor: crosshair;
}
.strip {
  display: flex;
  gap: 6px;
  max-width: 100%;
  min-height: 64px;
  overflow-x: auto;
}
.strip img {
  width: 64px;
  height: 64px;
  border: 1px solid #1c1c1c;
  background: white;
  image-rendering: pixelated;
}`;

const prizePages = `const PAGES = [
  { label: "Toggle a lamp", href: "https://playhtml.fun/docs/capabilities/#can-toggle" },
  { label: "Drag a hat", href: "https://playhtml.fun/docs/capabilities/#can-move" },
  { label: "See cursors", href: "https://playhtml.fun/docs/advanced/cursors/" },
  { label: "Summon rain", href: "https://playhtml.fun/docs/data/events/" },
  { label: "Shape data", href: "https://playhtml.fun/docs/advanced/data-best-practices/" },
  { label: "Write React", href: "https://playhtml.fun/docs/using-react/" },
];
const SLICE = 360 / PAGES.length;
const SPIN_MS = 3600;

// The wheel's angle at time \`now\`: six turns that ease out and stop
// with the target slice under the pointer.
function wheelAngle(spin, now) {
  if (!spin) return 0;
  const t = Math.min(1, Math.max(0, (now - spin.startedAt) / SPIN_MS));
  const eased = 1 - (1 - t) ** 3;
  return (6 * 360 - (spin.target + 0.5) * SLICE) * eased;
}

// Each label points along the center line of its slice.
function labelAngle(i) {
  return (i + 0.5) * SLICE - 90;
}

function newSpin() {
  const target = Math.floor(Math.random() * PAGES.length);
  return { startedAt: Date.now(), target };
}`;

/** Prize wheel pages and angle math, as plain JavaScript. */
export const prizeWheelHelpers = prizePages;

/** The same helpers with TypeScript annotations for the React version. */
export const prizeWheelTypedHelpers = prizePages
  .replace(
    "function wheelAngle(spin, now)",
    "function wheelAngle(spin: Spin | null, now: number)",
  )
  .replace("function labelAngle(i)", "function labelAngle(i: number)")
  .replace("function newSpin()", "function newSpin(): Spin");

export const prizeWheelCss = `main { display: grid; gap: 0.75rem; justify-items: center; }
.wheel {
  position: relative;
  width: 232px;
  height: 232px;
  border: 2px solid #1c1c1c;
  border-radius: 50%;
  background: repeating-conic-gradient(#f3cf58 0 60deg, #f4efe5 60deg 120deg);
}
/* Each label sits on its slice's center line, reading outward. */
.wheel span {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: rotate(var(--angle)) translate(28px, -50%);
  transform-origin: 0 0;
  font: 600 0.7rem ui-monospace, monospace;
}
/* The pointer at 12 o'clock. */
.pointer {
  width: 0;
  margin: 0 auto -6px;
  border: 10px solid transparent;
  border-top: 16px solid #1c1c1c;
}`;

export const onlineIndicatorCss = `.dots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.dot {
  width: 42px;
  height: 42px;
  border: 1.5px solid #1c1c1c;
  border-radius: 50%;
}
/* Your own dot glows. */
.dot.me {
  box-shadow: 0 0 0 3px white, 0 0 0 5px #1c1c1c,
    0 0 22px 6px rgba(245, 169, 15, 0.7);
}`;

export const rainCss = `.hydrant {
  width: 120px;
  height: 150px;
  border: 0;
  background: url("https://playhtml.fun/docs/fire-hydrant.png") center / contain
    no-repeat;
  cursor: pointer;
}
.rain {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
}
.rain::before {
  content: "";
  position: absolute;
  inset: 0;
  background: url("https://media.giphy.com/media/Wmp1EOzVybWd13s5DB/giphy.gif")
    0 0 / 200px;
  animation: rain 6s ease-in-out forwards;
}
.cloud {
  position: absolute;
  top: 10px;
  width: 150px;
  height: 80px;
  background: url("https://playhtml.fun/docs/rain-cloud.webp") center / contain
    no-repeat;
  animation: cloud 5.5s ease-out both;
}
@keyframes rain {
  0%, 15% { opacity: 0; }
  30%, 85% { opacity: 0.7; }
  100% { opacity: 0; }
}
@keyframes cloud {
  0% { opacity: 0; transform: translateY(-120px); }
  20%, 80% { opacity: 0.9; transform: none; }
  100% { opacity: 0; transform: translateY(-120px); }
}`;

export const makeItRain = `// Fade in rain under a row of five clouds, then clean up.
function makeItRain() {
  const rain = document.createElement("div");
  rain.className = "rain";
  for (let i = 0; i < 5; i++) {
    const cloud = document.createElement("div");
    cloud.className = "cloud";
    cloud.style.left = \`\${i * 20}%\`;
    cloud.style.animationDelay = \`\${i * 150}ms\`;
    rain.append(cloud);
  }
  document.body.append(rain);
  setTimeout(() => rain.remove(), 6000);
}`;

export const liveReactionsCss = `.reactions {
  position: relative;
  width: min(24rem, 100%);
  height: 180px;
  overflow: hidden;
}
.burst {
  position: absolute;
  bottom: 0;
  font-size: 1.65rem;
  pointer-events: none;
  animation: float-up 2.5s ease-out forwards;
}
@keyframes float-up {
  to { opacity: 0; transform: translateY(-140px) scale(0.8); }
}`;

export const yourNameCss = `.me {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 1.25rem;
}
.dot {
  width: 28px;
  height: 28px;
  border: 1.5px solid #1c1c1c;
  border-radius: 50%;
}
label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}`;

export const pageStatusCss = `.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.picker button {
  padding: 0.35rem 0.75rem;
  border: 1.5px solid #1c1c1c;
  border-radius: 999px;
  background: white;
  font: inherit;
  cursor: pointer;
}
/* Your current status is highlighted. */
.picker button[aria-pressed="true"] {
  background: #e8a63a;
}
.people {
  display: grid;
  gap: 0.35rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}
.people li {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 0.6rem;
  border: 1.5px solid #1c1c1c;
  border-radius: 6px;
  background: white;
}
.people .dot {
  width: 14px;
  height: 14px;
  border: 1.5px solid #1c1c1c;
  border-radius: 50%;
}
.people .status {
  margin-left: auto;
  color: #6a6a66;
}`;
export const pageColorCss = `body {
  display: grid;
  grid-template-rows: auto 1fr auto;
  place-items: stretch;
  padding: 0.75rem;
  transition: background 300ms;
}
.corner { display: flex; gap: 0.4rem; }
.corner.top { justify-content: flex-start; }
.corner.bottom { justify-content: flex-end; }
.corner button {
  width: 26px;
  height: 26px;
  border: 1.5px solid #1c1c1c;
  border-radius: 50%;
  background: var(--swatch);
  cursor: pointer;
}
.corner button:hover { box-shadow: 2px 2px 0 #1c1c1c; }
.middle { display: grid; gap: 0.6rem; place-content: center; text-align: center; }
.middle p { margin: 0; max-width: 20rem; line-height: 1.5; }
.readout {
  justify-self: center;
  padding: 0.2rem 0.5rem;
  border: 1px solid #1c1c1c;
  border-radius: 4px;
  background: white;
  font: 0.8rem ui-monospace, monospace;
}`;

/** The swatches both corners offer. */
export const pageColorSwatches = [
  "#f4efe5",
  "#f3cf58",
  "#c9d8bf",
  "#f2c4ce",
  "#bcd4e6",
];

export const critterCursorCss = `.critter-pad {
  display: grid;
  gap: 0.5rem;
  place-items: center;
  width: 100%;
  min-height: 14rem;
  border: 1.5px dashed #65795d;
  border-radius: 8px;
  text-align: center;
}
.critter-pad p { margin: 0; max-width: 22rem; line-height: 1.5; }
/* A custom cursor: an emoji in a ring of the person's color. */
.critter {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 3px solid var(--color);
  border-radius: 50%;
  background: white;
  font-size: 18px;
  transform: translate(-50%, -50%);
}`;

/** Picks the same emoji for a person on every screen, from their pid. */
export const critterHelpers = `const CRITTERS = ["🐝", "🐞", "🦋", "🐌", "🐸", "🦆"];

function critterFor(pid) {
  let hash = 0;
  for (const char of pid) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CRITTERS[hash % CRITTERS.length];
}`;

export const sharedStampSrc = "https://playhtml.fun/playhtml-logo.png";

export const sharedStampCss = `main {
  display: grid;
  gap: 0.75rem;
  justify-items: center;
  text-align: center;
}
.stamp { width: 120px; cursor: grab; }
p { margin: 0; max-width: 18rem; font-size: 0.85rem; line-height: 1.5; }`;
