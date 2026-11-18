// ABOUTME: Tests that a stalled image host fails that one image within the time limit,
// ABOUTME: so a collage bake gives up on it the way it does for a broken image, instead of hanging.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_LOAD_LIMIT_MS,
  fetchImageBlob,
  loadImage,
  loadRemoteImage,
} from "../entrypoints/scraps/imageLoading";
import {
  CollageBakeError,
  prepareCollagePieces,
} from "../entrypoints/scraps/bakeCollage";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";

/**
 * A host that accepts the request and never answers, until the request is
 * called off. This stands in for the network; the code under test is real.
 */
function stalledHost(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    })) as typeof fetch;
}

/** A host that answers at once with a few bytes. */
function answeringHost(): typeof fetch {
  return (async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as typeof fetch;
}

/**
 * A host that sends one byte every `gapMs`, `pieces` times, then either ends
 * the image or goes quiet until the request is called off.
 */
function trickleHost(gapMs: number, pieces: number, finishes: boolean): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () =>
          controller.error(
            new DOMException("The operation was aborted.", "AbortError"),
          ),
        );
      },
      pull(controller) {
        return new Promise<void>((resolve) => {
          if (sent === pieces) {
            if (finishes) controller.close();
            resolve();
            return;
          }
          setTimeout(() => {
            sent += 1;
            controller.enqueue(new Uint8Array([sent]));
            resolve();
          }, gapMs);
        });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as typeof fetch;
}

/** Records how a promise ended, without letting a rejection go unhandled. */
function outcomeOf<T>(promise: Promise<T>) {
  const outcome: { done: boolean; error: unknown } = {
    done: false,
    error: null,
  };
  promise.then(
    () => {
      outcome.done = true;
    },
    (error: unknown) => {
      outcome.done = true;
      outcome.error = error;
    },
  );
  return outcome;
}

function imagePiece(src: string): CollagePiece {
  return {
    id: "piece_1",
    scrapId: "scrap_1",
    scrap: {
      id: "scrap_1",
      key: "image:one",
      kind: "image",
      src,
      alt: "a photo from a slow host",
      naturalWidth: 100,
      naturalHeight: 80,
      pageTitle: "A page",
      domain: "slow.example",
      pageUrl: "https://slow.example/a",
      ts: 1_000,
    },
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    z: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
  } as CollagePiece;
}

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no blob URLs; the bytes only need an address to hand the image.
  URL.createObjectURL = () => "blob:test/image";
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe("an image host that never answers", () => {
  it("fails the image once the limit passes", async () => {
    vi.stubGlobal("fetch", stalledHost());
    const outcome = outcomeOf(loadRemoteImage("https://slow.example/a.png"));

    await vi.advanceTimersByTimeAsync(IMAGE_LOAD_LIMIT_MS - 1);
    expect(outcome.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(outcome.done).toBe(true);
    expect(String(outcome.error)).toMatch(/stopped arriving within 15 seconds/);
  });

  it("leaves the bake to fail that piece, as it does a broken image", async () => {
    vi.stubGlobal("fetch", stalledHost());
    const outcome = outcomeOf(
      prepareCollagePieces([imagePiece("https://slow.example/a.png")]),
    );

    await vi.advanceTimersByTimeAsync(IMAGE_LOAD_LIMIT_MS);

    expect(outcome.done).toBe(true);
    expect(outcome.error).toBeInstanceOf(CollageBakeError);
    const failures = (outcome.error as CollageBakeError).failures;
    expect(failures).toHaveLength(1);
    expect(failures[0].label).toBe("a photo from a slow host");
    expect(failures[0].reason).toMatch(/stopped arriving/);
  });
});

describe("an image that arrives slowly", () => {
  it("finishes however long it takes, while pieces keep coming", async () => {
    vi.stubGlobal("fetch", trickleHost(IMAGE_LOAD_LIMIT_MS - 1_000, 4, true));
    const outcome = outcomeOf(fetchImageBlob("https://slow.example/big.png"));

    await vi.advanceTimersByTimeAsync(IMAGE_LOAD_LIMIT_MS * 4);

    expect(outcome.done).toBe(true);
    expect(outcome.error).toBeNull();
  });

  it("fails once the host goes quiet partway through", async () => {
    vi.stubGlobal("fetch", trickleHost(1_000, 2, false));
    const outcome = outcomeOf(fetchImageBlob("https://slow.example/big.png"));

    await vi.advanceTimersByTimeAsync(2_000 + IMAGE_LOAD_LIMIT_MS - 1);
    expect(outcome.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(outcome.done).toBe(true);
    expect(String(outcome.error)).toMatch(/stopped arriving within 15 seconds/);
  });
});

describe("an image that arrives but never finishes loading", () => {
  // jsdom never loads image bytes, so this image neither loads nor errors:
  // the same as a browser left waiting on a decode that never comes.
  it("fails the image once the limit passes", async () => {
    vi.stubGlobal("fetch", answeringHost());
    const outcome = outcomeOf(loadRemoteImage("https://slow.example/a.png"));

    await vi.advanceTimersByTimeAsync(IMAGE_LOAD_LIMIT_MS);

    expect(outcome.done).toBe(true);
    expect(String(outcome.error)).toMatch(/did not decode within 15 seconds/);
  });

  it("applies to an image drawn from the page's own address too", async () => {
    const outcome = outcomeOf(loadImage("data:image/png;base64,AAAA"));
    await vi.advanceTimersByTimeAsync(IMAGE_LOAD_LIMIT_MS);
    expect(outcome.done).toBe(true);
    expect(String(outcome.error)).toMatch(/did not decode/);
  });
});
