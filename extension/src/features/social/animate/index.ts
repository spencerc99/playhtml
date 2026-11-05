// ABOUTME: Animate: double-tap "a", pick something on the page, and a model suggests 2-3 shared behaviors for it.
// ABOUTME: Nothing happens until the person picks one; picks are stored per page in WWO's own room.

import type { GlobalFeatureDeps, SocialExperiment } from "../types";
import { Animator, ANIMATE_CSS, hashKey, type AnimationRecord } from "./apply";
import { cropElement, describeElement, findByRef, refFor } from "./element";
import { buildMessages, parseSuggestions } from "./prompt";
import { AnimateUi } from "./ui";
import { OFFER_BY_ID } from "./offers";
import { DEFAULT_MODEL_SETTINGS, MODEL_SETTINGS_KEY } from "./model";

type Records = Record<string, AnimationRecord>;

const DOUBLE_TAP_MS = 350;

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return (
    !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
  );
}

async function editModel() {
  const stored =
    (await browser.storage.local.get(MODEL_SETTINGS_KEY))[MODEL_SETTINGS_KEY] ||
    {};
  const current = { ...DEFAULT_MODEL_SETTINGS, ...stored };
  const endpoint = window.prompt(
    "Model address (OpenAI-compatible chat endpoint)",
    current.endpoint,
  );
  if (!endpoint) return;
  const model = window.prompt("Model name", current.model) || current.model;
  await browser.storage.local.set({
    [MODEL_SETTINGS_KEY]: { ...current, endpoint, model },
  });
}

export const animateExperiment: SocialExperiment = {
  id: "animate",
  flag: "ANIMATE",
  init(deps: GlobalFeatureDeps) {
    if (!deps.setupPlayElement) return () => {};
    const style = document.createElement("style");
    style.setAttribute("data-wwo-animate-ui", "style");
    style.textContent = ANIMATE_CSS;
    document.head.appendChild(style);

    const channel = deps.createPageData<Records>(
      `animate:${location.pathname}`,
      {},
    );
    const animator = new Animator(
      deps.setupPlayElement,
      deps.removePlayElement,
    );
    const ui = new AnimateUi(deps.playerColor);

    const reconcile = (records: Records) => {
      for (const key of animator.keys()) if (!records[key]) animator.undo(key);
      for (const rec of Object.values(records)) {
        if (animator.has(rec.key)) continue;
        const el = findByRef(rec.ref);
        if (el) animator.apply(el, rec);
      }
    };
    const offUpdate = channel.onUpdate(reconcile);
    // Late-loading pages: try again as images and lazy content arrive.
    const retries = [0, 1500, 4000, 9000].map((ms) =>
      window.setTimeout(() => reconcile(channel.getData() || {}), ms),
    );

    const openFor = async (el: HTMLElement) => {
      const existing = animator.isApplied(el);
      if (existing) {
        ui.showExisting(el, existing, existing.by === deps.playerPid, {
          onPick: () => {},
          onUndo: () => {
            channel.setData((draft) => {
              delete draft[existing.key];
            });
            animator.undo(existing.key);
            ui.closeCard();
          },
          onClose: () => ui.closeCard(),
        });
        return;
      }

      ui.showLoading(el);
      const description = describeElement(el);
      let image: string | undefined;
      try {
        ui.setHidden(true);
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const shot = await browser.runtime.sendMessage({
          type: "CAPTURE_PAGE_PORTRAIT",
        });
        ui.setHidden(false);
        if (shot?.dataUrl) image = await cropElement(el, shot.dataUrl);
      } catch {
        ui.setHidden(false);
      }

      const res = await browser.runtime
        .sendMessage({
          type: "ANIMATE_SUGGEST",
          messages: buildMessages(description, image),
        })
        .catch((err: Error) => ({ error: err.message }));
      const parsed = res?.raw
        ? parseSuggestions(res.raw)
        : { result: null, problems: [] };
      const modelLabel = res?.model
        ? `${res.model}${res.local ? " · on this computer" : ""}`
        : "set up a model";
      const error =
        res?.error ??
        (parsed.result
          ? undefined
          : "The model's answer didn't make sense, so here's the whole menu.");

      const ref = refFor(el);
      const key = hashKey(
        `${location.pathname}|${ref.selector}|${ref.fingerprint}`,
      );
      ui.showSuggestions(
        el,
        {
          thing: parsed.result?.thing ?? "this",
          suggestions: parsed.result?.suggestions ?? [],
          modelLabel,
          error,
        },
        {
          onPick: (offer, _line, source) => {
            const rec: AnimationRecord = {
              key,
              ref,
              offer,
              thing:
                parsed.result?.thing ??
                OFFER_BY_ID.get(offer)!.fits.split(",")[0],
              by: deps.playerPid,
              color: deps.playerColor,
              at: Date.now(),
              source:
                source === "model" ? (res?.model ?? "model") : "picked by hand",
            };
            channel.setData((draft) => {
              draft[key] = rec;
            });
            animator.apply(el, rec);
            ui.closeCard();
          },
          onClose: () => ui.closeCard(),
          onEditModel: () => void editModel(),
        },
      );
    };

    let lastA = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "a" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e))
        return;
      const now = Date.now();
      if (now - lastA < DOUBLE_TAP_MS) {
        lastA = 0;
        if (ui.isPicking) ui.stopPicking();
        else ui.startPicking((el) => void openFor(el));
      } else lastA = now;
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      retries.forEach((t) => clearTimeout(t));
      offUpdate();
      animator.destroy();
      ui.destroy();
      style.remove();
    };
  },
};
