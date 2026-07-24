// ABOUTME: Tests sound acquisition decisions, refetch guards, and bridge validation.
// ABOUTME: Covers bounded binary handling without substituting browser media APIs.

import { afterEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  SOUND_BRIDGE_MAX_BYTES,
  SOUND_CLIP_MESSAGE_TYPE,
  SoundAcquisition,
  getSoundAcquisitionMethod,
  parseSoundClipBridgeMessage,
  refetchSoundClip,
} from "../collectors/SoundAcquisition";

describe("sound acquisition decisions", () => {
  it("refetches plain HTTP sources and captures non-fetchable sources", () => {
    expect(
      getSoundAcquisitionMethod("https://cdn.example.com/chime.mp3?token=1"),
    ).toBe("refetch");
    expect(getSoundAcquisitionMethod("http://example.com/ambient.ogg")).toBe(
      "refetch",
    );
    expect(getSoundAcquisitionMethod("blob:https://example.com/id")).toBe(
      "capture-stream",
    );
    expect(getSoundAcquisitionMethod("data:audio/wav;base64,AAAA")).toBe(
      "capture-stream",
    );
    expect(getSoundAcquisitionMethod("")).toBe("capture-stream");
  });

  it("uses a successful refetch result without requesting MAIN-world capture", async () => {
    const sendMessage = vi.mocked(browser.runtime.sendMessage);
    sendMessage.mockResolvedValueOnce({
      success: true,
      clipId: "sound_clip_1",
      mimeType: "audio/mpeg",
      clipDurationMs: 500,
      sizeBytes: 100,
    });
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => undefined);
    const acquisition = new SoundAcquisition();
    acquisition.start();

    await expect(
      acquisition.acquire({
        sourceUrl: "https://cdn.example.com/chime.mp3?token=1",
        captureId: "capture-1",
        mediaDurationMs: 500,
      }),
    ).resolves.toEqual({
      acquisition: "refetch",
      clipId: "sound_clip_1",
      mimeType: "audio/mpeg",
      clipDurationMs: 500,
      sizeBytes: 100,
    });
    expect(postMessage).not.toHaveBeenCalled();
    acquisition.stop();
    postMessage.mockRestore();
  });

  it("falls back to MAIN-world capture and stores its validated bytes", async () => {
    const sendMessage = vi.mocked(browser.runtime.sendMessage);
    sendMessage
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({
        success: true,
        clipId: "sound_clip_2",
        mimeType: "audio/webm;codecs=opus",
        clipDurationMs: 750,
        sizeBytes: 3,
      });
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => undefined);
    const acquisition = new SoundAcquisition();
    acquisition.start();

    const resultPromise = acquisition.acquire({
      sourceUrl: "https://cdn.example.com/missing.mp3",
      captureId: "capture-2",
    });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    const request = postMessage.mock.calls[0][0] as {
      requestId: string;
    };
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          type: SOUND_CLIP_MESSAGE_TYPE,
          requestId: request.requestId,
          buffer: new Uint8Array([1, 2, 3]).buffer,
          mimeType: "audio/webm;codecs=opus",
          durationMs: 750,
        },
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      acquisition: "capture-stream",
      clipId: "sound_clip_2",
      mimeType: "audio/webm;codecs=opus",
      clipDurationMs: 750,
      sizeBytes: 3,
    });
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "STORE_SOUND_CLIP",
      dataBase64: "AQID",
      mimeType: "audio/webm;codecs=opus",
      clipDurationMs: 750,
    });
    acquisition.stop();
    postMessage.mockRestore();
  });
});

describe("sound clip bridge validation", () => {
  function validMessage(overrides: Record<string, unknown> = {}) {
    return {
      type: SOUND_CLIP_MESSAGE_TYPE,
      requestId: "sound_capture_1",
      buffer: new Uint8Array([1, 2, 3]).buffer,
      mimeType: "audio/webm;codecs=opus",
      durationMs: 1_000,
      ...overrides,
    };
  }

  it("accepts the exact bounded ArrayBuffer bridge shape", () => {
    expect(parseSoundClipBridgeMessage(validMessage())).toEqual(
      validMessage(),
    );
  });

  it("rejects page-forgeable shape, type, duration, and size violations", () => {
    expect(
      parseSoundClipBridgeMessage({ ...validMessage(), unexpected: true }),
    ).toBeUndefined();
    expect(
      parseSoundClipBridgeMessage(validMessage({ buffer: new Uint8Array([1]) })),
    ).toBeUndefined();
    expect(
      parseSoundClipBridgeMessage(
        validMessage({
          buffer: new ArrayBuffer(SOUND_BRIDGE_MAX_BYTES + 1),
        }),
      ),
    ).toBeUndefined();
    expect(
      parseSoundClipBridgeMessage(validMessage({ mimeType: "text/html" })),
    ).toBeUndefined();
    expect(
      parseSoundClipBridgeMessage(validMessage({ durationMs: 12_001 })),
    ).toBeUndefined();
    expect(
      parseSoundClipBridgeMessage(validMessage({ requestId: "x".repeat(129) })),
    ).toBeUndefined();
  });
});

describe("background sound refetch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams a sane audio response into a clip blob", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": "3",
      },
    });

    const clip = await refetchSoundClip("https://cdn.example.com/chime.mp3", {
      fetchImpl: vi.fn().mockResolvedValue(response),
    });

    expect(clip.mimeType).toBe("audio/mpeg");
    expect(clip.blob.size).toBe(3);
  });

  it("rejects disallowed content types before storing bytes", async () => {
    const response = new Response(new Uint8Array([1]), {
      status: 200,
      headers: { "content-type": "text/html" },
    });

    await expect(
      refetchSoundClip("https://example.com/not-a-sound", {
        fetchImpl: vi.fn().mockResolvedValue(response),
      }),
    ).rejects.toMatchObject({
      code: "invalid-content-type",
    });
  });

  it("rejects declared and streamed bodies over the byte cap", async () => {
    const declaredTooLarge = new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": "5",
      },
    });
    await expect(
      refetchSoundClip("https://example.com/large.mp3", {
        fetchImpl: vi.fn().mockResolvedValue(declaredTooLarge),
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "size-limit",
    });

    const streamedTooLarge = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      },
    );
    await expect(
      refetchSoundClip("https://example.com/stream", {
        fetchImpl: vi.fn().mockResolvedValue(streamedTooLarge),
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "size-limit",
    });
  });

  it("aborts a fetch that exceeds the overall timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    ) as typeof fetch;

    const refetch = refetchSoundClip("https://example.com/live-stream", {
      fetchImpl,
      timeoutMs: 100,
    });
    const rejection = expect(refetch).rejects.toMatchObject({
      code: "timeout",
    });

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });
});
