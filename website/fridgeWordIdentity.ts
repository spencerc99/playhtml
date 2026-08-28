// ABOUTME: Provides stable shared-state IDs for the fridge's built-in words.
// ABOUTME: Preserves the selector-derived IDs used by existing saved positions.

const FridgeWordSelector = "#fridge .fridgeWordHolder";

export function getDefaultFridgeWordId(index: number): string {
  return btoa(`can-move-${FridgeWordSelector}-${index}`);
}
