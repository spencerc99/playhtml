// Shared utilities for playhtml React examples

/**
 * Format large numbers with k/m/b notation while showing last 3 digits for progression feel
 * @param num The number to format
 * @returns Either a string for small numbers or an object with main digits and suffix
 */
export function formatLargeNumber(num: number) {
  if (num < 1000) return num.toString();

  const lastThreeDigits = num % 1000;
  const paddedLastThree = lastThreeDigits.toString().padStart(3, "0");

  if (num < 1000000) {
    const k = Math.floor(num / 1000);
    return { main: paddedLastThree, suffix: `${k}k` };
  } else if (num < 1000000000) {
    const m = Math.floor(num / 1000000);
    return { main: paddedLastThree, suffix: `${m}m` };
  } else {
    const b = Math.floor(num / 1000000000);
    return { main: paddedLastThree, suffix: `${b}b` };
  }
}

/**
 * Simple number formatting with k/m/b notation (no last digits shown)
 * @param num The number to format
 * @returns Formatted string like "1.2k", "5m", etc.
 */
export function formatSimpleNumber(num: number): string {
  if (num < 1000) return num.toString();
  if (num < 1000000) return `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}k`;
  if (num < 1000000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}m`;
  return `${(num / 1000000000).toFixed(num % 1000000000 === 0 ? 0 : 1)}b`;
}

/**
 * Pluralize a word based on count
 * @param word The word to pluralize
 * @param count The count to check
 * @returns The word with 's' added if count > 1
 */
export function pluralize(word: string, count: number) {
  return count > 1 ? `${word}s` : word;
}