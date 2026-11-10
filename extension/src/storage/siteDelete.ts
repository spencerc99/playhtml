// ABOUTME: Deletes everything collected on one site: this device's events and stats, and the shared copy on the server.
// ABOUTME: The server request is signed with the participant's identity key so only they can delete their own events.

import {
  signSiteDeleteRequest,
  type SiteDeleteResponse,
} from "../utils/siteDeleteRequest";
import { getConfig } from "./sync";

export interface SiteDeleteIdentity {
  publicKey: string;
  privateKey: JsonWebKey;
}

/** A deleting site's batches stop here so a server bug can't loop forever. */
const MAX_BATCHES = 2000;

/**
 * Deletes this participant's uploaded events from `host` and its subdomains on
 * the server, a batch at a time. Returns how many rows the server removed.
 */
export async function deleteSiteEventsFromServer(
  identity: SiteDeleteIdentity,
  host: string,
): Promise<number> {
  const { workerUrl } = await getConfig();
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    // Sign every batch so a long deletion never sends a stale signature.
    const request = await signSiteDeleteRequest(identity.privateKey, {
      pid: identity.publicKey,
      host,
      signedAt: Date.now(),
    });
    const res = await fetch(`${workerUrl}/events/delete-site`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Server returned ${res.status}: ${detail}`);
    }
    const body = (await res.json()) as SiteDeleteResponse;
    total += body.deleted;
    if (!body.more) return total;
  }
  return total;
}
