// ABOUTME: Verifies page scans preserve capability membership and document order.
// ABOUTME: Covers custom attributes, composed capabilities, and repeated navigation.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { elementHandlers, playhtml, resetPlayHTML } from "../index";

describe("capability page scans", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("preserves custom capability order and binds every capability on a node", async () => {
    const rendered: string[] = [];
    document.body.innerHTML = `
      <div id="unrelated"></div>
      <div id="first" can-note></div>
      <div id="composed" can-note can-toggle></div>
      <div id="last" can-note></div>
      <svg><g id="svg-node" can-note></g></svg>
    `;
    await playhtml.init({
      cursors: { enabled: false },
      extraCapabilities: {
        "can-note": {
          defaultData: { text: "ready" },
          updateElement: ({ element, data }) => {
            rendered.push(element.id);
            element.textContent = data.text;
          },
        },
      },
    });

    expect(rendered).toEqual(["first", "composed", "last"]);
    expect([...elementHandlers.get("can-note")!.keys()]).toEqual([
      "first",
      "composed",
      "last",
    ]);
    const toggle = elementHandlers.get("can-toggle")!.get("composed")!;
    expect(toggle.element).toBe(document.getElementById("composed"));
    expect(toggle.data).toEqual({ on: false });

    await playhtml.handleNavigation();
    expect(rendered).toEqual(["first", "composed", "last"]);
    expect(elementHandlers.get("can-toggle")!.get("composed")).toBe(toggle);

    const added = document.createElement("div");
    added.id = "added";
    added.setAttribute("can-note", "");
    document.body.prepend(added);
    await playhtml.handleNavigation();
    expect(rendered).toEqual(["first", "composed", "last", "added"]);
    expect(added.textContent).toBe("ready");
  });
});
