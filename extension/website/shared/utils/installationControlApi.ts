// ABOUTME: Reads the public installation reload generation from the WWO Worker.
// ABOUTME: Validates the small control payload before unattended screens act on it.

import { WORKER_URL } from "../config";

export type InstallationControl = {
  generation: number;
  updatedAt: string;
};

export function parseInstallationControl(value: unknown): InstallationControl {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid installation control response");
  }
  const { generation, updatedAt } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(generation) || (generation as number) < 0) {
    throw new Error("Invalid installation reload generation");
  }
  if (typeof updatedAt !== "string" || !updatedAt) {
    throw new Error("Invalid installation reload timestamp");
  }
  return { generation: generation as number, updatedAt };
}

export async function getInstallationControl(): Promise<InstallationControl> {
  const response = await fetch(`${WORKER_URL}/installation/control`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Installation control request failed with ${response.status}`);
  }
  return parseInstallationControl(await response.json());
}
