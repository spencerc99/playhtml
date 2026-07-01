// ABOUTME: Runs stochastic artificial users on the walking-together session page.
// ABOUTME: Exercises cursor prompts, participant names, URL sharing, and remote cursors.

import { createActorActions } from "../src/actions.js";
import { defineScene } from "../src/scene.js";
import { buildSceneUrl, createRunUntil } from "../src/session.js";
import type { ActorPersona } from "../src/personas.js";
import type { Page } from "@playwright/test";
import type { SyncHelpers } from "../src/scene.js";

const URLS = [
  "https://playhtml.fun/docs/",
  "https://playhtml.fun/fridge",
  "https://spencer.place",
  "https://rhizome.org/",
];

async function seedCursorIdentity(page: Page, persona: ActorPersona) {
  await page.addInitScript((identity) => {
    localStorage.setItem("playhtml_player_identity", JSON.stringify(identity));
    localStorage.setItem("username", JSON.stringify(identity.name));
  }, identityForPersona(persona));
}

function identityForPersona(persona: ActorPersona) {
  return {
    publicKey: `codex-walking-${persona.index}`,
    name: persona.name,
    playerStyle: {
      colorPalette: [persona.color],
    },
  };
}

async function enterName(page: Page, persona: ActorPersona, sync: SyncHelpers) {
  const actions = createActorActions(page, persona, sync);
  await actions.typeInto(page.locator(".user-setup input").first(), persona.name);
}

async function shareUrl(page: Page, persona: ActorPersona, sync: SyncHelpers) {
  const actions = createActorActions(page, persona, sync);
  const input = page.locator(".url-chat form input").first();
  const beforeCount = await page.locator(".url-entry").count();
  const baseUrl = persona.random.pick(URLS);
  const separator = baseUrl.includes("?") ? "&" : "?";
  const url = `${baseUrl}${separator}codex=${persona.index}-${persona.random.int(
    1000,
    9999,
  )}`;
  if (!(await actions.typeInto(input, url))) return false;
  await page.locator(".url-chat form button[type='submit']").click();
  const visible = await page
    .waitForFunction(
      (count) => document.querySelectorAll(".url-entry").length > count,
      beforeCount,
      { timeout: 3000 },
    )
    .then(() => true)
    .catch(() => false);
  await actions.idle(300, 900);
  return visible;
}

function promptStepCount(persona: ActorPersona, min: number, max: number) {
  const committedMax = Math.max(min, Math.round(max * persona.prompt.commitment));
  return persona.random.int(min, committedMax);
}

function offsetPoint(
  persona: ActorPersona,
  point: { x: number; y: number },
  amount: number,
) {
  return {
    x: point.x + persona.random.float(-amount, amount),
    y: point.y + persona.random.float(-amount, amount),
  };
}

async function moveForPrompt(
  page: Page,
  persona: ActorPersona,
  prompt: string,
  sync: SyncHelpers,
) {
  const actions = createActorActions(page, persona, sync);
  const viewport = page.viewportSize();
  if (!viewport) return;
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const radius = Math.min(viewport.width, viewport.height) * 0.22;
  const lowerPrompt = prompt.toLowerCase();

  if (!prompt || !persona.random.bool(persona.prompt.attention)) {
    await actions.wander(persona.movementStyle === "observer" ? 1 : 2);
    return;
  }

  if (lowerPrompt.includes("circle")) {
    const steps = promptStepCount(persona, 2, 7);
    const personalRadius = radius * persona.random.float(0.55, 1.35);
    const phase = persona.random.float(0, Math.PI * 2);
    const direction = persona.random.bool(0.5) ? 1 : -1;
    for (let i = 0; i < steps; i++) {
      const angle = phase + direction * ((Math.PI * 2 * i) / steps);
      const target = offsetPoint(
        persona,
        {
          x: center.x + Math.cos(angle) * personalRadius,
          y: center.y + Math.sin(angle) * personalRadius,
        },
        35,
      );
      await actions.moveTo(
        target.x,
        target.y,
        persona.random.float(480, 1250),
      );
      if (persona.random.bool(1 - persona.prompt.commitment)) break;
    }
    return;
  }

  if (lowerPrompt.includes("tag")) {
    for (let i = 0; i < 4; i++) {
      await actions.moveTo(
        persona.random.float(120, viewport.width - 120),
        persona.random.float(120, viewport.height - 120),
        420,
      );
    }
    return;
  }

  if (lowerPrompt.includes("stack")) {
    const spread = persona.movementStyle === "social" ? 25 : 90;
    const target = offsetPoint(persona, center, spread);
    await actions.moveTo(
      target.x,
      target.y,
      persona.random.float(650, 1500),
    );
    await actions.idle(800, 1600);
    return;
  }

  if (lowerPrompt.includes("zigzag")) {
    const steps = promptStepCount(persona, 2, 6);
    const top = persona.random.float(130, 260);
    const bottom = persona.random.float(viewport.height - 260, viewport.height - 130);
    const startX = persona.random.float(110, 220);
    const endX = persona.random.float(viewport.width - 220, viewport.width - 110);
    for (let i = 0; i < steps; i++) {
      const progress = steps === 1 ? 1 : i / (steps - 1);
      const target = offsetPoint(
        persona,
        {
          x: startX + progress * (endX - startX),
          y: i % 2 === 0 ? top : bottom,
        },
        45,
      );
      await actions.moveTo(target.x, target.y, persona.random.float(420, 900));
    }
    return;
  }

  if (lowerPrompt.includes("corner")) {
    const corners = [
      { x: 110, y: 110 },
      { x: viewport.width - 110, y: 110 },
      { x: 110, y: viewport.height - 110 },
      { x: viewport.width - 110, y: viewport.height - 110 },
    ];
    const corner = persona.random.pick(corners);
    const target = offsetPoint(persona, corner, 70);
    await actions.moveTo(target.x, target.y, persona.random.float(700, 1600));
    await actions.idle(900, 1800);
    return;
  }

  if (lowerPrompt.includes("rain")) {
    const x = persona.random.float(140, viewport.width - 140);
    await actions.moveTo(x, persona.random.float(60, 160), 400);
    await actions.moveTo(
      x + persona.random.float(-90, 90),
      viewport.height - persona.random.float(70, 180),
      persona.random.float(900, 1800),
    );
    return;
  }

  await actions.wander(persona.movementStyle === "observer" ? 1 : 3);
}

