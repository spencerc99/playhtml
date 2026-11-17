// ABOUTME: Signs the extension's shared-event reads (/events/recent) with the stored identity key.
// ABOUTME: The background and extension pages send no Origin on a GET, so the Worker checks this instead.

import { getStoredPlayerIdentity } from "./playerIdentity";
import {
  recentEventsHeaders,
  signRecentEventsRequest,
} from "../utils/recentEventsRequest";

export class MissingIdentityError extends Error {
  constructor() {
    super("No identity yet to sign the request with");
    this.name = "MissingIdentityError";
  }
}

/**
 * Headers proving this browser holds a participant key, signed now. Throws
 * MissingIdentityError when no identity has been stored yet, so the caller
 * does not send a request the Worker would refuse.
 */
export async function signedReadHeaders(): Promise<Record<string, string>> {
  const identity = await getStoredPlayerIdentity();
  if (!identity) throw new MissingIdentityError();
  const signed = await signRecentEventsRequest(identity.privateKey, {
    publicId: identity.public.publicKey,
    signedAt: Date.now(),
  });
  return recentEventsHeaders(signed);
}
