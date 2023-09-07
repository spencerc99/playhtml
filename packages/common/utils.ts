export function getIdForElement(ele: HTMLElement): string | undefined {
  return ele.id;
}

export function getElementFromId(id: string): HTMLElement | null {
  return document.getElementById(id);
}