export default defineScene({
  actors: 4,
  extension: false,
  url: "about:blank",
  camera: false,
  viewport: { width: 1280, height: 800 },
  durationMs: 120_000,

  async run({ pages, personas, options, sync }) {
    const testRoom = `codex-artificial-users-${options.seed}`;
    const path =
      `/events/walking-together/session.html?session=2026-06-06-byod&testRoom=${encodeURIComponent(
        testRoom,
      )}`;
    const url = buildSceneUrl(options.baseUrl, path);

    console.log(`Walking Together artificial-user room: ${testRoom}`);
    console.log(`Open in your browser: ${options.hostUrl ?? url}`);

    await Promise.all(pages.map((page, index) => seedCursorIdentity(page, personas[index])));
    await Promise.all(pages.map((page) => page.goto(url, { waitUntil: "domcontentloaded" })));
    await Promise.all(
      pages.map((page) =>
        page.locator(".user-setup input").waitFor({ timeout: 20_000 }),
      ),
    );
    await Promise.all(
      pages.map((page, index) => enterName(page, personas[index], sync)),
    );

    let sharedUrls = 0;
    if (await shareUrl(pages[0], personas[0], sync)) sharedUrls++;
    const runUntil = createRunUntil(options.durationMs);

    await Promise.all(
      pages.map(async (page, index) => {
        const persona = personas[index];
        const actions = createActorActions(page, persona, sync);

        await sync.wait(persona.rhythm.startDelayMs);
        while (runUntil.active()) {
          await actions.pauseBeforeAction();
          const instruction =
            (await page.locator(".group-activity .instruction").innerText().catch(() => "")) ||
            "";
          const promptWeight = persona.random.bool(persona.prompt.attention) ? 4 : 1;
          const action = persona.random.weighted([
            { weight: promptWeight, value: "move" },
            { weight: persona.curiosity, value: "share" },
            { weight: 0.5 + persona.patience, value: "idle" },
          ]);

          if (action === "share") {
            if (await shareUrl(page, persona, sync)) sharedUrls++;
          } else if (action === "move") {
            await moveForPrompt(page, persona, instruction, sync);
          } else {
            await actions.idle(900, 2400);
          }

          console.log(
            `[walking] ${persona.name} ${action} prompt="${instruction}" remaining=${Math.round(
              runUntil.remainingMs() / 1000,
            )}s`,
          );
          await actions.betweenActions();
        }
      }),
    );

    await sync.wait(1500);
    await pages[0]
      .waitForFunction(
        () => document.querySelectorAll(".url-entry").length > 0,
        undefined,
        { timeout: 5000 },
      )
      .catch(() => {});
    const urlEntries = await pages[0].locator(".url-entry").count();
    const remoteCursors = await pages[0].locator(".playhtml-cursor-other").count();

    if (sharedUrls < 1 || urlEntries < 1) {
      throw new Error("walking-together scene did not share a visible URL");
    }
    if (pages.length > 1 && remoteCursors < 1) {
      throw new Error("walking-together scene did not render remote cursors");
    }
  },
});
