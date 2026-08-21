// ABOUTME: Exercises version 2 against browser pages seeded from production rooms.
// ABOUTME: Covers hydration, generic capability sync, persistence, and browser errors.
// NOTE: runs assume freshly seeded rooms (partykit/scripts/seed-prod-rooms.ts
// plus a party-server restart); repeated unseeded runs accumulate drag drift.

import { expect, test, type Page } from "@playwright/test";
import { waitForV2Ready } from "./fixtures";
import prodRooms from "./prod-rooms.json";

const partyHost = process.env.PLAYHTML_E2E_PARTY ?? "localhost:2000";

type PageErrors = {
  pageErrors: string[];
  consoleErrors: string[];
};

type MoveCandidate = {
  wrapperId: string;
  targetIndex: number;
};

type Interaction =
  | { kind: "toggle"; index: number; value: string }
  | { kind: "move"; wrapperId: string; value: string };

function attachErrorCollectors(page: Page): PageErrors {
  const errors: PageErrors = { pageErrors: [], consoleErrors: [] };
  page.on("pageerror", (error) => {
    errors.pageErrors.push(`${error.name}: ${error.message}`);
  });
  page.on("console", (message) => {
    // React dev-mode warnings (e.g. validateDOMNesting on pre-existing page
    // markup) log via console.error with component stacks that mention
    // playhtml paths; they are page lint, not sync failures.
    if (
      message.type() === "error" &&
      /playhtml/i.test(message.text()) &&
      !message.text().startsWith("Warning:")
    ) {
      errors.consoleErrors.push(message.text());
    }
  });
  return errors;
}

async function waitForPageReady(page: Page): Promise<void> {
  await waitForV2Ready(page);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { playhtml?: { isLoading: boolean } }).playhtml
          ?.isLoading,
    ),
  ).toBe(false);
  await expect
    .poll(() => page.locator(".__playhtml-element").count())
    .toBeGreaterThan(0);
}

async function findVisibleToggle(page: Page): Promise<number> {
  return page.locator("[can-toggle]").evaluateAll((elements) => {
    return elements.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    });
  });
}

// Class ORDER is not semantic and shifts across hydration paths (e.g.
// __playhtml-element lands in a different position after a reload), so
// toggle-state comparisons use a sorted, normalized form.
async function getToggleClass(page: Page, index: number): Promise<string> {
  return page
    .locator("[can-toggle]")
    .nth(index)
    .getAttribute("class")
    .then((className) =>
      (className ?? "").split(/\s+/).filter(Boolean).sort().join(" "),
    );
}

async function findVisibleMove(page: Page): Promise<MoveCandidate | null> {
  return page.locator("[can-move]").evaluateAll((elements) => {
    // A can-duplicate source spawns a copy when dragged instead of moving,
    // so it can never satisfy a move assertion. Indices must stay aligned
    // with the unfiltered locator list, so skip rather than filter.
    const isDuplicateSource = (element: Element): boolean =>
      element.hasAttribute("can-duplicate") ||
      element.closest("[can-duplicate]") !== null;
    const isVisibleInViewport = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= window.innerHeight ||
        rect.left >= window.innerWidth
      ) {
        return false;
      }
      // In-viewport is not enough: fixed overlays (e.g. the fridge toolbox)
      // can cover an element, swallowing the drag's pointer events. The
      // element must actually receive a hit at its center.
      // Keep clear of viewport edges: the drag moves +80/+40 from center,
      // and a start point near the edge clamps or leaves the viewport.
      const margin = 60;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      if (
        cx < margin ||
        cy < margin ||
        cx > window.innerWidth - margin - 90 ||
        cy > window.innerHeight - margin - 50
      ) {
        return false;
      }
      const hit = document.elementFromPoint(cx, cy);
      return (
        hit !== null && (element.contains(hit) || hit.contains(element))
      );
    };

    for (
      let wrapperIndex = 0;
      wrapperIndex < elements.length;
      wrapperIndex += 1
    ) {
      const wrapper = elements[wrapperIndex];
      if (isDuplicateSource(wrapper)) continue;
      const descendants = Array.from(wrapper.querySelectorAll("*"));
      const targetIndex = descendants.findIndex(isVisibleInViewport);
      if (targetIndex >= 0) return { wrapperId: wrapper.id, targetIndex };
      if (descendants.length === 0 && isVisibleInViewport(wrapper)) {
        return { wrapperId: wrapper.id, targetIndex: -1 };
      }
    }
    return null;
  });
}

async function panTowardMoveElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    const wrapper = document.querySelector("[can-move]");
    if (!wrapper) return;

    const descendants = Array.from(wrapper.querySelectorAll("*"));
    const target =
      descendants.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) ?? wrapper;
    const rect = target.getBoundingClientRect();
    const deltaX = rect.x - window.innerWidth / 2;
    const deltaY = rect.y - window.innerHeight / 2;

    for (let step = 0; step < 10; step += 1) {
      document.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: deltaX / 10,
          deltaY: deltaY / 10,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
  await page.waitForTimeout(300);
}

function getMoveTarget(page: Page, candidate: MoveCandidate) {
  const wrapper = page.locator(`[can-move][id="${candidate.wrapperId}"]`);
  return candidate.targetIndex >= 0
    ? wrapper.locator("*").nth(candidate.targetIndex)
    : wrapper;
}

// Elements are re-queried by id: index-based lookups break when the
// [can-move] list reorders (e.g. can-duplicate pages appending copies).
async function getMoveTransform(page: Page, wrapperId: string): Promise<string> {
  return page
    .locator(`[can-move][id="${wrapperId}"]`)
    .evaluate((element) => (element as HTMLElement).style.transform);
}

