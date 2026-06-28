// ABOUTME: Verifies can-duplicate resolves its template by bare id, #id, or selector.
// ABOUTME: Locks in that clone ids derive from the resolved template's own id.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

async function setupDuplicateButton(duplicateAttr: string, templateMarkup: string) {
  document.body.innerHTML = `
    ${templateMarkup}
    <button id="clone-btn" can-duplicate="${duplicateAttr}">clone</button>
  `;
  const button = document.getElementById("clone-btn")!;
  await playhtml.setupPlayElementForTag(button, "can-duplicate");
  return button;
}

describe("can-duplicate element reference resolution", () => {
  beforeEach(async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDER_THROW = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    document.body.innerHTML = "";
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
    await playhtml.init({});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("resolves a bare id and clones it on click", async () => {
    const button = await setupDuplicateButton(
      "bunny-template",
      `<div id="bunny-template">bunny</div>`,
    );

    button.click();
    await new Promise((r) => queueMicrotask(r));

    const clones = document.querySelectorAll("[id^='bunny-template-']");
    expect(clones.length).toBe(1);
  });

  it("resolves an id with a leading #", async () => {
    const button = await setupDuplicateButton(
      "#bunny-template",
      `<div id="bunny-template">bunny</div>`,
    );

    button.click();
    await new Promise((r) => queueMicrotask(r));

    // Clone id is prefixed with the resolved element's own id, not the raw "#..." value.
    const clones = document.querySelectorAll("[id^='bunny-template-']");
    expect(clones.length).toBe(1);
    expect(document.querySelector("[id^='#']")).toBeNull();
  });

  it("resolves a CSS selector to the template element", async () => {
    const button = await setupDuplicateButton(
      ".bunny-template",
      `<div id="bunny-template" class="bunny-template">bunny</div>`,
    );

    button.click();
    await new Promise((r) => queueMicrotask(r));

    const clones = document.querySelectorAll("[id^='bunny-template-']");
    expect(clones.length).toBe(1);
  });

  it("does not push clone data when the template is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const button = await setupDuplicateButton("does-not-exist", "");

    button.click();
    await new Promise((r) => queueMicrotask(r));

    expect(document.querySelectorAll("[id^='does-not-exist-']").length).toBe(0);
    errorSpy.mockRestore();
  });
});
