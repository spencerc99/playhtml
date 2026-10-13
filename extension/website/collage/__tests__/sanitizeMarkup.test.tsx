// ABOUTME: Tests that markup in a published collage renders inert in the viewer, whatever was stored.
// ABOUTME: Feeds hostile buttons, headings and icons through the viewer's mapping and the studio's piece material.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PieceMaterial } from "@extension/entrypoints/scraps/PieceMaterial";
import { ScrapContent } from "@movement/components/ScrapCollage";
import {
  PUBLISHED_COLLAGE_FORMAT,
  PUBLISHED_COLLAGE_VERSION,
  parsePublishedCollage,
  type PublishedCollagePiece,
  type PublishedPieceContent,
} from "../../../shared/publishedCollage";
import { viewerPieces } from "../publishedCollageView";
import { sanitizeStyleAttribute, sanitizeSvgMarkup } from "../sanitizeMarkup";

declare global {
  interface Window {
    pwned?: number;
  }
}

/** Every trick in one icon: each must come out of the sanitizer harmless. */
const HOSTILE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="window.pwned=1">',
  "<script>window.pwned=2</script>",
  '<style>circle{fill:url("javascript:window.pwned=3")}</style>',
  '<a href="javascript:window.pwned=4"><circle r="4" onclick="window.pwned=5"/></a>',
  '<image href="https://tracker.example/pixel.png" onerror="window.pwned=6"/>',
  '<use href="https://evil.example/sprite.svg#icon"/>',
  '<use xlink:href="data:image/svg+xml,%3Csvg onload=alert(1)%3E"/>',
  '<foreignObject><iframe src="javascript:window.pwned=7"></iframe><img src="x" onerror="window.pwned=8"></foreignObject>',
  '<animate attributeName="href" to="javascript:window.pwned=9"/>',
  '<set attributeName="onmouseover" to="window.pwned=10"/>',
  '<rect width="5" height="5" style="fill:red;background:url(javascript:window.pwned=11);width:expression(alert(1))" fill="url(https://tracker.example/x)"/>',
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>',
  '<path id="p" d="M0 0h5v5z" fill="url(#g)"/>',
  '<use href="#p"/>',
  "</svg>",
].join("");

const SAFE_STYLES = { color: "rgb(255, 0, 0)" };

function piece(
  content: PublishedPieceContent,
  overrides: Partial<PublishedCollagePiece> = {},
): PublishedCollagePiece {
  return {
    x: 10,
    y: 10,
    width: 120,
    height: 40,
    rotation: 0,
    z: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
    content,
    source: {
      kind: content.kind,
      pageUrl: "https://example.com/",
      pageTitle: "Example",
      domain: "example.com",
      ts: 1_760_000_000_000,
    },
    ...overrides,
  };
}

/** What a forged upload could store, before the Worker's own checks. */
function hostileCollage() {
  return {
    format: PUBLISHED_COLLAGE_FORMAT,
    version: PUBLISHED_COLLAGE_VERSION,
    title: '<img src=x onerror="window.pwned=12">',
    frame: { width: 600, height: 400 },
    paper: { color: "#fffdf9", grain: false },
    pieces: [
      piece({
        kind: "button",
        text: "<script>window.pwned=13</script>Subscribe",
        styles: SAFE_STYLES,
        innerSvg: HOSTILE_SVG,
        backdropColor: "rgb(255, 255, 255)",
      }),
      piece(
        {
          kind: "heading",
          text: '<img src=x onerror="window.pwned=14">hello',
          level: 1,
          styles: SAFE_STYLES,
        },
        { z: 1 },
      ),
      piece(
        { kind: "svg-icon", markup: HOSTILE_SVG, width: 24, height: 24 },
        { z: 2, width: 40, height: 40 },
      ),
    ],
  };
}

