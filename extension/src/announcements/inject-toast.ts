// ABOUTME: One-shot toast injector — mounts the highest-priority unseen announcement for the current url.
// ABOUTME: Use from a content script; no-op if everything's been seen or the page doesn't match.

import { injectShadowReact } from "../entrypoints/content/inject-ui";
import { AnnouncementToast } from "./AnnouncementToast";
import { getToastCandidates, setState } from "./announcement-storage";

const TOAST_CSS = `
:host { all: initial; }
.announcement-toast {
  position: fixed;
  bottom: 16px;
  left: 16px;
  width: 320px;
  background: #faf7f2;
  border: 1px solid rgba(90, 78, 65, 0.2);
  border-radius: 6px;
  box-shadow: 2px 4px 14px rgba(0,0,0,0.12);
  padding: 10px 12px;
  font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
  color: #3d3833;
  font-size: 12px;
  z-index: 2147483640;
  cursor: pointer;
  transform: translateY(0);
  opacity: 1;
  transition: transform 200ms ease, opacity 200ms ease;
}
.announcement-toast.is-exiting {
  transform: translateY(8px);
  opacity: 0;
}
.announcement-toast__chrome {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.announcement-toast__title {
  font-size: 13px;
  font-weight: 700;
  color: #3d3833;
  font-family: "Lora", "Atkinson Hyperlegible", serif;
  line-height: 1.25;
}
.announcement-toast__close {
  background: none;
  border: none;
  cursor: pointer;
  color: #b8b0a6;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}
.announcement-toast__close:hover { color: #3d3833; }
.announcement-toast__body {
  margin: 6px 0 8px;
  font-size: 12px;
  line-height: 1.45;
}
.announcement-toast__cta {
  display: inline-block;
  color: #c4724e;
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: rgba(196, 114, 78, 0.4);
  text-underline-offset: 2px;
}
`;

export async function maybeInjectAnnouncementToast(): Promise<(() => void) | null> {
  const url = location.href;
  const candidates = await getToastCandidates(url);
  const next = candidates[0];
  if (!next) return null;

  let ui: { destroy: () => void } | null = null;
  ui = injectShadowReact(
    AnnouncementToast as any,
    {
      announcement: next,
      onShown: (id: string) => {
        void setState(id, "toast-shown");
      },
      onDismiss: () => {
        ui?.destroy();
        ui = null;
      },
      onCtaClick: (_id: string, href: string) => {
        window.open(href, "_blank", "noopener,noreferrer");
      },
    },
    {
      hostId: "wewere-announcement-toast-host",
      hostStyle:
        "position:fixed;bottom:0;left:0;width:0;height:0;pointer-events:auto;z-index:2147483640;",
      css: TOAST_CSS,
    },
  );

  return () => {
    ui?.destroy();
    ui = null;
  };
}
