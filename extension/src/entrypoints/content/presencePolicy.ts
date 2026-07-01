// ABOUTME: Decides when the extension should create its own PlayHTML presence connection.
// ABOUTME: Keeps broad content-script injection from opening rooms on unsupported sites.

export type ExtensionPresenceDecision = {
  nativePlayhtmlDetected: boolean;
  cursorsEnabled: boolean;
};

export function shouldStartExtensionPresence({
  nativePlayhtmlDetected,
  cursorsEnabled,
}: ExtensionPresenceDecision): boolean {
  return !nativePlayhtmlDetected && cursorsEnabled;
}
