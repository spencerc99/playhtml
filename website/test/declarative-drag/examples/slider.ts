import { html } from "playhtml";
import { draggable, vary } from "../drag";

export const slider = draggable({
  defaultData: { volume: 30 },
  view: ({ data }) => html`
    <div class="slider">
      <div class="track">
        <div class="fill" style="width: ${data.volume}%"></div>
      </div>
      <div class="knob" data-drag="knob" style="left: ${data.volume}%"></div>
      <output>${data.volume}</output>
    </div>
  `,
  // Any whole number from 0 to 100.
  drag: () => vary((v) => ({ volume: Math.round(v) }), { min: 0, max: 100 }),
});
