// ABOUTME: Initializes playhtml for the manual can-mirror browser test page.
// ABOUTME: Binds restored capability descendants created by page controls.

import { playhtml } from "../../packages/playhtml/src";

document.addEventListener("playhtml:setup-element", (event) => {
  const id = (event as CustomEvent<{ id?: string }>).detail?.id;
  if (!id) return;

  const element = document.getElementById(id);
  if (!element) return;

  playhtml.setupPlayElement(element);
});

playhtml.init({ developmentMode: true });
