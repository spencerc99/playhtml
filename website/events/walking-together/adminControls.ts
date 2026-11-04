// ABOUTME: Lets the admin hide every admin control with Alt+A, for a clean screen share.
// ABOUTME: Only hides them; admin behavior (like advancing the timer) keeps running.

const STORAGE_KEY = "walking-together-admin-hidden";
const ATTRIBUTE = "data-admin-hidden";

function apply(hidden: boolean) {
  document.documentElement.toggleAttribute(ATTRIBUTE, hidden);
  try {
    localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // Storage can be unavailable; the toggle still works for this visit.
  }
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA")
  );
}

/** Alt+A (Option+A on a Mac) hides or shows everything marked
 * `data-admin-control`. The choice sticks across reloads in this browser. */
export function installAdminControlsToggle() {
  let hidden = false;
  try {
    hidden = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    hidden = false;
  }
  apply(hidden);
  window.addEventListener("keydown", (e) => {
    // `code`, not `key`: Option+A types "å" on a Mac.
    if (!e.altKey || e.code !== "KeyA" || isTyping(e.target)) return;
    e.preventDefault();
    hidden = !hidden;
    apply(hidden);
  });
}
