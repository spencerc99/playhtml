// ABOUTME: Client contract for administering WWO extension beta access from the admin office.
// ABOUTME: Validates public IDs and sends authenticated requests to the extension Worker.

import { WORKER_URL } from "@movement/config";

export type InternalAccessEntry = {
  publicId: string;
  addedAt: string;
};

const PUBLIC_ID_PATTERN = /^pk_[0-9a-f]{130}$/i;

export function isValidPublicId(publicId: string): boolean {
  return PUBLIC_ID_PATTERN.test(publicId.trim());
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function adminHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export async function listInternalAccess(
  token: string,
): Promise<InternalAccessEntry[]> {
  const response = await fetch(`${WORKER_URL}/admin/internal-access`, {
    headers: adminHeaders(token),
  });
  const result = await readResponse<{ entries: InternalAccessEntry[] }>(
    response,
  );
  return result.entries;
}

export async function addInternalAccess(
  token: string,
  publicId: string,
): Promise<InternalAccessEntry> {
  const normalizedId = publicId.trim().toLowerCase();
  if (!isValidPublicId(normalizedId)) throw new Error("Enter a valid public ID");

  const response = await fetch(`${WORKER_URL}/admin/internal-access`, {
    method: "POST",
    headers: {
      ...adminHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ publicId: normalizedId }),
  });
  return readResponse<InternalAccessEntry>(response);
}

export async function removeInternalAccess(
  token: string,
  publicId: string,
): Promise<void> {
  const response = await fetch(
    `${WORKER_URL}/admin/internal-access/${encodeURIComponent(publicId)}`,
    {
      method: "DELETE",
      headers: adminHeaders(token),
    },
  );
  await readResponse<{ ok: true }>(response);
}
