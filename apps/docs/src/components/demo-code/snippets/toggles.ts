// ABOUTME: Copyable sources for the docs' on/off demos: the home lamp and the switches.
// ABOUTME: The can-toggle demos use the built-in capability; the switch uses register/withSharedState.
import { indent } from "../indent";
import type { DemoSnippet } from "../types";

const lampCss = `.lamp {
  width: 200px;
  cursor: pointer;
  transition: filter 0.3s;
}

/* playhtml adds the "toggled" class while the lamp is on */
.lamp.toggled {
  filter: brightness(1.2) saturate(1.6)
    drop-shadow(0 0 50px rgba(247, 220, 156, 0.85));
}`;

export const lampSnippet: DemoSnippet = {
  html: `<img
  id="lamp"
  class="lamp"
  src="https://playhtml.fun/noguchi-hanging-lamp.png"
  alt="Hanging lamp"
  can-toggle
/>

<style>
${indent(lampCss)}
</style>

<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";
  playhtml.init();
</script>`,
  react: `import { CanToggleElement } from "@playhtml/react";

export function Lamp() {
  return (
    <CanToggleElement>
      <img
        id="lamp"
        className="lamp"
        src="https://playhtml.fun/noguchi-hanging-lamp.png"
        alt="Hanging lamp"
      />
    </CanToggleElement>
  );
}`,
  reactCss: lampCss,
};

const toggleSwitchCss = `.switch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: 2px solid #1c1c1c;
  border-radius: 6px;
  background: #ebe4d5;
  font: 700 0.8rem ui-monospace, monospace;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #79766f;
}
.switch.toggled {
  background: #274b9e;
  color: #f4efe5;
}
.switch.toggled .dot {
  background: #e8a63a;
}`;

/** The can-toggle switch on Getting started. */
export const toggleSwitchSnippet: DemoSnippet = {
  html: `<button id="switch" class="switch" can-toggle>
  <span class="dot"></span>
  <span class="off-label">off</span>
  <span class="on-label">on</span>
</button>

<style>
${indent(toggleSwitchCss)}

  /* can-toggle adds the "toggled" class while the switch is on */
  .on-label,
  .switch.toggled .off-label {
    display: none;
  }
  .switch.toggled .on-label {
    display: inline;
  }
</style>

<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";
  playhtml.init();
</script>`,
  react: `import { CanToggleElement } from "@playhtml/react";

// CanToggleElement handles the click. Render from \`data.on\`, and don't add
// your own onClick or the switch flips twice.
export function Switch() {
  return (
    <CanToggleElement>
      {({ data }) => (
        <button id="switch" className="switch">
          <span className="dot" />
          {data.on ? "on" : "off"}
        </button>
      )}
    </CanToggleElement>
  );
}`,
  reactCss: `/* CanToggleElement adds the "toggled" class while the switch is on */
${toggleSwitchCss}`,
};

/** The can-play switch on Custom elements: the same look, built from shared data. */
export const sharedSwitchSnippet: DemoSnippet = {
  html: `<button id="switch" class="switch">
  <span class="dot"></span>
  <span class="label">off</span>
</button>

<style>
${indent(toggleSwitchCss.replaceAll(".toggled", ".on"))}
</style>

<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";

  playhtml.register("switch", {
    defaultData: { on: false },
    onClick: (_event, { setData }) => {
      setData((data) => {
        data.on = !data.on;
      });
    },
    update: ({ element, data }) => {
      element.classList.toggle("on", data.on);
      element.querySelector(".label").textContent = data.on ? "on" : "off";
    },
  });

  playhtml.init();
</script>`,
  react: `import { withSharedState } from "@playhtml/react";

export const Switch = withSharedState(
  { id: "switch", defaultData: { on: false } },
  ({ data, setData }) => (
    <button
      className={data.on ? "switch on" : "switch"}
      onClick={() => {
        setData((draft) => {
          draft.on = !draft.on;
        });
      }}
    >
      <span className="dot" />
      {data.on ? "on" : "off"}
    </button>
  ),
);`,
  reactCss: toggleSwitchCss.replaceAll(".toggled", ".on"),
};
