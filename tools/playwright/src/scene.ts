// ABOUTME: Scene definition types and helpers for browser choreography.
// ABOUTME: Provides defineScene() for scripting multi-actor browser demos.

import type { Page, BrowserContext } from "@playwright/test";

export interface SceneConfig {
  // Number of browser actors (default: 2)
  actors?: number;
  // Load the browser extension (default: false)
  extension?: boolean;
  // Path to unpacked extension directory (default: extension/dist/chrome-mv3)
  extensionPath?: string;
  // Starting URL for all actors
  url: string;
  // Viewport size (default: 1280x720)
  viewport?: { width: number; height: number };
  // Add a separate camera actor that only watches and records (default: false)
  camera?: boolean;
  // Which actor to record when camera is not used (0-indexed, default: 0)
  recordActor?: number;
  // Video output directory (default: tools/playwright/videos)
  videoDir?: string;
  // Run the choreography
  run: (ctx: SceneContext) => Promise<void>;
}

export interface SceneContext {
  // All pages, one per actor (does NOT include camera)
  pages: Page[];
  // All browser contexts (does NOT include camera)
  contexts: BrowserContext[];
  // Camera page (if camera: true), for positioning the viewport
  camera?: Page;
  // Timing helpers
  sync: SyncHelpers;
}

export interface SyncHelpers {
  // Wait for a duration in ms
  wait: (ms: number) => Promise<void>;
  // Run actions in parallel across actors
  parallel: (...fns: (() => Promise<void>)[]) => Promise<void>;
  // Smoothly move cursor from current position to target over duration ms
  smoothMove: (page: Page, x: number, y: number, opts?: { steps?: number; duration?: number }) => Promise<void>;
}

export function defineScene(config: SceneConfig): SceneConfig {
  return {
    actors: 2,
    extension: false,
    viewport: { width: 1280, height: 720 },
    recordActor: 0,
    ...config,
  };
}
