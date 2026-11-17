// ABOUTME: Sends the participant's request to join experiments, signed with their identity key.
// ABOUTME: The signature proves the request comes from the holder of the public id it names.

import { signAccessRequest } from "../utils/accessRequest";
import { getStoredPlayerIdentity } from "./playerIdentity";
import { getConfig } from "./sync";

export async function submitAccessRequest(options: {
  email: string | null;
  requestedFeatures: string[];
}): Promise<void> {
  const identity = await getStoredPlayerIdentity();
  if (!identity) {
    throw new Error("Access request needs a player identity");
  }
  const request = await signAccessRequest(identity.privateKey, {
    publicId: identity.public.publicKey,
    email: options.email,
    requestedFeatures: options.requestedFeatures,
    signedAt: Date.now(),
  });
  const { workerUrl } = await getConfig();
  const response = await fetch(`${workerUrl}/access-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`Access request failed with ${response.status}`);
  }
}
