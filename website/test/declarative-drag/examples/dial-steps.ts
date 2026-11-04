import { html } from "playhtml";
import { draggable, closest } from "../drag";

const STEPS = ["off", "low", "medium", "high"];

export const dialSteps = draggable({
  defaultData: { step: 0 },
  view: ({ data }) => html`
    <div class="dial" style="rotate: ${data.step * 90}deg">
      <div class="grip" data-drag="grip"></div>
    </div>
    <output>${STEPS[data.step]}</output>
  `,
  // Same dial, but it clicks into four positions.
  drag: () =>
    closest(
      STEPS.map((_, step) => ({ step })),
      { float: false },
    ),
});
