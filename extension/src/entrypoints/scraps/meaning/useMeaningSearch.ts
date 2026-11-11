// ABOUTME: Drives searching scraps by meaning on the scraps page: the opt-in download, reading pictures, and scoring searches.
// ABOUTME: Nothing loads until someone asks for it; after that the browser keeps the model and the page picks up where it left off.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { readImagePreviewInputs } from "../../../storage/ScrapImageCopies";
import {
  clearMeaningVectors,
  readMeaningVectors,
  storeMeaningVectors,
} from "./meaningIndex";
import {
  MEANING_INDEX_VERSION,
  MEANING_MATCH_THRESHOLD,
} from "./meaningModelInfo";
import { meaningMatches, unreadPictures } from "./meaningRanking";
import type { MeaningWorkerResponse } from "./meaningProtocol";
import MeaningWorker from "./meaningModel.worker?worker";

const CHOICE_KEY = "scraps-meaning-search";

/**
 * The worker's answer: a vector, null for a picture it could not read, or
 * undefined when it stopped before answering.
 */
type Answer = Float32Array | null | undefined;
/** Pictures fetched from storage together; each is still read one at a time. */
const READ_BATCH = 8;
const SEARCH_DELAY_MS = 200;
/** Where the browser keeps downloaded model files for transformers.js. */
const MODEL_CACHE = "transformers-cache";

export type MeaningSearchStatus =
  | { phase: "off" }
  | { phase: "downloading"; loaded: number; total: number }
  | { phase: "reading"; read: number; total: number }
  | { phase: "ready"; read: number }
  | { phase: "failed"; message: string };

/** Set `scraps-meaning-debug` in localStorage to log each search's closest scores. */
function debugging(): boolean {
  try {
    return localStorage.getItem("scraps-meaning-debug") !== null;
  } catch {
    return false;
  }
}

function rememberedChoice(): boolean {
  try {
    return localStorage.getItem(CHOICE_KEY) === "on";
  } catch {
    return false;
  }
}

function rememberChoice(on: boolean) {
  try {
    if (on) localStorage.setItem(CHOICE_KEY, "on");
    else localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Without storage the choice lasts as long as the page.
  }
}

/**
 * Whether a failed fetch might succeed later: the network was down, the
 * server was having trouble, or it asked to be tried again. A picture that is
 * simply gone or refused is not worth asking for again.
 */
function transientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * A picture's bytes: the page's own copy if it kept one, else a fresh fetch.
 * Pictures whose fetch failed in a way that may pass are listed apart, so
 * they are tried again later rather than remembered as unreadable.
 */
async function pictureBlobs(
  srcs: string[],
): Promise<{ blobs: Map<string, Blob>; retryLater: Set<string> }> {
  const blobs = new Map<string, Blob>();
  const retryLater = new Set<string>();
  const local = await readImagePreviewInputs(srcs).catch(() => new Map());
  await Promise.all(
    srcs.map(async (src) => {
      const copy = local.get(src);
      if (copy) {
        blobs.set(src, copy.preview ?? copy.blob);
        return;
      }
      try {
        const response = await fetch(src, { credentials: "omit" });
        if (response.ok) blobs.set(src, await response.blob());
        else if (transientStatus(response.status)) retryLater.add(src);
      } catch {
        // Offline, or the request never got an answer: tried again next time.
        retryLater.add(src);
      }
    }),
  );
  return { blobs, retryLater };
}

