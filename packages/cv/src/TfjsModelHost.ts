/**
 * TFJS model host — stub for now. LearnSign ships a TensorFlow.js classifier that we want to
 * expose to any future CV game as a generic handle (plan §2, §8).
 *
 * The concrete implementation lands with LearnSign's port. Keeping the interface here so the
 * SDK surface is stable and games can program against it early.
 */

export interface TfjsClassifier<TInput, TOutput> {
  /** Runs inference. Implementations own tensor lifecycles; callers receive plain data. */
  predict(input: TInput): Promise<TOutput>;
  /** Release GPU/WASM resources. Safe to call more than once. */
  dispose(): void;
}

export interface TfjsModelHostOptions {
  /** URL of the `model.json` produced by `tensorflowjs_converter`. */
  modelUrl: string;
  /**
   * Preferred backend ('webgl' | 'webgpu' | 'wasm' | 'cpu'). Default 'webgl'.
   * Callers should fall back to 'wasm' if webgl init fails.
   */
  backend?: "webgl" | "webgpu" | "wasm" | "cpu";
}

/**
 * Placeholder — returns a classifier stub that throws until LearnSign is ported. Exposing the
 * shape lets the rest of the platform (game manifests, registry, types) assume a host exists.
 */
export async function loadTfjsClassifier<TInput, TOutput>(
  _opts: TfjsModelHostOptions,
): Promise<TfjsClassifier<TInput, TOutput>> {
  return {
    predict: async () => {
      throw new Error(
        "[cv] TfjsModelHost is not implemented yet — will ship with LearnSign (see plan §8).",
      );
    },
    dispose: () => {},
  };
}
