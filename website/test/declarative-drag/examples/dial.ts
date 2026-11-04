import { html } from "playhtml";
import { draggable, vary } from "../drag";

export const dial = draggable({
  defaultData: { angle: 0 },
  view: ({ data }) => html`
    <div class="dial" style="rotate: ${data.angle}deg">
      <div class="grip" data-drag="grip"></div>
    </div>
    <output>${data.angle}°</output>
  `,
  // Any angle; grab the grip and turn it around the center.
  drag: () =>
    vary((a) => ({ angle: Math.round(a) % 360 }), { min: 0, max: 360 }),
});
