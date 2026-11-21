import { html } from "playhtml";
import { draggable, closest } from "../drag";

const SIZE = 5;
type Pieces = Record<string, number>; // piece -> square index

export const board = draggable({
  defaultData: { pieces: { red: 6, blue: 18 } as Pieces },
  view: ({ data, dragging }) => html`
    <div class="board">
      ${Array.from({ length: SIZE * SIZE }, (_, square) => {
        const piece = Object.keys(data.pieces).find(
          (p) => data.pieces[p] === square,
        );
        return html`<div class="square">
          ${piece
            ? html`<div
                data-drag=${piece}
                class="piece ${piece} ${piece === dragging ? "lifted" : ""}"
              ></div>`
            : ""}
        </div>`;
      })}
    </div>
  `,
  // A piece can move to any empty square.
  drag: ({ data, key }) => {
    const taken = Object.entries(data.pieces)
      .filter(([p]) => p !== key)
      .map(([, s]) => s);
    const open = Array.from({ length: SIZE * SIZE }, (_, s) => s).filter(
      (s) => !taken.includes(s),
    );
    return closest(open.map((s) => ({ pieces: { ...data.pieces, [key]: s } })));
  },
});