/** Whatever is left in the DOM must neither run, link out, nor load from elsewhere. */
function expectInert(root: HTMLElement) {
  expect(
    root.querySelector(
      "script, style, iframe, object, embed, form, input, foreignObject, image, img, a, animate, set",
    ),
  ).toBeNull();
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      expect(name.startsWith("on"), `${name} on <${element.localName}>`).toBe(
        false,
      );
      expect(value).not.toMatch(/javascript\s*:/i);
      expect(value).not.toMatch(/expression\s*\(/i);
      expect(value).not.toMatch(/url\(\s*['"]?(?!#)/i);
      if (name === "href" || name === "xlink:href") {
        expect(value.startsWith("#"), `${name}=${value}`).toBe(true);
      }
    }
  }
  expect(window.pwned).toBeUndefined();
}

describe("sanitizeSvgMarkup", () => {
  it("strips scripts, handlers, links, embeds, animation and outside references", () => {
    const host = document.createElement("div");
    host.innerHTML = sanitizeSvgMarkup(HOSTILE_SVG);
    expectInert(host);
    // What an icon legitimately uses survives.
    expect(host.querySelector("svg")).not.toBeNull();
    expect(host.querySelector("linearGradient, lineargradient")).not.toBeNull();
    expect(host.querySelector("path")?.getAttribute("fill")).toBe("url(#g)");
    const uses = [...host.querySelectorAll("use")];
    expect(uses.map((use) => use.getAttribute("href"))).toContain("#p");
    // Both outside references lost their target, leaving empty `<use>`s.
    expect(
      uses.filter(
        (use) => !use.hasAttribute("href") && !use.hasAttribute("xlink:href"),
      ),
    ).toHaveLength(2);
    expect(host.querySelector("rect")?.getAttribute("style")).toBe("fill:red");
  });

  it("answers nothing for markup that is not an svg", () => {
    expect(sanitizeSvgMarkup('<img src=x onerror="alert(1)">')).toBe("");
    expect(sanitizeSvgMarkup("<script>alert(1)</script>")).toBe("");
  });

  it("drops each unsafe declaration of a style attribute", () => {
    expect(
      sanitizeStyleAttribute(
        "fill: red; background: url(javascript:alert(1)); width: expression(alert(1)); behavior: url(x.htc); stroke: url(#g)",
      ),
    ).toBe("fill: red;stroke: url(#g)");
  });
});

describe("a hostile published collage in the viewer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    delete window.pwned;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.pwned;
  });

  it("is refused by the format when its styles could fetch or script", () => {
    const forged = hostileCollage();
    (forged.pieces[0].content as { styles: Record<string, string> }).styles = {
      backgroundImage: "url(javascript:alert(1))",
    };
    expect(() => parsePublishedCollage(forged)).toThrow(
      /unsafe backgroundImage/,
    );
    const expression = hostileCollage();
    (
      expression.pieces[1].content as { styles: Record<string, string> }
    ).styles = {
      color: "expression(alert(1))",
    };
    expect(() => parsePublishedCollage(expression)).toThrow(/unsafe color/);
  });

  it("renders every piece and its lightbox content inert", async () => {
    const collage = parsePublishedCollage(hostileCollage());
    const shown = viewerPieces(collage, (ref) => `https://w/${ref}`);
    await act(async () =>
      root.render(
        <>
          {shown.map(({ piece: studioPiece, item }) => (
            <React.Fragment key={studioPiece.id}>
              <div className="collage-piece__source">
                <PieceMaterial piece={studioPiece} />
              </div>
              <div>
                <ScrapContent
                  item={item}
                  loaded
                  onLoad={() => {}}
                  onError={() => {}}
                />
              </div>
            </React.Fragment>
          ))}
        </>,
      ),
    );
    expectInert(container);
    // Words are set as text, never parsed as markup.
    expect(container.textContent).toContain(
      "<script>window.pwned=13</script>Subscribe",
    );
    expect(container.textContent).toContain(
      '<img src=x onerror="window.pwned=14">hello',
    );
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });
});
