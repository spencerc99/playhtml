// ABOUTME: Runs the picture-reading model (SigLIP) off the scraps page's rendering thread.
// ABOUTME: Downloads it once on request, then turns pictures and search words into comparable vectors.

import * as transformers from "@huggingface/transformers";
import type {
  MeaningWorkerRequest,
  MeaningWorkerResponse,
} from "./meaningProtocol";
import { MEANING_MODEL, MEANING_PROMPT } from "./meaningModelInfo";

type Transformers = typeof import("@huggingface/transformers");

interface LoadedModel {
  lib: Transformers;
  processor: Awaited<
    ReturnType<Transformers["AutoProcessor"]["from_pretrained"]>
  >;
  tokenizer: Awaited<
    ReturnType<Transformers["AutoTokenizer"]["from_pretrained"]>
  >;
  vision: Awaited<
    ReturnType<Transformers["SiglipVisionModel"]["from_pretrained"]>
  >;
  text: Awaited<ReturnType<Transformers["SiglipTextModel"]["from_pretrained"]>>;
  device: "webgpu" | "wasm";
}

let loading: Promise<LoadedModel> | null = null;

function post(message: MeaningWorkerResponse) {
  self.postMessage(message);
}

function normalized(data: ArrayLike<number>): Float32Array {
  const vector = Float32Array.from(data);
  let length = 0;
  for (const value of vector) length += value * value;
  length = Math.sqrt(length) || 1;
  for (let index = 0; index < vector.length; index++) vector[index] /= length;
  return vector;
}

async function canUseWebGpu(): Promise<boolean> {
  const gpu = (
    navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }
  ).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

async function loadModel(): Promise<LoadedModel> {
  // Imported up front: the worker is only started once someone asks for it.
  const lib = transformers;
  const { env } = lib;
  // The runtime's own code ships inside the extension; only the model's
  // weights come from Hugging Face, and the browser keeps them after that.
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = new URL(
      "/ort/",
      self.location.origin,
    ).href;
    env.backends.onnx.wasm.proxy = false;
  }

  // Each file reports its own bytes; the bar shows them summed.
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (event: {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    if (!event.file) return;
    if (event.status === "progress" && event.total) {
      files.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
    } else if (event.status === "done") {
      const current = files.get(event.file);
      if (current) files.set(event.file, { ...current, loaded: current.total });
    } else {
      return;
    }
    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    post({ type: "progress", loaded, total });
  };

  const options = { revision: MEANING_MODEL.revision, progress_callback };
  const processor = await lib.AutoProcessor.from_pretrained(
    MEANING_MODEL.id,
    options,
  );
  const tokenizer = await lib.AutoTokenizer.from_pretrained(
    MEANING_MODEL.id,
    options,
  );

  const devices: Array<"webgpu" | "wasm"> = (await canUseWebGpu())
    ? ["webgpu", "wasm"]
    : ["wasm"];
  let lastError: unknown;
  for (const device of devices) {
    try {
      const modelOptions = { ...options, device, dtype: MEANING_MODEL.dtype };
      const vision = await lib.SiglipVisionModel.from_pretrained(
        MEANING_MODEL.id,
        modelOptions,
      );
      const text = await lib.SiglipTextModel.from_pretrained(
        MEANING_MODEL.id,
        modelOptions,
      );
      return { lib, processor, tokenizer, vision, text, device };
    } catch (error) {
      // A graphics card the runtime cannot use falls back to the processor.
      lastError = error;
    }
  }
  throw lastError;
}

function model(): Promise<LoadedModel> {
  loading ??= loadModel().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function embedImage(blob: Blob): Promise<Float32Array> {
  const { lib, processor, vision } = await model();
  const image = await lib.RawImage.fromBlob(blob);
  const inputs = await processor(image);
  const output = await vision(inputs);
  return normalized(output.pooler_output.data as Float32Array);
}

async function embedText(text: string): Promise<Float32Array> {
  const { tokenizer, text: textModel } = await model();
  const inputs = tokenizer([MEANING_PROMPT(text)], {
    padding: "max_length",
    max_length: 64,
    truncation: true,
  });
  const output = await textModel(inputs);
  return normalized(output.pooler_output.data as Float32Array);
}

self.onmessage = async (event: MessageEvent<MeaningWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "load") {
      const { device } = await model();
      post({ type: "ready", device });
    } else if (request.type === "image") {
      const vector = await embedImage(request.blob);
      post({ type: "vector", id: request.id, vector });
    } else if (request.type === "text") {
      const vector = await embedText(request.text);
      post({ type: "vector", id: request.id, vector });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post(
      request.type === "load"
        ? { type: "failed", message }
        : { type: "error", id: request.id, message },
    );
  }
};
