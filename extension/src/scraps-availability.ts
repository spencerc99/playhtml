// ABOUTME: Resolves whether the internet-scraps surfaces are reachable for this user.
// ABOUTME: True when the SCRAPS flag ships or the developer has internal features enabled.

import browser from "webextension-polyfill";
import { FLAGS } from "./flags";

export async function scrapsAvailable(): Promise<boolean> {
  if (FLAGS.SCRAPS) return true;
  try {
    const stored = await browser.storage.local.get(
      "internalDevFeaturesEnabled",
    );
    return Boolean(stored.internalDevFeaturesEnabled);
  } catch {
    return false;
  }
}