/** True where the browser cannot hold the model comfortably: iPhone and iPad. */
function tooSmallForModel(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function useMeaningSearch(
  items: readonly ScrapItem[],
  allowed: boolean,
) {
  const supported = allowed && !tooSmallForModel();
  // Read once, apart from `supported`: feature access settles after the
  // first render, and the remembered choice has to survive that.
  const [wanted, setWanted] = useState(rememberedChoice);
  const [status, setStatus] = useState<MeaningSearchStatus>({ phase: "off" });
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{
    query: string;
    scores: ReadonlyMap<string, number>;
  } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (vector: Answer) => void>());
  const nextId = useRef(0);
  const vectors = useRef(new Map<string, Float32Array | null>());
  const queryVector = useRef<{ query: string; vector: Float32Array } | null>(
    null,
  );
  const [modelReady, setModelReady] = useState(false);
  const [vectorsVersion, setVectorsVersion] = useState(0);

  useEffect(() => {
    if (!supported || !wanted) return;
    let cancelled = false;
    const worker = new MeaningWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<MeaningWorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        if (!cancelled)
          setStatus({
            phase: "downloading",
            loaded: message.loaded,
            total: message.total,
          });
      } else if (message.type === "ready") {
        if (!cancelled) setModelReady(true);
      } else if (message.type === "failed") {
        if (!cancelled)
          setStatus({ phase: "failed", message: message.message });
      } else {
        const resolve = pending.current.get(message.id);
        pending.current.delete(message.id);
        resolve?.(message.type === "vector" ? message.vector : null);
      }
    };
    setStatus({ phase: "downloading", loaded: 0, total: 0 });
    readMeaningVectors(MEANING_INDEX_VERSION)
      .then((stored) => {
        if (cancelled) return;
        vectors.current = stored;
        setVectorsVersion((value) => value + 1);
      })
      .catch((error: unknown) =>
        console.warn("[meaning search] could not read index:", error),
      )
      .finally(() => {
        if (!cancelled) worker.postMessage({ type: "load" });
      });
    return () => {
      cancelled = true;
      worker.terminate();
      workerRef.current = null;
      // Unanswered, not unreadable: the reading loop drops these.
      for (const resolve of pending.current.values()) resolve(undefined);
      pending.current.clear();
      setModelReady(false);
    };
  }, [supported, wanted]);

  const ask = useCallback(
    (request: { type: "image"; blob: Blob } | { type: "text"; text: string }) =>
      new Promise<Answer>((resolve) => {
        const worker = workerRef.current;
        if (!worker) return resolve(undefined);
        const id = ++nextId.current;
        pending.current.set(id, resolve);
        worker.postMessage({ ...request, id });
      }),
    [],
  );

  // Read every picture not read yet, newest first, saving as it goes so a
  // closed tab loses at most one batch. A change to the scraps restarts the
  // run, keeping whatever the batch in progress had already read.
  useEffect(() => {
    if (!modelReady) return;
    let cancelled = false;
    const worker = workerRef.current;
    /** Saves what was read, unless the worker has since been turned off. */
    const keep = async (
      results: Array<{ src: string; vector: Float32Array | null }>,
    ) => {
      if (results.length === 0 || workerRef.current !== worker) return;
      for (const { src, vector } of results) vectors.current.set(src, vector);
      await storeMeaningVectors(MEANING_INDEX_VERSION, results).catch(
        (error: unknown) =>
          console.warn("[meaning search] could not save:", error),
      );
      setVectorsVersion((value) => value + 1);
    };
    const run = async () => {
      const unread = unreadPictures(items, vectors.current);
      const alreadyRead = () =>
        items.filter(
          (item) => item.kind === "image" && vectors.current.has(item.src),
        ).length;
      const total = unread.length + alreadyRead();
      for (
        let start = 0;
        start < unread.length && !cancelled;
        start += READ_BATCH
      ) {
        setStatus({ phase: "reading", read: alreadyRead(), total });
        const batch = unread.slice(start, start + READ_BATCH);
        const { blobs, retryLater } = await pictureBlobs(batch);
        const results: Array<{ src: string; vector: Float32Array | null }> = [];
        for (const src of batch) {
          if (cancelled) break;
          if (retryLater.has(src)) continue;
          const blob = blobs.get(src);
          const vector = blob ? await ask({ type: "image", blob }) : null;
          // The worker went away (turned off or the page is closing), so this
          // picture is dropped rather than saved as one that cannot be read.
          if (vector === undefined) break;
          results.push({ src, vector });
        }
        await keep(results);
        if (results.length < batch.length - retryLater.size) return;
      }
      if (!cancelled) setStatus({ phase: "ready", read: alreadyRead() });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [modelReady, items, ask]);

  // Turn the search words into a vector once they settle, then score.
  useEffect(() => {
    const words = query.trim();
    if (!modelReady || words === "") {
      queryVector.current = null;
      setMatches(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const vector = await ask({ type: "text", text: words });
      if (cancelled || !vector) return;
      queryVector.current = { query: words, vector };
      setVectorsVersion((value) => value + 1);
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, modelReady, ask]);

  // Rescore whenever the words or the pictures read so far change.
  useEffect(() => {
    const current = queryVector.current;
    if (!current) return;
    if (debugging()) {
      const all = [...meaningMatches(current.vector, vectors.current, -1)]
        .sort((first, second) => second[1] - first[1])
        .slice(0, 8)
        .map(([src, score]) => `${score.toFixed(3)} ${src.slice(-40)}`);
      console.info(`[meaning search] "${current.query}"\n${all.join("\n")}`);
    }
    setMatches({
      query: current.query,
      scores: meaningMatches(
        current.vector,
        vectors.current,
        MEANING_MATCH_THRESHOLD,
      ),
    });
  }, [vectorsVersion]);

  const enable = useCallback(() => {
    rememberChoice(true);
    setWanted(true);
  }, []);

  /** Turns it off and gives back the disk space: the model files and every vector. */
  const remove = useCallback(async () => {
    rememberChoice(false);
    setWanted(false);
    setStatus({ phase: "off" });
    setMatches(null);
    vectors.current = new Map();
    await Promise.allSettled([
      clearMeaningVectors(),
      typeof caches === "undefined"
        ? Promise.resolve()
        : caches.delete(MODEL_CACHE),
    ]);
  }, []);

  const scoreFor = useCallback(
    (item: ScrapItem, search: string): number | undefined => {
      if (!matches || item.kind !== "image") return undefined;
      if (matches.query !== search.trim()) return undefined;
      return matches.scores.get(item.src);
    },
    [matches],
  );

  return useMemo(
    () => ({
      supported,
      status: wanted ? status : ({ phase: "off" } as const),
      enable,
      remove,
      onSearchChange: setQuery,
      scoreFor: matches ? scoreFor : undefined,
    }),
    [supported, wanted, status, enable, remove, matches, scoreFor],
  );
}
