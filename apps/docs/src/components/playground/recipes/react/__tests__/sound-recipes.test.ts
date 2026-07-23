// ABOUTME: Verifies both copy-paste React sound examples keep their sync boundaries.
// ABOUTME: Guards provider usage, stable ids, event wiring, and explicit shared writes.
import { describe, expect, it } from "vitest";
import { sharedAudioFileReactSource } from "../shared-audio-file";
import { synchronizedSoundReactSource } from "../synchronized-sound";

describe("React sound recipe sources", () => {
  it.each([
    ["shared audio file", sharedAudioFileReactSource],
    ["synchronized sound", synchronizedSoundReactSource],
  ])("provides a complete %s app", (_name, source) => {
    expect(source).toContain('from "@playhtml/react"');
    expect(source).toContain("<PlayProvider");
    expect(source).toContain("withSharedState<TransportData>");
    expect(source).toContain("defaultData:");
    expect(source).toContain("export default function App()");
    expect(source).toContain("<style>");
  });

  it("keeps audio-file writes in named click handlers", () => {
    const source = sharedAudioFileReactSource;
    const effectStart = source.indexOf("useEffect(() =>");
    const enableStart = source.indexOf("async function enableAudio");
    const toggleStart = source.indexOf("function togglePlayback");
    const renderStart = source.indexOf("const progress =");

    expect(source.slice(effectStart, enableStart)).not.toContain("setData(");
    expect(source.slice(toggleStart, renderStart).match(/setData\(/g)).toHaveLength(
      2,
    );
    expect(source).toContain('id: "shared-audio-player"');
    expect(source).toContain('id="shared-audio-player"');
  });

  it("uses context events and user handlers in the generated-sound app", () => {
    const source = synchronizedSoundReactSource;
    const firstEffect = source.indexOf("useEffect(() =>");
    const enableStart = source.indexOf("async function enableAudio");
    const toggleStart = source.indexOf("function toggleTransport");
    const renderStart = source.indexOf("const activeStep =");

    expect(source).toContain("usePlayContext()");
    expect(source).toContain("registerPlayEventListener(CUE_EVENT");
    expect(source).toContain("removePlayEventListener(CUE_EVENT");
    expect(source).toContain("dispatchPlayEvent({ type: CUE_EVENT })");
    expect(source.slice(firstEffect, enableStart)).not.toContain("setData(");
    expect(source.slice(toggleStart, renderStart).match(/setData\(/g)).toHaveLength(
      2,
    );
    expect(source).toContain('id: "sound-transport"');
    expect(source).toContain('id="sound-transport"');
    expect(source).not.toMatch(/<audio(?:\s|>)|\.mp3|\.wav|\.ogg/i);
  });
});
