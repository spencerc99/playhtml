// ABOUTME: Defines the built-in <play-*> custom element tags during init.
// ABOUTME: Each tag lazy-loads its implementation the first time one connects.
import type { ElementInitializer } from "@playhtml/common";

export const PREBUILT_TAGS = [
  "play-lamp",
  "play-reaction",
  "play-online-count",
  "play-guestbook",
] as const;

export type PrebuiltTag = (typeof PREBUILT_TAGS)[number];

/** The slice of the playhtml runtime the prebuilt tags need. */
export interface PrebuiltRuntime {
  register(
    element: HTMLElement,
    init: ElementInitializer,
  ): { unregister(): void };
  readonly users: { readonly me: { readonly pid: string } };
}

type PrebuiltModule = typeof import("./elements");

let modulePromise: Promise<PrebuiltModule> | null = null;
function loadPrebuiltModule(): Promise<PrebuiltModule> {
  modulePromise ??= import("./elements");
  return modulePromise;
}

/**
 * Registers every built-in tag with `customElements`, skipping names the page
 * already defined. Safe to call more than once. A no-op where custom elements
 * are unavailable (SSR, extension content scripts).
 */
export function definePrebuiltTags(runtime: PrebuiltRuntime): void {
  if (typeof customElements === "undefined" || !customElements) return;

  for (const tag of PREBUILT_TAGS) {
    if (customElements.get(tag)) continue;

    class PrebuiltElement extends HTMLElement {
      private handle: { unregister(): void } | null = null;

      connectedCallback() {
        loadPrebuiltModule().then(
          (mod) => {
            // Removed (or already bound) while the module was loading.
            if (!this.isConnected || this.handle) return;
            this.handle = mod.mountPrebuiltElement(tag, this, runtime);
          },
          (error) => {
            console.error(`[playhtml] failed to load <${tag}>:`, error);
          },
        );
      }

      disconnectedCallback() {
        // Shared data is kept, so a moved element picks up where it left off.
        this.handle?.unregister();
        this.handle = null;
      }
    }

    customElements.define(tag, PrebuiltElement);
  }
}
