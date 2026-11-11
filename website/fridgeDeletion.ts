// ABOUTME: Defines the fridge word-deletion policy for visitors and the fridge owner.
// ABOUTME: Keeps visitor moderation bounded while allowing the fridge owner cleanup access.
export const DeleteWordLimit = 3;

const FridgeOwnerPublicKey =
  "pk_04934976d2bc13f0a3a1e62a9124a3edb1e236b2eef64b618c646e25e3ade8ec77d2b56bedb39b78150d141be1b6b41a85b86010930941e02e82e96ce61af35d53";

export function canDeleteFridgeWord(
  deleteCount: number,
  publicKey: string | undefined,
): boolean {
  return publicKey === FridgeOwnerPublicKey || deleteCount < DeleteWordLimit;
}

interface FridgeWordMatchFields {
  id?: string;
  word: string;
  color?: string;
}

// Removes one word from the shared list, matching by id when the word has one
// and by text and color otherwise. Runs against the live list inside a setData
// mutator, so a word another visitor already removed is left alone.
export function removeFridgeWord(
  words: FridgeWordMatchFields[],
  target: FridgeWordMatchFields,
): boolean {
  const index = words.findIndex((word) =>
    target.id
      ? word.id === target.id
      : word.word === target.word && word.color === target.color,
  );
  if (index === -1) return false;
  words.splice(index, 1);
  return true;
}
