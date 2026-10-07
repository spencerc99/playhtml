// ABOUTME: Relays hosted Slow Mode page messages through the extension content script.
// ABOUTME: Exposes safe ride metadata and keeps destination navigation in the extension.

import browser from "webextension-polyfill";
import {
  SLOW_MODE_HOSTED_BRIDGE_SOURCE,
  SLOW_MODE_HOSTED_RESPONSE,
  isHostedCommuteUrl,
  isHostedSlowModeOutcome,
  isHostedSlowModeRequest,
  type HostedSlowModeRide,
} from "./slowModeHostedBridge";

export function initHostedSlowModeContentBridge(): () => void {
  if (!isHostedCommuteUrl(window.location.href)) return () => {};

  const receivePageMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (isHostedSlowModeRequest(event.data)) {
      browser.runtime
        .sendMessage({
          type: "GET_SLOW_MODE_HOSTED_RIDE",
          rideId: event.data.rideId,
        })
        .then((ride: HostedSlowModeRide | null) => {
          window.postMessage(
            {
              source: SLOW_MODE_HOSTED_BRIDGE_SOURCE,
              type: SLOW_MODE_HOSTED_RESPONSE,
              requestId: event.data.requestId,
              ride,
            },
            window.location.origin,
          );
        })
        .catch(() => {});
      return;
    }
    if (isHostedSlowModeOutcome(event.data)) {
      void browser.runtime.sendMessage({
        type: "SLOW_MODE_RIDE_OUTCOME",
        rideId: event.data.rideId,
        outcome: event.data.outcome,
        navigate: event.data.navigate,
      });
    }
  };

  window.addEventListener("message", receivePageMessage);
  return () => window.removeEventListener("message", receivePageMessage);
}
