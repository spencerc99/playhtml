import { html, repeat } from "playhtml";
import { draggable, closest } from "../drag";

const PILES = ["keep", "maybe", "toss"];

export const piles = draggable({
  defaultData: {
    pile: {
      cat: "keep",
      rock: "maybe",
      sock: "toss",
      fern: "keep",
      kite: "maybe",
    } as Record<string, string>,
  },
  view: ({ data, dragging }) => html`
    <div class="piles">
      ${PILES.map(
        (pile) => html`
          <div class="pile">
            <h3>${pile}</h3>
            ${repeat(
              Object.keys(data.pile).filter((card) => data.pile[card] === pile),
              (card) => card,
              (card) => html`
                <div
                  data-drag=${card}
                  class="card ${card === dragging ? "lifted" : ""}"
                >
                  ${card}
                </div>
              `,
            )}
          </div>
        `,
      )}
    </div>
  `,
  // The card can land in any pile.
  drag: ({ data, key }) =>
    closest(PILES.map((pile) => ({ pile: { ...data.pile, [key]: pile } }))),
});
