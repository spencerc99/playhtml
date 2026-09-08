// ABOUTME: Calls the Worker endpoints used by the WWO installation admin desk.
// ABOUTME: Sends the session-scoped admin token only in the reload request header.

import { WORKER_URL } from "@movement/config";
import {
  parseInstallationControl,
  type InstallationControl,
} from "../../shared/utils/installationControlApi";

async function readControl(response: Response): Promise<InstallationControl> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return parseInstallationControl(await response.json());
}

export async function getCurrentInstallationControl(): Promise<InstallationControl> {
  return readControl(await fetch(`${WORKER_URL}/installation/control`, {
    cache: "no-store",
  }));
}

export async function reloadInstallationScreens(token: string): Promise<InstallationControl> {
  return readControl(await fetch(`${WORKER_URL}/admin/installation/reload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }));
}
