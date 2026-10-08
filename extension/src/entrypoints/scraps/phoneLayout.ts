// ABOUTME: Tells the collage studio when it is on a phone: a touch screen too narrow for a side drawer.
// ABOUTME: The studio then docks the scrap drawer under the collage and sizes its grips for fingers.

import { useEffect, useState } from "react";

/**
 * A finger is the main pointer and the screen is narrow enough that a drawer
 * beside the collage would leave it a sliver. A tablet in landscape keeps the
 * desktop layout.
 */
export const PHONE_LAYOUT_QUERY = "(pointer: coarse) and (max-width: 700px)";

function matchesPhone(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(PHONE_LAYOUT_QUERY).matches
  );
}

export function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(matchesPhone);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_LAYOUT_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}
