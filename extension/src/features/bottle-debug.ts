// ABOUTME: Shared verbose-logging switch for the bottles feature.
// ABOUTME: Flip VERBOSE on to trace spawn/anchor/render decisions locally.

const VERBOSE = false;

export function bottleDebug(...args: unknown[]): void {
  if (VERBOSE) console.log(...args);
}
