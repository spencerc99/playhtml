// ABOUTME: Copyable source for the prize wheel: one shared spin that lands the same for everyone.
// ABOUTME: Shared data holds when the spin started and where it lands; each browser animates locally.
import { indent } from "../indent";
import type { DemoSnippet } from "../types";

const pages = `const PAGES = [
  { label: "Toggle a lamp", href: "/docs/capabilities/#can-toggle" },
  { label: "Drag a hat", href: "/docs/capabilities/#can-move" },
  { label: "See cursors", href: "/docs/data/presence/cursors/" },
  { label: "Summon rain", href: "/docs/data/events/" },
  { label: "Shape data", href: "/docs/data/data-essentials/" },
  { label: "Write React", href: "/docs/using-react/" },
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

// The React version is the same code with types.
const typedPages = pages
  .replace(
    "function wheelAngle(spin, now)",
    "function wheelAngle(spin: Spin | null, now: number)",
  )
  .replace("function labelAngle(i)", "function labelAngle(i: number)")
  .replace("function newSpin()", "function newSpin(): Spin");

const css = `.wheel {
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

export const prizeWheelSnippet: DemoSnippet = {
  html: `<div id="prize-wheel"></div>

<style>
${indent(css)}
</style>

<script type="module">
  import { playhtml, html, nothing } from "https://unpkg.com/playhtml@latest";

${indent(pages)}

  playhtml.register("prize-wheel", {
    defaultData: { spin: null },
    view: ({ data, setData }) => {
      const { spin } = data;
      const spinning = spin && Date.now() - spin.startedAt < SPIN_MS;
      const landed = spin && !spinning ? PAGES[spin.target] : null;
      const angle = wheelAngle(spin, Date.now());

      return html\`
        <div class="pointer"></div>
        <div class="wheel" style="transform: rotate(\${angle}deg)">
          \${PAGES.map(
            (page, i) => html\`
              <span style="--angle: \${labelAngle(i)}deg">\${page.label}</span>
            \`,
          )}
        </div>
        <button
          ?disabled=\${spinning}
          @click=\${() => setData({ spin: newSpin() })}
        >
          \${spinning ? "Spinning…" : "Spin"}
        </button>
        \${landed
          ? html\`<a href=\${landed.href}>\${landed.label} →</a>\`
          : nothing}
      \`;
    },
    // The data only changes when someone spins, so re-render every frame
    // while the wheel turns. Return the cleanup to stop the loop.
    onMount: ({ getData, requestUpdate }) => {
      let frame;
      const tick = () => {
        const { spin } = getData();
        const turning = spin && Date.now() - spin.startedAt < SPIN_MS + 1000;
        if (turning) requestUpdate();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    },
  });

  playhtml.init();
</script>`,
  react: `import { useEffect, useState, type CSSProperties } from "react";
import { withSharedState } from "@playhtml/react";

type Spin = { startedAt: number; target: number };

${typedPages}

export const PrizeWheel = withSharedState(
  { id: "prize-wheel", defaultData: { spin: null as Spin | null } },
  ({ data, setData }) => {
    const { spin } = data;
    const [now, setNow] = useState(Date.now);

    // The data only changes when someone spins, so re-render every frame
    // while the wheel turns.
    useEffect(() => {
      if (!spin) return;
      let frame: number;
      const tick = () => {
        setNow(Date.now());
        if (Date.now() - spin.startedAt < SPIN_MS) {
          frame = requestAnimationFrame(tick);
        }
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }, [spin]);

    const spinning = spin !== null && now - spin.startedAt < SPIN_MS;
    const landed = spin && !spinning ? PAGES[spin.target] : null;

    return (
      <div>
        <div className="pointer" />
        <div
          className="wheel"
          style={{ transform: \`rotate(\${wheelAngle(spin, now)}deg)\` }}
        >
          {PAGES.map((page, i) => (
            <span
              key={page.label}
              style={{ "--angle": \`\${labelAngle(i)}deg\` } as CSSProperties}
            >
              {page.label}
            </span>
          ))}
        </div>
        <button
          disabled={spinning}
          onClick={() => setData({ spin: newSpin() })}
        >
          {spinning ? "Spinning…" : "Spin"}
        </button>
        {landed && <a href={landed.href}>{landed.label} →</a>}
      </div>
    );
  },
);`,
  reactCss: css,
};
