export async function hashElement(
  tag: string,
  element: Element
): Promise<string> {
  const msgUint8 = new TextEncoder().encode(`${tag}-${element.outerHTML}}`);
  const hashBuffer = await crypto.subtle.digest("SHA-1", msgUint8);

  const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(""); // convert bytes to hex string
  return hashHex;
}
