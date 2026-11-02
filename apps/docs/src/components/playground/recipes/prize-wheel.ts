// ABOUTME: Defines the prize wheel recipe: one shared spin that lands the same for everyone.
// ABOUTME: Shared data holds when the spin started and where it lands; each browser animates locally.
import { prizeWheelCss, prizeWheelHelpers } from "./demo-shared";
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import { prizeWheelReactSource } from "./react/prize-wheel";
import type { ExampleRecipe } from "./types";

const script = `${prizeWheelHelpers}

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
});`;

export const prizeWheelRecipe: ExampleRecipe = {
  id: "prize-wheel",
  title: "Shared prize wheel",
  description:
    "Run one seeded animation so every reader lands on the same result.",
  tags: ["animation", "requestUpdate", "shared seed"],
  capabilities: ["can-play"],
  difficulty: "advanced",
  docsHref: "/docs/examples/prize-wheel/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: prizeWheelReactSource,
  },
  html: recipeDocument({
    title: "Shared prize wheel",
    styles: `${recipeBaseStyles}
${indent(prizeWheelCss, 4)}`,
    body: `  <main id="prize-wheel"></main>`,
    imports: "playhtml, html, nothing",
    script: indent(script, 4),
  }),
};
