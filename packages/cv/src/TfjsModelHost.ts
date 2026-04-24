/**
 * TFJS model host — loads a `tensorflowjs_converter`-produced GraphModel or
 * LayersModel and exposes a typed `predict()` wrapper that owns tensor
 * lifetimes for the caller.
 *
 * Callers treat the result as an opaque handle: pass in a `Float32Array` (or a
 * numeric array), get back a `Float32Array` of logits/softmax/whatever the
 * model produces. We never leak `tf.Tensor` instances outside this module so
 * consumers don't have to understand TF.js memory management.
 *
 * TF.js itself is loaded via *dynamic import*, so apps that never actually
 * instantiate a classifier don't pay the ~300 KB bundle cost. This is
 * important for Pose Royale: only LearnSign uses TF.js today, and we don't
 * want every other game route pulling it in.
 *
 * Backend selection:
 *   - `"webgl"` (default): GPU via WebGL. Fast on most devices, can fail on
 *     strict CSP/privacy browsers with `WebGL is disabled`.
 *   - `"wasm"`: CPU via SIMD WASM. Slower but universally available; good
 *     fallback.
 *   - `"webgpu"` / `"cpu"`: exotic — supported but untested in this project.
 */

export interface TfjsClassifier<TInput, TOutput> {
  /** Runs inference. Returns a new TOutput on every call; no allocation reuse. */
  predict(input: TInput): Promise<TOutput>;
  /** Release GPU/WASM resources. Safe to call more than once. */
  dispose(): void;
}

export interface TfjsModelHostOptions {
  /** URL of the `model.json` produced by `tensorflowjs_converter`. */
  modelUrl: string;
  /**
   * Preferred backend. Default `"webgl"`. If the preferred backend fails to
   * initialize we fall back to `"wasm"` before surfacing an error.
   */
  backend?: "webgl" | "webgpu" | "wasm" | "cpu";
}

// TF.js is *not* declared as a workspace dependency — it's opt-in. Install it
// yourself (`pnpm -w add @tensorflow/tfjs`) when you're ready to ship a
// learned model; see games/learnsign/TRAINING.md. Until then, the runtime
// import below throws a friendly error and `createSignDetector` falls back to
// the heuristic backend.
//
// We minimally hand-type the TF.js surface we use so this file typechecks
// without the package installed. If TF.js is later added as a real workspace
// dependency, swap `TfModule` for `typeof import("@tensorflow/tfjs")` and the
// existing call sites will still compile.
interface TfTensor {
  data(): Promise<Float32Array>;
  dispose(): void;
}
interface TfModel {
  predict(input: TfTensor): TfTensor | TfTensor[];
  dispose(): void;
}
interface TfModule {
  tensor(values: Float32Array, shape: number[]): TfTensor;
  tidy<T>(fn: () => T): T;
  ready(): Promise<void>;
  setBackend(name: string): Promise<boolean>;
  loadGraphModel(url: string): Promise<TfModel>;
  loadLayersModel(url: string): Promise<TfModel>;
}

let tfModulePromise: Promise<TfModule> | null = null;
async function loadTf(): Promise<TfModule> {
  if (!tfModulePromise) {
    // Hide the specifier from Vite's static analyzer so builds without TF.js
    // installed don't fail at build time — only at actual call time.
    const specifier = "@tensorflow/tfjs";
    tfModulePromise = (
      import(/* @vite-ignore */ specifier) as Promise<TfModule>
    ).catch((err) => {
      throw new Error(
        "[cv] @tensorflow/tfjs is not installed. Run `pnpm -w add @tensorflow/tfjs` when you " +
          "have a trained model (see games/learnsign/TRAINING.md), or remove " +
          "`VITE_LEARNSIGN_BACKEND=landmark` to stay on the heuristic detector.\n" +
          String(err),
      );
    });
  }
  return tfModulePromise;
}

/**
 * Load a classifier and return an opaque handle. The generic parameters are
 * for documentation only — at runtime we accept anything the TF.js tensor
 * constructor understands and convert back via `.data()` for output.
 *
 * The current implementation supports `Float32Array` in / `Float32Array` out,
 * which covers every landmark-classifier use case we have today. Extend here
 * (image tensors, sequence inputs, multi-head outputs) as the need arises.
 */
export async function loadTfjsClassifier<
  TInput extends Float32Array | number[],
  TOutput extends Float32Array,
>(opts: TfjsModelHostOptions): Promise<TfjsClassifier<TInput, TOutput>> {
  const tf = await loadTf();

  // Pick the best available backend. `setBackend` returns false if the target
  // backend is unregistered or fails init; we bounce to WASM in that case.
  const preferred = opts.backend ?? "webgl";
  let backend = preferred;
  try {
    const ok = await tf.setBackend(preferred);
    if (!ok && preferred !== "wasm") {
      backend = "wasm";
      await tf.setBackend("wasm");
    }
  } catch {
    backend = "cpu";
    await tf.setBackend("cpu");
  }
  await tf.ready();

  // Prefer GraphModel (faster load, stricter ops) and fall back to LayersModel
  // automatically — both converters are common in practice.
  let model: TfModel;
  try {
    model = await tf.loadGraphModel(opts.modelUrl);
  } catch {
    model = await tf.loadLayersModel(opts.modelUrl);
  }

  console.info(
    "[cv] loaded TFJS classifier from %s (backend=%s)",
    opts.modelUrl,
    backend,
  );

  return {
    async predict(input: TInput): Promise<TOutput> {
      const inputArr =
        input instanceof Float32Array ? input : Float32Array.from(input);

      // tf.tidy disposes every intermediate tensor synchronously. We take the
      // result out as a plain TypedArray before `data()` which detaches us
      // from the tensor graph entirely.
      const outputTensor = tf.tidy((): TfTensor => {
        // Add a batch dimension: [len] -> [1, len]. Every classifier we ship
        // expects batched input; downstream callers shouldn't care.
        const t = tf.tensor(inputArr, [1, inputArr.length]);
        const out = model.predict(t);
        // Some models return an array of heads; take the first one.
        const head = Array.isArray(out) ? out[0] : out;
        if (!head) throw new Error("[cv] model produced no output tensor");
        return head;
      });

      const data = await outputTensor.data();
      outputTensor.dispose();
      return data as TOutput;
    },

    dispose(): void {
      model.dispose();
    },
  };
}
