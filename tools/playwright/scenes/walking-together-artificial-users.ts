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
  if (!(await actions.typeInto(input, persona.random.pick(URLS)))) return false;
  await input.press("Enter");
  await actions.idle(300, 900);
  return true;
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

  if (lowerPrompt.includes("circle")) {
    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 * (i + persona.index / 4)) / 5;
      await actions.moveTo(
        center.x + Math.cos(angle) * radius,
        center.y + Math.sin(angle) * radius,
        650,
      );
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
    await actions.moveTo(
      center.x + persona.random.float(-25, 25),
      center.y + persona.random.float(-25, 25),
      900,
    );
    await actions.idle(800, 1600);
    return;
  }

  if (lowerPrompt.includes("zigzag")) {
    for (let i = 0; i < 5; i++) {
      await actions.moveTo(
        160 + i * ((viewport.width - 320) / 4),
        i % 2 === 0 ? 180 : viewport.height - 180,
        520,
      );
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
    const corner = corners[persona.index % corners.length];
    await actions.moveTo(corner.x, corner.y, 900);
    await actions.idle(900, 1800);
    return;
  }

  if (lowerPrompt.includes("rain")) {
    const x = persona.random.float(140, viewport.width - 140);
    await actions.moveTo(x, 80, 400);
    await actions.moveTo(x + persona.random.float(-40, 40), viewport.height - 90, 1400);
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

    const runUntil = createRunUntil(options.durationMs);
    let sharedUrls = 0;

    await Promise.all(
      pages.map(async (page, index) => {
        const persona = personas[index];
        const actions = createActorActions(page, persona, sync);

        while (runUntil.active()) {
          const instruction =
            (await page.locator(".group-activity .instruction").innerText().catch(() => "")) ||
            "";
          const action = persona.random.weighted([
            { weight: 4, value: "move" },
            { weight: persona.curiosity, value: "share" },
            { weight: persona.patience, value: "idle" },
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
        }
      }),
    );

    await sync.wait(1500);
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
