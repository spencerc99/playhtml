// ABOUTME: The extension's collage signer: reads the maker's cursor colour and name from their stored identity.
// ABOUTME: Kept apart from the studio, which also runs on pages that cannot reach extension storage.

import {
  getPublicPlayerIdentity,
  savePlayerName,
} from "../../storage/playerIdentity";
import { signerIdentity, type CollageSigner } from "./collageSignature";

export const extensionSigner: CollageSigner = {
  load: async () => signerIdentity(await getPublicPlayerIdentity()),
  saveName: async (name) => {
    await savePlayerName(name);
  },
};
