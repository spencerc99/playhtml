// ABOUTME: Decides when the extension should create its own PlayHTML presence connection.
// ABOUTME: Keeps broad content-script injection from opening rooms on unsupported sites.

export type ExtensionPresenceDecision = {
  nativePlayhtmlDetected: boolean;
  cursorsEnabled: boolean;
};

export type CopresenceInitializationDecision = {
  featureEnabled: boolean;
  customSiteCursorsEnabled: boolean;
};

export function shouldInitializeCopresence({
  featureEnabled,
  customSiteCursorsEnabled,
}: CopresenceInitializationDecision): boolean {
  return featureEnabled || customSiteCursorsEnabled;
}

export function shouldStartExtensionPresence({
  nativePlayhtmlDetected,
  cursorsEnabled,
}: ExtensionPresenceDecision): boolean {
  return !nativePlayhtmlDetected && cursorsEnabled;
}
