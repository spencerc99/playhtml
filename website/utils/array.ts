export function randomizeArray<T>(array: T[]): T[] {
  return array.sort(() => Math.random() - 0.5);
}
