// ABOUTME: Defines the on-demand React UI available to the all-page content script.
// ABOUTME: Shares the lazy UI contract without pulling its implementation into startup.

import type { MilestoneToastData } from "../../components/MilestoneToast";
import type { InjectedReactUI } from "./inject-react-ui";

export interface ContentPageUI {
  mountHistoricalOverlay(options: {
    currentUrl: string;
    onClose: () => void;
  }): InjectedReactUI;
  mountMilestoneToast(options: {
    milestone: MilestoneToastData;
    onCta: (action: MilestoneToastData["ctaAction"]) => void;
    onDismiss: () => void;
  }): InjectedReactUI;
}

declare global {
  var wwoContentPageUI: ContentPageUI | undefined;
}
