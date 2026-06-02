// ABOUTME: Shared profanity check using the `profane-words` word list.
// ABOUTME: Matches with word boundaries (case-insensitive) to avoid substring false positives.

import words from "profane-words";

export function containsProfanity(text: string): boolean {
  return words.some((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    return regex.test(text);
  });
}
