// ABOUTME: Verifies the synchronized-sound recipe keeps its collaboration boundaries intact.
// ABOUTME: Guards autoplay, event, timeline, and config-before-init requirements in source.
import { describe, expect, it } from "vitest";
import { synchronizedSoundRecipe } from "../synchronized-sound";

describe("synchronizedSoundRecipe", () => {
  it("is a complete canonical recipe", () => {
    expect(synchronizedSoundRecipe.id).toBe("synchronized-sound");
    expect(synchronizedSoundRecipe.docsHref).toBe(
      "/docs/examples/synchronized-sound/",
    );
    expect(synchronizedSoundRecipe.html).toContain("<!doctype html>");
    expect(synchronizedSoundRecipe.html).toContain(
      'id="sound-transport" can-play',
    );
  });

  it("configures the stable element before playhtml initializes", () => {
    const source = synchronizedSoundRecipe.html;
    const initIndex = source.indexOf("await playhtml.init");

    expect(source.indexOf("soundTransport.defaultData")).toBeLessThan(initIndex);
    expect(source.indexOf("soundTransport.updateElement")).toBeLessThan(
      initIndex,
    );
    expect(source.indexOf("soundTransport.onClick")).toBeLessThan(initIndex);
    expect(source.indexOf("soundTransport.onMount")).toBeLessThan(initIndex);
  });

  it("uses an event for cues and shared wall-clock data for the transport", () => {
    const source = synchronizedSoundRecipe.html;

    expect(source).toContain("playhtml.dispatchPlayEvent");
    expect(source).toContain("synchronized-sound-cue");
    expect(source).toContain("startedAtMs");
    expect(source).toContain("Date.now()");
    expect(source).toContain("window.AudioContext");
    expect(source).not.toMatch(/<audio|\.mp3|\.wav|\.ogg/i);
  });

  it("never writes shared data from render or scheduling callbacks", () => {
    const source = synchronizedSoundRecipe.html;
    const updateStart = source.indexOf("soundTransport.updateElement");
    const clickStart = source.indexOf("soundTransport.onClick");
    const mountStart = source.indexOf("soundTransport.onMount");
    const initStart = source.indexOf("await playhtml.init");

    expect(source.slice(updateStart, clickStart)).not.toContain("setData(");
    expect(source.slice(mountStart, initStart)).not.toContain("setData(");
    expect(source.slice(clickStart, mountStart).match(/setData\(/g)).toHaveLength(2);
  });
});
