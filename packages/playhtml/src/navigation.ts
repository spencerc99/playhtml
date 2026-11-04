// ABOUTME: Navigation subsystem — detects URL changes and runs a single
// ABOUTME: handleNavigation routine, collapsing concurrent triggers.

type Handler = () => Promise<void>;

export interface NavigationController {
  trigger(): Promise<void>;
  destroy(): void;
}

export function createNavigationController(
  handler: Handler,
): NavigationController {
  let isRunning = false;
  let queued = false;
  let destroyed = false;

  async function trigger(): Promise<void> {
    if (destroyed) return;
    if (isRunning) {
      queued = true;
      return;
    }
    isRunning = true;
    try {
      await handler();
    } finally {
      isRunning = false;
      if (queued && !destroyed) {
        queued = false;
        await trigger();
      }
    }
  }

  return {
    trigger,
    destroy() {
      destroyed = true;
      queued = false;
    },
  };
}

export function attachNavigationListeners(
  ctrl: NavigationController,
): () => void {
  const onPopState = () => {
    void ctrl.trigger();
  };
  const onCurrentEntryChange = () => {
    void ctrl.trigger();
  };

  window.addEventListener("popstate", onPopState);

  // Read the URL after the navigation commits, including pushState/replaceState.
  const nav = (window as any).navigation;
  if (nav && typeof nav.addEventListener === "function") {
    nav.addEventListener("currententrychange", onCurrentEntryChange);
  }

  return () => {
    window.removeEventListener("popstate", onPopState);
    if (nav && typeof nav.removeEventListener === "function") {
      nav.removeEventListener("currententrychange", onCurrentEntryChange);
    }
  };
}

export function dispatchNavigated(room: string): void {
  document.dispatchEvent(
    new CustomEvent("playhtml:navigated", { detail: { room } }),
  );
}
