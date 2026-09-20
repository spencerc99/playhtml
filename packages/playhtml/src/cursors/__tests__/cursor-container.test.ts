// ABOUTME: Tests cursor container resolution and transport-backed rendering.
// ABOUTME: Covers element, selector, getter, and missing-container behavior.

import { beforeEach, describe, expect, it } from "vitest";
import { resolveCursorContainer } from "../container";
import { createTransportCursorClient } from "../../__tests__/presence-test-utils";

const identity = (key: string) => ({ publicKey: key, playerStyle: { colorPalette: ["#f00"] } });
const remotePeer = { identity: identity("remote"), cursor: { cursor: { x: 10, y: 10, pointer: "mouse" }, page: "/", at: Date.now() } };

describe("resolveCursorContainer", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  it("defaults to body and resolves elements and selectors", () => {
    const layer = document.createElement("div");
    layer.id = "layer";
    document.body.append(layer);
    expect(resolveCursorContainer()).toBe(document.body);
    expect(resolveCursorContainer(layer)).toBe(layer);
    expect(resolveCursorContainer("#layer")).toBe(layer);
    expect(resolveCursorContainer("#missing")).toBeNull();
  });
  it("calls getters each time", () => {
    let calls = 0;
    const getter = () => { calls++; return document.body; };
    resolveCursorContainer(getter);
    resolveCursorContainer(getter);
    expect(calls).toBe(2);
  });
});

describe("cursor client container", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  });
  it.each([
    ["element", (layer: HTMLElement) => layer],
    ["selector", () => "#layer"],
    ["getter", (layer: HTMLElement) => () => layer],
  ])("renders transport peers into an %s container", (_label, option) => {
    const layer = document.createElement("div");
    layer.id = "layer";
    document.body.append(layer);
    const { client, transport } = createTransportCursorClient({ enabled: true, container: option(layer) as any, playerIdentity: identity("self") });
    transport.emit({ type: "presence-sync", peers: { remote: remotePeer } });
    expect(layer.querySelector(".playhtml-cursor-other")).not.toBeNull();
    client.destroy();
  });
});
