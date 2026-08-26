// ABOUTME: Registers the rare React overlays and toasts used on host pages.
// ABOUTME: Loads on demand so ordinary page collection does not start React.

import { HistoricalOverlay } from "../components/HistoricalOverlay";
import { MilestoneToast } from "../components/MilestoneToast";
import {
  MILESTONE_DURATION_MS,
  MILESTONE_TOAST_CSS,
  MILESTONE_TOAST_FONT_URL,
} from "./content/milestone-toast-styles";
import type { ContentPageUI } from "./content/content-page-ui";
import { injectShadowReact } from "./content/inject-react-ui";

export default defineUnlistedScript(() => {
  const contentPageUI: ContentPageUI = {
    mountHistoricalOverlay({ currentUrl, onClose }) {
      return injectShadowReact(
        HistoricalOverlay,
        {
          visible: true,
          currentUrl,
          onClose,
        },
        {
          hostId: "playhtml-historical-overlay-root",
          fontUrl:
            "https://fonts.googleapis.com/css2?family=Martian+Mono:wght@300;400&family=Lora:ital,wght@1,600&display=swap",
        },
      );
    },
    mountMilestoneToast({ milestone, onCta, onDismiss }) {
      return injectShadowReact(
        MilestoneToast,
        {
          milestone,
          onCta,
          onDismiss,
          autoHideMs: MILESTONE_DURATION_MS,
        },
        {
          hostStyle:
            "position:fixed;bottom:20px;left:20px;z-index:2147483647;",
          css: MILESTONE_TOAST_CSS,
          fontUrl: MILESTONE_TOAST_FONT_URL,
        },
      );
    },
  };

  globalThis.wwoContentPageUI = contentPageUI;
});
