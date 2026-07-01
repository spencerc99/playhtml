// ABOUTME: Provides human-like Playwright actions for artificial-user scenes.
// ABOUTME: Encapsulates movement, clicking, typing, dragging, and idle rhythms.

import type { Locator, Page } from "@playwright/test";
import type { ActorPersona } from "./personas.js";
import type { SyncHelpers } from "./scene.js";

export interface ActorActions {
  wait(ms: number): Promise<void>;
  idle(minMs?: number, maxMs?: number): Promise<void>;
  wander(steps?: number): Promise<void>;
  moveToLocator(locator: Locator, options?: { durationMs?: number }): Promise<boolean>;
  clickVisible(locator: Locator): Promise<boolean>;
  typeInto(locator: Locator, text: string): Promise<boolean>;
  dragLocator(locator: Locator, target: { x: number; y: number }): Promise<boolean>;
  scroll(deltaY: number): Promise<void>;
  moveTo(x: number, y: number, durationMs?: number): Promise<void>;
}

export function scaleDuration(ms: number, tempo: number): number {
  return Math.max(25, Math.round(ms * tempo));
}

export function createActorActions(
  page: Page,
  persona: ActorPersona,
  sync: SyncHelpers,
): ActorActions {
  const scale = (ms: number) => scaleDuration(ms, persona.tempo);

  return {
    wait(ms) {
      return sync.wait(scale(ms));
    },
    async idle(minMs = 350, maxMs = 1400) {
      await sync.wait(scale(persona.random.float(minMs, maxMs)));
    },
    async wander(steps = 3) {
      const viewport = page.viewportSize();
      if (!viewport) return;
      for (let i = 0; i < steps; i++) {
        const x = persona.random.float(80, Math.max(100, viewport.width - 80));
        const y = persona.random.float(80, Math.max(100, viewport.height - 80));
        await sync.smoothMove(page, x, y, {
          duration: scale(persona.random.float(450, 1200)),
        });
        await sync.wait(scale(persona.random.float(120, 500)));
      }
    },
    async moveToLocator(locator, options) {
      const box = await locator.boundingBox();
      if (!box) return false;
      await sync.smoothMove(page, box.x + box.width / 2, box.y + box.height / 2, {
        duration: scale(options?.durationMs ?? persona.random.float(450, 950)),
      });
      return true;
    },
    async clickVisible(locator) {
      if (!(await this.moveToLocator(locator))) return false;
      await sync.wait(scale(120));
      await locator.click();
      return true;
    },
    async typeInto(locator, text) {
      if (!(await this.clickVisible(locator))) return false;
      await locator.fill("");
      await locator.pressSequentially(text, {
        delay: scale(persona.random.float(20, 90)),
      });
      return true;
    },
    async dragLocator(locator, target) {
      const box = await locator.boundingBox();
      if (!box) return false;
      await sync.smoothMove(page, box.x + box.width / 2, box.y + box.height / 2, {
        duration: scale(450),
      });
      await page.mouse.down();
      await sync.smoothMove(page, target.x, target.y, {
        duration: scale(persona.random.float(650, 1300)),
      });
      await page.mouse.up();
      return true;
    },
    async scroll(deltaY) {
      await page.mouse.wheel(0, deltaY);
    },
    async moveTo(x, y, durationMs = 700) {
      await sync.smoothMove(page, x, y, { duration: scale(durationMs) });
    },
  };
}
