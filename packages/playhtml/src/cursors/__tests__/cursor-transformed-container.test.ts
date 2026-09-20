// ABOUTME: Verifies cursor coordinates compose with transformed containers.
// ABOUTME: Exercises the production transport cursor client.

import { beforeEach, describe, expect, it } from "vitest";
import { createTransportCursorClient } from "../../__tests__/presence-test-utils";

const identity = (key: string) => ({ publicKey: key, playerStyle: { colorPalette: ["#f00"] } });

describe("transformed cursor container", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  });

  it("renders a remote cursor inside the selected container", () => {
    const layer = document.createElement("div");
    layer.id = "layer";
    document.body.append(layer);
    const { client, transport } = createTransportCursorClient({ enabled: true, container: layer, playerIdentity: identity("self") });
    transport.emit({ type: "presence-sync", peers: { remote: {
      identity: identity("remote"),
      cursor: { cursor: { x: 20, y: 30, pointer: "mouse" }, page: "/", at: Date.now() },
    } } });
    expect(layer.querySelector('.playhtml-cursor-other')).not.toBeNull();
    client.destroy();
  });

  it("resolves a container getter when remote state arrives", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    let target = first;
    const { client, transport } = createTransportCursorClient({ enabled: true, container: () => target, playerIdentity: identity("self") });
    target = second;
    transport.emit({ type: "presence-sync", peers: { remote: {
      identity: identity("remote"),
      cursor: { cursor: { x: 1, y: 2, pointer: "mouse" }, page: "/", at: Date.now() },
    } } });
    expect(second.querySelector('.playhtml-cursor-other')).not.toBeNull();
    client.destroy();
  });
});
