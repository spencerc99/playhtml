// ABOUTME: Messages between the scraps page and the worker that runs the picture-reading model.
// ABOUTME: The page asks to load, to read a picture, or to read search words; the worker answers with vectors.

export type MeaningWorkerRequest =
  | { type: "load" }
  | { type: "image"; id: number; blob: Blob }
  | { type: "text"; id: number; text: string };

export type MeaningWorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "failed"; message: string }
  | { type: "vector"; id: number; vector: Float32Array }
  | { type: "error"; id: number; message: string };
