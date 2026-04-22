import { describe, expect, it } from "vitest";
import { classifyPresence } from "./presence.js";

describe("classifyPresence", () => {
  it("marks recent-heartbeat connected players as present", () => {
    const result = classifyPresence(
      {
        a: { connected: true, lastHeartbeatAt: 1000 },
        b: { connected: true, lastHeartbeatAt: 9000 },
      },
      10_000,
      5_000,
    );
    expect(result.a).toBe("stale");
    expect(result.b).toBe("present");
  });

  it("marks disconnected players as offline regardless of heartbeat", () => {
    const result = classifyPresence(
      {
        a: { connected: false, lastHeartbeatAt: 9999 },
      },
      10_000,
    );
    expect(result.a).toBe("offline");
  });

  it("uses the supplied grace window", () => {
    const result = classifyPresence(
      { a: { connected: true, lastHeartbeatAt: 100 } },
      10_000,
      20_000,
    );
    expect(result.a).toBe("present");
  });

  it("treats missing heartbeat timestamps as age=now", () => {
    const result = classifyPresence(
      { a: { connected: true, lastHeartbeatAt: null } },
      10_000,
      5_000,
    );
    expect(result.a).toBe("stale");
  });
});
