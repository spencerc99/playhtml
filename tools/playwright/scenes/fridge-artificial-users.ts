// ABOUTME: Runs stochastic artificial users on the collaborative fridge page.
// ABOUTME: Exercises word creation, magnet dragging, panning, and remote cursors.

import { createActorActions } from "../src/actions.js";
import { defineScene } from "../src/scene.js";
import { buildSceneUrl, createRunUntil } from "../src/session.js";
import type { ActorPersona } from "../src/personas.js";
import type { Page } from "@playwright/test";
import type { SyncHelpers } from "../src/scene.js";

const WORDS = [
  "glow",
  "window",
  "soft",
  "morning",
  "signal",
  "garden",
  "orbit",
  "hello",
  "together",
  "after",
  "small",
  "bright",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function seedCursorIdentity(page: Page, persona: ActorPersona) {
  await page.addInitScript((identity) => {
    localStorage.setItem("playhtml_player_identity", JSON.stringify(identity));
    localStorage.setItem("userColor", identity.playerStyle.colorPalette[0]);
  }, identityForPersona(persona));
}

function identityForPersona(persona: ActorPersona) {
  return {
    publicKey: `codex-fridge-${persona.index}`,
    name: persona.name,
    playerStyle: {
      colorPalette: [persona.color],
    },
  };
}

async function addWord(page: Page, persona: ActorPersona, sync: SyncHelpers) {
  const actions = createActorActions(page, persona, sync);
  const input = page.locator(".fridge-toolbox input[placeholder='New word...']").first();
  const word = `${persona.random.pick(WORDS)}-${persona.index}-${persona.random.int(
    1000,
    9999,
  )}`;
  if (!(await actions.typeInto(input, word))) return false;
  await input.press("Enter");
  const addedWord = page.locator(".fridgeWord.custom", { hasText: word }).first();
  const added = await addedWord
    .waitFor({ timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  await actions.idle(300, 900);
  return added;
}

async function dragWord(page: Page, persona: ActorPersona, sync: SyncHelpers) {
  const words = page.locator(".fridgeWordHolder");
  const candidates = await words.evaluateAll((elements) => {
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

    return elements
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          index,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left > 40 &&
            rect.top > 100 &&
            rect.right < viewportWidth - 40 &&
            rect.bottom < viewportHeight - 80,
        };
      })
      .filter((candidate) => candidate.visible);
  });
  if (candidates.length === 0) return false;

  const choice = persona.random.pick(candidates);
  const target = words.nth(choice.index);
  const before = await target.evaluate((element) => {
    return (element as HTMLElement).style.transform;
  });
  const viewport = page.viewportSize();
  if (!viewport) return false;

  const actions = createActorActions(page, persona, sync);
  const dx = persona.random.float(-220, 220);
  const dy = persona.random.float(-160, 160);
  const targetX = clamp(choice.centerX + dx, 80, viewport.width - 80);
  const targetY = clamp(choice.centerY + dy, 120, viewport.height - 120);
  const moved = await actions.dragLocator(target, {
    x: targetX,
    y: targetY,
  });
  if (!moved) return false;

  await page
    .waitForFunction(
      ({ index, beforeTransform }) => {
        const element = document.querySelectorAll(".fridgeWordHolder")[index] as
          | HTMLElement
          | undefined;
        return !!element && element.style.transform !== beforeTransform;
      },
      { index: choice.index, beforeTransform: before },
      { timeout: 1500 },
    )
    .catch(() => {});
  await actions.idle(250, 800);
  const after = await target.evaluate((element) => {
    return (element as HTMLElement).style.transform;
  });
  return before !== after;
}

async function panFridge(page: Page, persona: ActorPersona, sync: SyncHelpers) {
  const actions = createActorActions(page, persona, sync);
  await actions.wander(1);
  await page.mouse.wheel(
    persona.random.float(-120, 120),
    persona.random.float(-180, 180),
  );
  await actions.idle(250, 900);
}

export default defineScene({
  actors: 4,
  extension: false,
  url: "about:blank",
  camera: false,
  viewport: { width: 1280, height: 800 },
  durationMs: 120_000,

  async run({ pages, personas, options, sync }) {
    const wall = `codex-artificial-users-${options.seed}`;
    const path = `/fridge?wall=${encodeURIComponent(wall)}`;
    const url = buildSceneUrl(options.baseUrl, path);

    console.log(`Fridge artificial-user wall: ${wall}`);
    console.log(`Open in your browser: ${options.hostUrl ?? url}`);

    await Promise.all(pages.map((page, index) => seedCursorIdentity(page, personas[index])));
    await Promise.all(pages.map((page) => page.goto(url, { waitUntil: "domcontentloaded" })));
    await Promise.all(
      pages.map((page) =>
        page.locator(".fridge-toolbox input[placeholder='New word...']").waitFor({
          timeout: 20_000,
        }),
      ),
    );

    const runUntil = createRunUntil(options.durationMs);
    let customWordsAdded = 0;
    let changedDrags = 0;

    await Promise.all(
      pages.map(async (page, index) => {
        const persona = personas[index];
        const actions = createActorActions(page, persona, sync);

        while (runUntil.active()) {
          const action = persona.random.weighted([
            { weight: persona.movementStyle === "observer" ? 1 : 3, value: "drag" },
            { weight: persona.curiosity, value: "add" },
            { weight: 1 + persona.patience, value: "pan" },
            { weight: persona.patience, value: "idle" },
          ]);

          if (action === "add") {
            if (await addWord(page, persona, sync)) customWordsAdded++;
          } else if (action === "drag") {
            if (await dragWord(page, persona, sync)) changedDrags++;
          } else if (action === "pan") {
            await panFridge(page, persona, sync);
          } else {
            await actions.idle(800, 2200);
          }

          console.log(
            `[fridge] ${persona.name} ${action} remaining=${Math.round(
              runUntil.remainingMs() / 1000,
            )}s`,
          );
        }
      }),
    );

    await sync.wait(1500);
    await pages[0]
      .waitForFunction(
        () => document.querySelectorAll(".fridgeWord.custom").length > 0,
        undefined,
        { timeout: 5000 },
      )
      .catch(() => {});
    const visibleCustomWords = await pages[0].locator(".fridgeWord.custom").count();
    const remoteCursors = await pages[0].locator(".playhtml-cursor-other").count();

    if (customWordsAdded < 1 || visibleCustomWords < 1) {
      throw new Error("fridge scene did not add a visible custom word");
    }
    if (changedDrags < 1) {
      throw new Error("fridge scene did not move a draggable word");
    }
    if (pages.length > 1 && remoteCursors < 1) {
      throw new Error("fridge scene did not render remote cursors");
    }
  },
});
