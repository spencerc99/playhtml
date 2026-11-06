import { html, repeat } from "playhtml";
import { draggable, closest } from "../drag";

// Every place this item could go in the list is a state.
const moveTo = (list: string[], item: string, index: number) => {
  const rest = list.filter((x) => x !== item);
  rest.splice(index, 0, item);
  return rest;
};

export const sortable = draggable({
  defaultData: { order: ["morning", "noon", "dusk", "midnight", "dawn"] },
  view: ({ data, dragging }) => html`
    <ol class="sortable">
      ${repeat(
        data.order,
        (id) => id,
        (id) => html`
          <li data-drag=${id} class=${id === dragging ? "lifted" : ""}>
            ${id}
          </li>
        `,
      )}
    </ol>
  `,
  drag: ({ data, key }) =>
    closest(data.order.map((_, i) => ({ order: moveTo(data.order, key, i) }))),
});
