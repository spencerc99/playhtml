// ABOUTME: Selects the extension cursor emotes available inside the party.
// ABOUTME: Defines the party's bare-E shortcut without changing extension behavior.

import { getEmote, type EmoteDef } from "@extension/features/emotes/emotes";

const PARTY_EMOTE_IDS = ["wave", "spin"] as const;

function requireEmote(id: (typeof PARTY_EMOTE_IDS)[number]): EmoteDef {
  const emote = getEmote(id);
  if (!emote) throw new Error(`Missing extension emote: ${id}`);
  return emote;
}

export const PARTY_EMOTES = PARTY_EMOTE_IDS.map(requireEmote);
