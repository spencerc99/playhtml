// ABOUTME: Tests XML escaping and SVG document building for the collage bake.
// ABOUTME: Guards that hostile style values and text cannot break the document.

import { describe, expect, it } from "vitest";
import {
  buttonBodyMarkup,
  escapeXml,
  foreignObjectDataUrl,
  requireXmlFragment,
  styleDeclarations,
  svgDataUrl,
} from "../entrypoints/scraps/svgDocument";

function parse(markup: string): Document {
  return new DOMParser().parseFromString(
    `<fragment xmlns="http://www.w3.org/1999/xhtml">${markup}</fragment>`,
    "application/xml",
  );
}

function isWellFormed(markup: string): boolean {
  return parse(markup).querySelector("parsererror") === null;
}

describe("escapeXml", () => {
  it("escapes every character XML treats as markup", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("escapes the ampersand first so entities are not doubled up", () => {
    expect(escapeXml("a & b < c")).toBe("a &amp; b &lt; c");
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeXml("Add to cart")).toBe("Add to cart");
  });
});

describe("styleDeclarations", () => {
  it("converts camelCase properties to CSS names", () => {
    expect(styleDeclarations({ backgroundColor: "red", fontSize: "12px" })).toBe(
      "background-color:red;font-size:12px",
    );
  });

  it("drops empty values rather than emitting a bare property", () => {
    expect(styleDeclarations({ color: "", borderRadius: "4px" })).toBe(
      "border-radius:4px",
    );
  });

  it("neutralizes a value that would terminate the declaration", () => {
    const declarations = styleDeclarations({
      color: "red;position:fixed;top:0",
    });
    // The smuggled declarations must stay inside the one `color` value rather
    // than becoming declarations of their own.
    expect(declarations.split(";")).toEqual(["color:red position:fixed top:0"]);
  });

  it("neutralizes a CSS comment that would swallow later declarations", () => {
    const declarations = styleDeclarations({
      color: "red/*",
      fontSize: "12px",
    });
    expect(declarations).toContain("font-size:12px");
    expect(declarations).not.toContain("/*");
  });
});

describe("buttonBodyMarkup", () => {
  it("produces well-formed XML for a plain button", () => {
    const markup = buttonBodyMarkup({
      text: "Add to cart",
      styles: { backgroundColor: "#c4724e", borderRadius: "6px" },
    });
    expect(isWellFormed(markup)).toBe(true);
    expect(markup).toContain("Add to cart");
  });

  it("stays well-formed when a style value contains an ampersand", () => {
    const markup = buttonBodyMarkup({
      text: "Buy",
      styles: {
        backgroundImage: "url(https://example.test/a.png?w=1&h=2)",
      },
    });
    expect(isWellFormed(markup)).toBe(true);
    expect(markup).toContain("&amp;h=2");
  });

  it("stays well-formed when a style value contains angle brackets", () => {
    const markup = buttonBodyMarkup({
      text: "Go",
      styles: { fontFamily: `"<script>", sans-serif` },
    });
    expect(isWellFormed(markup)).toBe(true);
    expect(markup).not.toContain("<script>");
  });

  it("stays well-formed when the button text contains markup characters", () => {
    const markup = buttonBodyMarkup({
      text: `Tom & Jerry <b>"now"</b>`,
      styles: {},
    });
    expect(isWellFormed(markup)).toBe(true);
    expect(markup).not.toContain("<b>");
  });

  it("keeps a well-formed inner icon as real markup", () => {
    const markup = buttonBodyMarkup({
      text: "Share",
      styles: {},
      innerSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>',
    });
    expect(isWellFormed(markup)).toBe(true);
    expect(markup).toContain("<rect />");
  });

  it("refuses an inner icon an XML parser cannot read", () => {
    expect(() =>
      buttonBodyMarkup({
        text: "Share",
        styles: {},
        innerSvg: "<svg><rect></svg>",
      }),
    ).toThrow(/icon is not well-formed XML/);
  });
});

describe("requireXmlFragment", () => {
  it("returns markup that parses", () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg"><g /></svg>';
    expect(requireXmlFragment(markup, "The icon")).toBe(markup);
  });

  it("refuses an unclosed tag, naming what failed", () => {
    expect(() => requireXmlFragment("<svg><g></svg>", "The icon")).toThrow(
      /The icon is not well-formed XML/,
    );
  });

  it("refuses an HTML entity XML does not define", () => {
    expect(() =>
      requireXmlFragment("<svg><text>&nbsp;</text></svg>", "The icon"),
    ).toThrow(/not well-formed XML/);
  });
});

describe("data URLs", () => {
  it("builds a foreignObject document as a data URL, not a blob URL", () => {
    // A blob-URL foreignObject taints the canvas in Chromium, which would make
    // the baked PNG unreadable.
    const url = foreignObjectDataUrl({ body: "<span>hi</span>", width: 10, height: 4 });
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const decoded = decodeURIComponent(
      url.slice("data:image/svg+xml;charset=utf-8,".length),
    );
    expect(decoded).toContain('<foreignObject x="0" y="0" width="10" height="4">');
    expect(decoded).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  it("percent-encodes characters that would break a data URL", () => {
    const url = foreignObjectDataUrl({
      body: "<span>a#b&c</span>",
      width: 8,
      height: 8,
    });
    expect(url).not.toContain("#");
    expect(url).toContain("%23");
  });

  it("wraps an svg-icon document without a foreignObject", () => {
    const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url)).not.toContain("foreignObject");
  });
});
