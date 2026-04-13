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
