// ABOUTME: Checks visitor text against the profane-words list with one prebuilt matcher.
// ABOUTME: Escapes each listed word so entries with regex characters match literally.
import profaneWords from "profane-words";

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A listed word only matches when it is not part of a longer word: no word
// character directly before or after it. For alphanumeric entries this is the
// same as wrapping them in \b.
export function buildProfanityMatcher(words: readonly string[]): RegExp {
  const alternatives = words
    .filter((word) => word.length > 0)
    .map(escapeRegExp);
  return new RegExp(`(?<!\\w)(?:${alternatives.join("|")})(?!\\w)`, "i");
}

const ProfanityMatcher = buildProfanityMatcher(profaneWords);

export function containsProfanity(text: string): boolean {
  return ProfanityMatcher.test(text);
}
