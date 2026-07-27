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
      'id="shared-audio-player" class="player"',
    );
    expect(sharedAudioFileRecipe.html).toContain("<audio");
    expect(sharedAudioFileRecipe.html).toContain("t-rex-roar.mp3");
  });

  it("registers the element before playhtml initializes", () => {
    const source = sharedAudioFileRecipe.html;
    const registerIndex = source.indexOf(
      'playhtml.register("shared-audio-player", {',
    );
    const initIndex = source.indexOf("await playhtml.init");

    expect(registerIndex).toBeGreaterThan(-1);
    expect(registerIndex).toBeLessThan(initIndex);
    expect(source.indexOf("updateElement:", registerIndex)).toBeLessThan(
      initIndex,
    );
    expect(source.indexOf("onClick:", registerIndex)).toBeLessThan(initIndex);
    expect(source.indexOf("onMount:", registerIndex)).toBeLessThan(initIndex);
  });

  it("writes shared data only from explicit controls", () => {
    const source = sharedAudioFileRecipe.html;
    const registerStart = source.indexOf(
      'playhtml.register("shared-audio-player", {',
    );
    const updateStart = source.indexOf("updateElement:", registerStart);
    const clickStart = source.indexOf("onClick:", registerStart);
    const mountStart = source.indexOf("onMount:", registerStart);
    const initStart = source.indexOf("await playhtml.init");

    expect(source.slice(updateStart, clickStart)).not.toContain("setData(");
    expect(source.slice(mountStart, initStart)).not.toContain("setData(");
    expect(source.slice(clickStart, mountStart).match(/setData\(/g)).toHaveLength(2);
  });
});
