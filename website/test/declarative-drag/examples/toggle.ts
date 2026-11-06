import { html } from "playhtml";
import { draggable, closest } from "../drag";

export const toggle = draggable({
  defaultData: { on: false },
  view: ({ data }) => html`
    <div class="switch ${data.on ? "on" : ""}">
      <div class="thumb" data-drag="thumb"></div>
    </div>
  `,
  // Two states: off and on.
  drag: () => closest([{ on: false }, { on: true }]),
});
