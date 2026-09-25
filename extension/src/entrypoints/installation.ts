// ABOUTME: Registers the installation frame and cursor in the isolated content-script world.
// ABOUTME: This script is loaded by ordinary pages only while installation mode is enabled.

import { initInstallationComponents } from "./content/installationComponents";

export default defineUnlistedScript(() => {
  (
    globalThis as typeof globalThis & {
      wwoInstallationContent?: () => () => void;
    }
  ).wwoInstallationContent = initInstallationComponents;
});
