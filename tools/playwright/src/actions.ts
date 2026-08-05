// ABOUTME: Provides human-like Playwright actions for artificial-user scenes.
// ABOUTME: Encapsulates movement, clicking, typing, dragging, and idle rhythms.

import type { Locator, Page } from "@playwright/test";
import type { ActorPersona } from "./personas.js";
import type { SeededRandom } from "./random.js";
import type { SyncHelpers } from "./scene.js";

export interface Point {
  x: number;
  y: number;
}

export interface PointBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ActionDelayRange {
  minMs: number;
  maxMs: number;
}

export interface ActorActions {
  wait(ms: number): Promise<void>;
  idle(minMs?: number, maxMs?: number): Promise<void>;
  pauseBeforeAction(): Promise<void>;
  betweenActions(): Promise<void>;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function chooseActionDelay(
  random: SeededRandom,
  range: ActionDelayRange,
  tempo: number,
): number {
  if (range.maxMs < range.minMs) {
    throw new Error("maxMs must be at least minMs");
  }
  return scaleDuration(random.float(range.minMs, range.maxMs), tempo);
}

export function jitterPoint(
  random: SeededRandom,
  point: Point,
  jitterPx: number,
  bounds?: PointBounds,
): Point {
  const radius = Math.sqrt(random.next()) * Math.max(0, jitterPx);
  const angle = random.float(0, Math.PI * 2);
  const nextPoint = {
    x: point.x + Math.cos(angle) * radius,
    y: point.y + Math.sin(angle) * radius,
  };

  if (!bounds) return nextPoint;
  return {
    x: clamp(nextPoint.x, bounds.minX, bounds.maxX),
    y: clamp(nextPoint.y, bounds.minY, bounds.maxY),
  };
}

export function createActorActions(
  page: Page,
  persona: ActorPersona,
  sync: SyncHelpers,
): ActorActions {
  const scale = (ms: number) => scaleDuration(ms, persona.tempo);
  const viewportBounds = (): PointBounds | undefined => {
    const viewport = page.viewportSize();
    if (!viewport) return undefined;
    return {
      minX: 20,
      maxX: viewport.width - 20,
      minY: 20,
      maxY: viewport.height - 20,
    };
  };

  return {
    wait(ms) {
      return sync.wait(scale(ms));
    },
    async idle(minMs = 350, maxMs = 1400) {
      await sync.wait(scale(persona.random.float(minMs, maxMs)));
    },
    async pauseBeforeAction() {
      await sync.wait(
        chooseActionDelay(
          persona.random,
          {
            minMs: persona.rhythm.thinkMinMs,
            maxMs: persona.rhythm.thinkMaxMs,
          },
          persona.tempo,
        ),
      );
    },
    async betweenActions() {
      await sync.wait(
        chooseActionDelay(
          persona.random,
          {
            minMs: persona.rhythm.betweenMinMs,
            maxMs: persona.rhythm.betweenMaxMs,
          },
          persona.tempo,
        ),
      );
    },
    async wander(steps = 3) {
      const viewport = page.viewportSize();
      if (!viewport) return;
      for (let i = 0; i < steps; i++) {
        const x = persona.random.float(80, Math.max(100, viewport.width - 80));
        const y = persona.random.float(80, Math.max(100, viewport.height - 80));
        await this.moveTo(x, y, persona.random.float(450, 1200));
        await sync.wait(scale(persona.random.float(120, 500)));
      }
    },
    async moveToLocator(locator, options) {
      const box = await locator.boundingBox();
      if (!box) return false;
      const x = box.x + box.width * persona.random.float(0.35, 0.65);
      const y = box.y + box.height * persona.random.float(0.35, 0.65);
      await this.moveTo(x, y, options?.durationMs ?? persona.random.float(450, 950));
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
      await this.moveTo(
        box.x + box.width * persona.random.float(0.35, 0.65),
        box.y + box.height * persona.random.float(0.35, 0.65),
        450,
      );
      await page.mouse.down();
      await this.moveTo(target.x, target.y, persona.random.float(650, 1300));
      await page.mouse.up();
      return true;
    },
    async scroll(deltaY) {
      await page.mouse.wheel(0, deltaY);
    },
    async moveTo(x, y, durationMs = 700) {
      const target = jitterPoint(
        persona.random,
        { x, y },
        persona.motion.jitterPx,
        viewportBounds(),
      );
      const duration = scale(
        persona.random.float(durationMs * 0.8, durationMs * 1.25),
      );
      await sync.smoothMove(page, target.x, target.y, { duration });
      if (persona.random.bool(persona.motion.microPauseChance)) {
        await sync.wait(scale(persona.random.float(80, 420)));
      }
    },
  };
}
