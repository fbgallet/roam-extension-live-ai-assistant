/**
 * Embedding Service — Transformers.js via Web Worker
 *
 * Runs text embedding in a dedicated Web Worker thread to avoid
 * freezing the browser. The worker loads Transformers.js from CDN
 * and runs ONNX inference off the main thread.
 *
 * Supports multiple models:
 * - bge-small-en-v1.5: English only, ~10MB quantized, best quality
 * - all-MiniLM-L6-v2: English only, ~10MB quantized, faster indexing
 * - multilingual-e5-small: 100+ languages, ~40MB quantized
 *
 * Both produce 384-dimensional embeddings.
 */

import { EMBEDDING_MODELS, type LocalEmbeddingModel } from "../../types";

export const EMBEDDING_DIMENSIONS = 384;

const WORKER_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1/dist/transformers.min.js";

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;
let messageId = 0;
let currentModelId: LocalEmbeddingModel | null = null;

/** Create an inline Web Worker from a function body string */
function createInlineWorker(modelName: string): Worker {
  const workerCode = `
    const CDN_URL = "${WORKER_CDN_URL}";
    let pipeline = null;

    async function loadAndInit(modelName, postMsg) {
      const transformers = await import(CDN_URL);
      const { pipeline: createPipeline, env } = transformers;
      env.allowLocalModels = false;

      pipeline = await createPipeline("feature-extraction", modelName, {
        quantized: true,
        progress_callback: (p) => {
          if (p.status === "progress" && p.progress != null) {
            postMsg({ type: "init-progress", status: "downloading", progress: p.progress });
          }
        },
      });
      postMsg({ type: "init-done" });
    }

    async function embedTexts(id, texts, postMsg) {
      if (!pipeline) {
        postMsg({ type: "embed-error", id, error: "Pipeline not initialized" });
        return;
      }
      try {
        const BATCH_SIZE = 8;
        const allEmbeddings = [];
        const t0 = performance.now();
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
          const batch = texts.slice(i, i + BATCH_SIZE);
          const output = await pipeline(batch, { pooling: "mean", normalize: true });
          for (let j = 0; j < batch.length; j++) {
            allEmbeddings.push(Array.from(output[j].data));
          }
          const done = Math.min(i + BATCH_SIZE, texts.length);
          postMsg({ type: "embed-progress", id, done, total: texts.length });
        }
        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        console.log("[EmbeddingWorker] " + texts.length + " texts in " + elapsed + "s (" + (((performance.now() - t0) / texts.length)).toFixed(0) + "ms/text)");
        postMsg({ type: "embed-result", id, embeddings: allEmbeddings });
      } catch (e) {
        postMsg({ type: "embed-error", id, error: e.message || String(e) });
      }
    }

    self.onmessage = async (event) => {
      const postMsg = (msg) => self.postMessage(msg);
      switch (event.data.type) {
        case "init":
          try { await loadAndInit(event.data.modelName, postMsg); }
          catch (e) { postMsg({ type: "init-error", error: e.message || String(e) }); }
          break;
        case "embed":
          await embedTexts(event.data.id, event.data.texts, postMsg);
          break;
        case "dispose":
          if (pipeline) { await pipeline.dispose?.(); pipeline = null; }
          break;
      }
    };
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const w = new Worker(url, { type: "module" });
  URL.revokeObjectURL(url);
  return w;
}

/** Get or initialize the worker for a specific model */
function getWorker(
  modelId: LocalEmbeddingModel,
  onModelProgress?: (progress: { status: string; progress?: number }) => void
): Promise<Worker> {
  // If same model is already loaded, reuse
  if (worker && initPromise && currentModelId === modelId) {
    return initPromise.then(() => worker!);
  }

  // Different model requested — dispose old worker
  if (worker && currentModelId !== modelId) {
    worker.postMessage({ type: "dispose" });
    worker.terminate();
    worker = null;
    initPromise = null;
  }

  const modelConfig = EMBEDDING_MODELS[modelId];
  currentModelId = modelId;
  worker = createInlineWorker(modelConfig.hfName);

  initPromise = new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case "init-progress":
          onModelProgress?.(msg);
          break;
        case "init-done":
          worker!.removeEventListener("message", handler);
          resolve();
          break;
        case "init-error":
          worker!.removeEventListener("message", handler);
          reject(new Error(msg.error));
          break;
      }
    };
    worker!.addEventListener("message", handler);
    worker!.postMessage({ type: "init", modelName: modelConfig.hfName });
  });

  return initPromise.then(() => worker!);
}

/**
 * Embed an array of document texts into vectors.
 * Applies the model's document prefix automatically.
 * Runs in a Web Worker — does not block the main thread.
 */
export async function embedTexts(
  texts: string[],
  modelId: LocalEmbeddingModel = "bge-small-en",
  onProgress?: (done: number, total: number) => void,
  modelProgress?: (progress: { status: string; progress?: number }) => void
): Promise<number[][]> {
  const w = await getWorker(modelId, modelProgress);
  const modelConfig = EMBEDDING_MODELS[modelId];

  // Apply document prefix if the model requires it
  const prefixedTexts = modelConfig.documentPrefix
    ? texts.map((t) => modelConfig.documentPrefix + t)
    : texts;

  const id = String(++messageId);

  return new Promise<number[][]>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.id !== id) return;

      switch (msg.type) {
        case "embed-progress":
          onProgress?.(msg.done, msg.total);
          break;
        case "embed-result":
          w.removeEventListener("message", handler);
          resolve(msg.embeddings);
          break;
        case "embed-error":
          w.removeEventListener("message", handler);
          reject(new Error(msg.error));
          break;
      }
    };

    w.addEventListener("message", handler);
    w.postMessage({ type: "embed", id, texts: prefixedTexts });
  });
}

/**
 * Embed a single query text.
 * Applies the model's query prefix automatically.
 */
export async function embedQuery(
  text: string,
  modelId: LocalEmbeddingModel = "bge-small-en"
): Promise<number[]> {
  const modelConfig = EMBEDDING_MODELS[modelId];
  const prefixedText = modelConfig.queryPrefix + text;
  const [vec] = await embedTexts([prefixedText], modelId);
  return vec;
}

/** Release the worker and model */
export async function dispose(): Promise<void> {
  if (worker) {
    worker.postMessage({ type: "dispose" });
    worker.terminate();
    worker = null;
    initPromise = null;
    currentModelId = null;
  }
}
