// ABOUTME: The small menu of shared behaviors animate can suggest, each mapped onto an existing playhtml capability.
// ABOUTME: Models only ever pick ids from this list; anything else they return is dropped.

export type OfferId =
  | "switch"
  | "flip"
  | "mark"
  | "move"
  | "spin"
  | "grow"
  | "count"
  | "wear";

export interface Offer {
  id: OfferId;
  /** The playhtml capability attribute this offer becomes. */
  capability: "can-toggle" | "can-move" | "can-spin" | "can-grow" | "can-play";
  /** What it does, in the words shown to the model. */
  does: string;
  /** What kind of thing it tends to fit, for the model. */
  fits: string;
  /** Fallback line shown when there is no name for the thing. */
  line: string;
  /** The honest line people see, with {thing} filled in. Fixed so a model can't promise more than the offer does. */
  template: string;
}

export const OFFERS: Offer[] = [
  {
    id: "switch",
    capability: "can-toggle",
    does: "anyone can click it to switch it off or on; it dims when off, for everyone",
    fits: "lamps, lights, screens, signs, windows, anything that can be on or off",
    line: "Anyone can switch it off and on",
    template: "Anyone can switch the {thing} off and on",
  },
  {
    id: "flip",
    capability: "can-toggle",
    does: "anyone can click it to flip it over; it stays flipped for everyone",
    fits: "cards, signs, pictures, objects with a back side",
    line: "Anyone can flip it over",
    template: "Anyone can flip the {thing} over",
  },
  {
    id: "mark",
    capability: "can-toggle",
    does: "anyone can click it to highlight it like a marker pen; it stays highlighted for everyone",
    fits: "sentences, paragraphs, headings, quotes, list items",
    line: "Anyone can highlight it for everyone",
    template: "Anyone can highlight the {thing} for everyone",
  },
  {
    id: "move",
    capability: "can-move",
    does: "anyone can drag it somewhere else on the page; everyone sees where it was left",
    fits: "small pictures, stickers, icons, objects, gifs",
    line: "Anyone can pick it up and move it",
    template: "Anyone can pick up the {thing} and move it",
  },
  {
    id: "spin",
    capability: "can-spin",
    does: "anyone can drag across it to turn it; it stays turned for everyone",
    fits: "wheels, dials, round things, logos, pictures that could hang crooked",
    line: "Anyone can turn it",
    template: "Anyone can turn the {thing}",
  },
  {
    id: "grow",
    capability: "can-grow",
    does: "anyone can click to make it bigger (alt-click for smaller); everyone sees the size",
    fits: "plants, balloons, small pictures, anything that could grow",
    line: "Anyone can make it bigger",
    template: "Anyone can make the {thing} bigger",
  },
  {
    id: "count",
    capability: "can-play",
    does: "it remembers how many times anyone has pressed it and shows the count",
    fits: "buttons, links, bells, things meant to be pressed or clicked",
    line: "It remembers how many times it's been pressed",
    template: "The {thing} remembers how many times it's been pressed",
  },
  {
    id: "wear",
    capability: "can-play",
    does: "it shows wear from use: every touch fades and yellows it a little, for everyone",
    fits: "photos, paper, books, old objects, things people handle often",
    line: "It wears a little every time someone touches it",
    template: "The {thing} wears a little every time someone touches it",
  },
];

export const OFFER_BY_ID = new Map(OFFERS.map((o) => [o.id, o]));

/** What people read on the card: the offer's fixed sentence about this thing. */
export function offerLine(id: OfferId, thing?: string): string {
  const offer = OFFER_BY_ID.get(id)!;
  const t = thing?.trim().replace(/^(a|an|the)\s+/i, "");
  return t ? offer.template.replace("{thing}", t) : offer.line;
}
