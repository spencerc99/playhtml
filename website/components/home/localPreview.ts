// ABOUTME: Lets local previews and smoke tests point a page at a local playhtml server and room.
// ABOUTME: Only reads ?playhtmlHost / ?playhtmlRoom / ?playhtmlCursorRoom on localhost.

type CursorRoom = "page" | "domain" | "section";

const isCursorRoom = (value: string | null): value is CursorRoom =>
  value === "page" || value === "domain" || value === "section";

export function getLocalPreviewInitOptions(): {
  host?: string;
  room?: string;
  cursorRoom?: CursorRoom;
} {
  const localHostnames = new Set(["localhost", "127.0.0.1"]);
  if (!localHostnames.has(window.location.hostname)) return {};

  const params = new URLSearchParams(window.location.search);
  const host = params.get("playhtmlHost");
  const room = params.get("playhtmlRoom");
  const cursorRoom = params.get("playhtmlCursorRoom");

  return {
    ...(host ? { host } : {}),
    ...(room ? { room } : {}),
    ...(isCursorRoom(cursorRoom) ? { cursorRoom } : {}),
  };
}