async function getSharedElementState(page: Page): Promise<unknown> {
  return page.locator(".__playhtml-element").evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.id,
      innerHTML: element.innerHTML,
      textContent: element.textContent,
      transform: (element as HTMLElement).style.transform,
    })),
  );
}

async function interactWithPage(
  pageA: Page,
  pageB: Page,
  skipInteraction?: boolean,
): Promise<Interaction | null> {
  if (skipInteraction) {
    console.log("[C5] Interaction skipped for this room (see prod-rooms.json notes).");
    return null;
  }
  const toggleIndex = await findVisibleToggle(pageA);
  if (toggleIndex >= 0) {
    const toggle = pageA.locator("[can-toggle]").nth(toggleIndex);
    const before = await getToggleClass(pageA, toggleIndex);
    await toggle.click();
    await expect
      .poll(() => getToggleClass(pageA, toggleIndex))
      .not.toBe(before);
    const value = await getToggleClass(pageA, toggleIndex);
    await expect.poll(() => getToggleClass(pageB, toggleIndex)).toBe(value);
    return { kind: "toggle", index: toggleIndex, value };
  }

  let candidate = await findVisibleMove(pageA);
  if (!candidate) {
    await panTowardMoveElement(pageA);
    candidate = await findVisibleMove(pageA);
  }
  if (!candidate) {
    console.log(
      "[C5] No visible interactable can-move element; skipping interaction.",
    );
    return null;
  }

  const target = getMoveTarget(pageA, candidate);
  // Layout can still be settling (image loads shift centered flow layout),
  // and a box measured mid-shift makes the drag grab empty space. Wait for
  // two consecutive identical measurements.
  let box = await target.boundingBox();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await pageA.waitForTimeout(250);
    const next = await target.boundingBox();
    if (
      box &&
      next &&
      Math.abs(next.x - box.x) < 1 &&
      Math.abs(next.y - box.y) < 1
    ) {
      box = next;
      break;
    }
    box = next;
  }
  if (box && (box.width === 0 || box.height === 0)) {
    // Position wrappers can be zero-size (e.g. the fridge's word holders);
    // drag coordinates must come from a sized descendant.
    box = await target.evaluate((node) => {
      const sized = [node, ...node.querySelectorAll("*")].find((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 4 && r.height > 4;
      });
      if (!sized) return null;
      const r = (sized as HTMLElement).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  }
  if (!box) {
    console.log(
      "[C5] The can-move target has no bounding box; skipping interaction.",
    );
    return null;
  }

  const before = await getMoveTransform(pageA, candidate.wrapperId);
  // Element drag handlers can bind a beat after the page reports ready, so a
  // single early drag can slide off an element that never captured the
  // pointer. Retry a few deliberate drags until the transform moves.
  let moved = false;
  for (let attempt = 0; attempt < 4 && !moved; attempt += 1) {
    const startBox = (await target.boundingBox()) ?? box;
    const startX = startBox.x + startBox.width / 2;
    const startY = startBox.y + startBox.height / 2;
    await pageA.mouse.move(startX, startY);
    await pageA.mouse.down();
    await pageA.waitForTimeout(120);
    for (let step = 1; step <= 10; step += 1) {
      await pageA.mouse.move(startX + step * 8, startY + step * 4);
      await pageA.waitForTimeout(30);
    }
    await pageA.mouse.up();
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      if ((await getMoveTransform(pageA, candidate.wrapperId)) !== before) {
        moved = true;
        break;
      }
      await pageA.waitForTimeout(200);
    }
    if (!moved) await pageA.waitForTimeout(700);
  }
  expect(moved).toBe(true);
  const value = await getMoveTransform(pageA, candidate.wrapperId);
  await expect
    .poll(() => getMoveTransform(pageB, candidate!.wrapperId))
    .toBe(value);
  return { kind: "move", wrapperId: candidate.wrapperId, value };
}

function pageUrl(pagePath: string): string {
  const separator = pagePath.includes("?") ? "&" : "?";
  return `${pagePath}${separator}__pv2=${encodeURIComponent(partyHost)}`;
}

for (const room of prodRooms) {
  test(`seeded production room: ${room.prodRoom}`, async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const errorsA = attachErrorCollectors(pageA);
    const errorsB = attachErrorCollectors(pageB);

    try {
      const url = pageUrl(room.pagePath);
      await Promise.all([pageA.goto(url), pageB.goto(url)]);
      await Promise.all([waitForPageReady(pageA), waitForPageReady(pageB)]);

      const interaction = await interactWithPage(pageA, pageB, (room as { skipInteraction?: boolean }).skipInteraction);
      if (interaction?.kind === "toggle") {
        await pageA.reload();
        await waitForPageReady(pageA);
        await expect
          .poll(() => getToggleClass(pageA, interaction.index))
          .toBe(interaction.value);
      } else if (interaction?.kind === "move") {
        await pageA.reload();
        await waitForPageReady(pageA);
        await expect
          .poll(() => getMoveTransform(pageA, interaction.wrapperId))
          .toBe(interaction.value);
      } else {
        const beforeReload = await getSharedElementState(pageA);
        await pageA.reload();
        await waitForPageReady(pageA);
        await expect
          .poll(() => getSharedElementState(pageA))
          .toEqual(beforeReload);
      }
    } finally {
      await Promise.all([contextA.close(), contextB.close()]);
    }

    expect(errorsA.pageErrors).toEqual([]);
    expect(errorsB.pageErrors).toEqual([]);
    expect(errorsA.consoleErrors).toEqual([]);
    expect(errorsB.consoleErrors).toEqual([]);
  });
}
