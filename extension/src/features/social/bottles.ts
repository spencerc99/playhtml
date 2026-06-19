// ABOUTME: Bottles registered as a social experiment. Wraps the existing BottleManager + BottleOverlay setup.
// ABOUTME: The bottle implementation files stay in features/ + components/; this is just the registry adapter.

import { BottleManager, type BottleRenderRequest } from "../BottleManager";
import type { BottleAnchor } from "../bottle-anchor";
import { BottleOverlay } from "../../components/BottleOverlay";
import { injectShadowReact } from "../../entrypoints/content/inject-ui";
import { MESSAGE_BOTTLE_CSS } from "../../components/MessageBottle";
import type { GlobalFeatureDeps, SocialExperiment } from "./types";

export const bottlesExperiment: SocialExperiment = {
  id: "bottles",
  flag: "BOTTLES",
  init(deps: GlobalFeatureDeps) {
    const cleanups: (() => void)[] = [];

    const manager = new BottleManager(
      deps.playerColor,
      deps.playerPid,
      deps.createPageData,
    );

    const ui = injectShadowReact(
      BottleOverlay as any,
      {
        bottles: [],
        onSeal: () => {},
        onOpened: () => {},
        onClosed: () => {},
        onAnchorLost: () => {},
        portalContainer: null,
      },
      {
        hostId: "we-were-online-bottles",
        hostStyle:
          "position:fixed;inset:0;pointer-events:none;z-index:2147483645;",
        css: MESSAGE_BOTTLE_CSS,
      },
    );

    // Portal the dialog into a sibling shadow-root node so it inherits the
    // shadow's CSS but is NOT inside the React tree that re-renders the overlay.
    const shadowPortal = ui.portal;

    // Bottles whose reply was dropped (rate-limited etc.) — don't mark them
    // seen on close, so the bottle stays for the user to retry after cooldown.
    const dropped = new Set<string>();

    manager.init((req: BottleRenderRequest) => {
      ui.render({
        bottles: req.bottles,
        onSeal: (id: string, text: string, anchor: BottleAnchor) => {
          if (manager.seal(text, { id, anchor })) {
            dropped.delete(id);
          } else {
            dropped.add(id);
          }
        },
        onOpened: (_id: string) => {
          // Don't mark seen on open — would re-render and unmount mid-interaction.
        },
        onClosed: (id: string) => {
          if (dropped.has(id)) {
            dropped.delete(id);
            return; // reply was dropped — keep the bottle visible to retry
          }
          if (!id.startsWith("empty-")) manager.markSeen(id);
        },
        onAnchorLost: (id: string) => {
          manager.notifyAnchorLost(id);
        },
        portalContainer: shadowPortal,
      });
    });

    cleanups.push(() => {
      manager.destroy();
      ui.destroy();
    });

    return () => {
      for (const c of cleanups) c();
    };
  },
};
