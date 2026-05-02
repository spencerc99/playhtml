// ABOUTME: Ambient type declaration for Vite's `?raw` query-string import,
// ABOUTME: which returns the imported file's source as a string.
declare module "*?raw" {
  const source: string;
  export default source;
}
