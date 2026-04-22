/**
 * HandTracker exposes a HandTrackerHandle-compatible surface. We can't meaningfully run the
 * MediaPipe bridge in jsdom (it needs WebGL + video decode), but we can verify the TS surface
 * compiles against the SDK contract by shape-checking at the type level.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { HandTrackerHandle } from "@pose-royale/sdk";
import { HandTracker } from "./HandTracker.js";

describe("HandTracker type surface", () => {
  it("conforms to HandTrackerHandle", () => {
    expectTypeOf<HandTracker>().toMatchTypeOf<HandTrackerHandle>();
  });
});
