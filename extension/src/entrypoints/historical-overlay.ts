// ABOUTME: Registers the browsing portrait overlay in the isolated content-script world.
// ABOUTME: Its sound and visualization code loads only when a participant opens the overlay.

import type { ComponentProps } from "react";
import { HistoricalOverlay } from "../components/HistoricalOverlay";
import { injectShadowReact } from "./content/inject-ui";

export default defineUnlistedScript(() => {
  (
    globalThis as typeof globalThis & {
      wwoHistoricalOverlay?: (
        props: ComponentProps<typeof HistoricalOverlay>,
      ) => ReturnType<typeof injectShadowReact>;
    }
  ).wwoHistoricalOverlay = (props) =>
    injectShadowReact(HistoricalOverlay, props, {
      hostId: "playhtml-historical-overlay-root",
      fontUrl:
        "https://fonts.googleapis.com/css2?family=Martian+Mono:wght@300;400&family=Lora:ital,wght@1,600&display=swap",
    });
});
