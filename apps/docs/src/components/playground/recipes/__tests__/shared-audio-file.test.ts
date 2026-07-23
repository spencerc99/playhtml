// ABOUTME: Verifies the shared audio-file recipe uses a real file and safe writes.
// ABOUTME: Guards the local audio permission and shared transport boundaries.
import { describe, expect, it } from "vitest";
import { sharedAudioFileRecipe } from "../shared-audio-file";

describe("sharedAudioFileRecipe", () => {
  it("is a complete canonical recipe backed by an audio file", () => {
    expect(sharedAudioFileRecipe.id).toBe("shared-audio-file");
    expect(sharedAudioFileRecipe.docsHref).toBe(
      "/docs/examples/shared-audio-file/",
    );
    expect(sharedAudioFileRecipe.html).toContain(
      'id="shared-audio-player" class="player" can-play',
    );
    expect(sharedAudioFileRecipe.html).toContain("<audio");
    expect(sharedAudioFileRecipe.html).toContain("t-rex-roar.mp3");
  });

  it("configures the element before playhtml initializes", () => {
    const source = sharedAudioFileRecipe.html;
    const initIndex = source.indexOf("await playhtml.init");

    expect(source.indexOf("player.defaultData")).toBeLessThan(initIndex);
    expect(source.indexOf("player.updateElement")).toBeLessThan(initIndex);
    expect(source.indexOf("player.onClick")).toBeLessThan(initIndex);
    expect(source.indexOf("player.onMount")).toBeLessThan(initIndex);
  });

  it("writes shared data only from explicit controls", () => {
    const source = sharedAudioFileRecipe.html;
    const updateStart = source.indexOf("player.updateElement");
    const clickStart = source.indexOf("player.onClick");
    const mountStart = source.indexOf("player.onMount");
    const initStart = source.indexOf("await playhtml.init");

    expect(source.slice(updateStart, clickStart)).not.toContain("setData(");
    expect(source.slice(mountStart, initStart)).not.toContain("setData(");
    expect(source.slice(clickStart, mountStart).match(/setData\(/g)).toHaveLength(2);
  });
});
