// ABOUTME: Polls the WWO installation control and reloads a screen once per generation.
// ABOUTME: Also checks when a sleeping or disconnected installation screen returns.

import { useEffect } from "react";
import {
  getInstallationControl,
  type InstallationControl,
} from "../utils/installationControlApi";

const STORAGE_KEY = "wwo-installation-reload-generation";
const MINIMUM_POLL_DELAY_MS = 55_000;
const POLL_JITTER_MS = 10_000;
const reloadCurrentPage = () => window.location.reload();

type InstallationReloadOptions = {
  enabled?: boolean;
  getControl?: () => Promise<InstallationControl>;
  reloadPage?: () => void;
  storage?: Storage;
  random?: () => number;
};

function storedGeneration(storage: Storage): number | null {
  const value = storage.getItem(STORAGE_KEY);
  if (value === null) return null;
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
}

export function useInstallationReload({
  enabled = true,
  getControl = getInstallationControl,
  reloadPage = reloadCurrentPage,
  storage = window.sessionStorage,
  random = Math.random,
}: InstallationReloadOptions = {}): void {
  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let checking = false;
    let timer: number | undefined;

    const schedule = () => {
      if (!active) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(
        check,
        MINIMUM_POLL_DELAY_MS + Math.floor(random() * POLL_JITTER_MS),
      );
    };

    async function check() {
      if (!active || checking) return;
      checking = true;
      try {
        const control = await getControl();
        if (!active) return;
        const handled = storedGeneration(storage);
        if (handled === null) {
          storage.setItem(STORAGE_KEY, String(control.generation));
        } else if (control.generation > handled) {
          storage.setItem(STORAGE_KEY, String(control.generation));
          reloadPage();
          return;
        }
      } catch {
        // Installation screens retry transient and malformed responses.
      } finally {
        checking = false;
        schedule();
      }
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const checkWhenOnline = () => void check();

    void check();
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("online", checkWhenOnline);

    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("online", checkWhenOnline);
    };
  }, [enabled, getControl, random, reloadPage, storage]);
}
