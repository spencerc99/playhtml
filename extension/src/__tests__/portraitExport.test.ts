// ABOUTME: Verifies DOM portrait capture waits for PNG encoding before starting a download.
// ABOUTME: Covers successful blob creation and the explicit encoding failure path.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureDomPortrait } from "../utils/portraitExport";

const { html2canvasMock, toBlobMock } = vi.hoisted(() => ({
  html2canvasMock: vi.fn(),
  toBlobMock: vi.fn(),
}));

vi.mock("html2canvas", () => ({
  default: html2canvasMock,
}));

describe("captureDomPortrait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    html2canvasMock.mockResolvedValue({ toBlob: toBlobMock });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:portrait"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("downloads after the canvas has produced a PNG blob", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const blob = new Blob(["portrait"], { type: "image/png" });
    toBlobMock.mockImplementation((callback: BlobCallback) => callback(blob));

    await captureDomPortrait(document.createElement("div"), "portrait.png");

    expect(html2canvasMock).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ backgroundColor: null, useCORS: true }),
    );
    expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
  });

  it("rejects when the canvas cannot produce a blob", async () => {
    toBlobMock.mockImplementation((callback: BlobCallback) => callback(null));

    await expect(
      captureDomPortrait(document.createElement("div"), "portrait.png"),
    ).rejects.toThrow("Could not encode portrait image");
  });
});
