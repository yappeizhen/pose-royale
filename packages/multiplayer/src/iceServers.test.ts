import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadIceServers, readIceConfigFromEnv } from "./iceServers.js";

describe("readIceConfigFromEnv", () => {
  it("returns empty config when no TURN vars are set", () => {
    expect(readIceConfigFromEnv({})).toEqual({});
  });

  it("picks up Metered dynamic-credentials config", () => {
    const cfg = readIceConfigFromEnv({
      VITE_METERED_SUBDOMAIN: "poseroyale",
      VITE_METERED_API_KEY: "key-123",
    });
    expect(cfg.metered).toEqual({ subdomain: "poseroyale", apiKey: "key-123" });
  });

  it("ignores half-filled Metered config", () => {
    expect(
      readIceConfigFromEnv({ VITE_METERED_SUBDOMAIN: "x" }).metered,
    ).toBeUndefined();
    expect(
      readIceConfigFromEnv({ VITE_METERED_API_KEY: "y" }).metered,
    ).toBeUndefined();
  });

  it("splits comma-separated static TURN URLs and attaches creds", () => {
    const cfg = readIceConfigFromEnv({
      VITE_TURN_URLS:
        "turn:a.example.com:80, turn:a.example.com:443?transport=tcp",
      VITE_TURN_USERNAME: "alice",
      VITE_TURN_CREDENTIAL: "secret",
    });
    expect(cfg.staticTurn).toEqual([
      {
        urls: ["turn:a.example.com:80", "turn:a.example.com:443?transport=tcp"],
        username: "alice",
        credential: "secret",
      },
    ]);
  });

  it("allows static URLs without creds (free-tier relays)", () => {
    const cfg = readIceConfigFromEnv({
      VITE_TURN_URLS: "turn:open.example.com:3478",
    });
    expect(cfg.staticTurn).toEqual([
      { urls: ["turn:open.example.com:3478"] },
    ]);
  });
});

describe("loadIceServers", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("always returns STUN, even with an empty config", async () => {
    const servers = await loadIceServers({});
    expect(servers[0]?.urls).toContain("stun:stun.l.google.com:19302");
  });

  it("appends static TURN servers verbatim", async () => {
    const servers = await loadIceServers({
      staticTurn: [{ urls: ["turn:x.example.com:3478"], username: "u", credential: "c" }],
    });
    expect(servers).toContainEqual({
      urls: ["turn:x.example.com:3478"],
      username: "u",
      credential: "c",
    });
  });

  it("fetches Metered creds and includes them alongside STUN", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            urls: "turn:global.turn.metered.ca:80",
            username: "u1",
            credential: "c1",
          },
        ]),
    });
    const servers = await loadIceServers({
      metered: { subdomain: "sub", apiKey: "k" },
    });
    expect(servers.some((s) => s.username === "u1")).toBe(true);
  });

  it("degrades gracefully when Metered fetch fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network"),
    );
    const servers = await loadIceServers({
      metered: { subdomain: "sub", apiKey: "k" },
    });
    // Still returns STUN — caller can still attempt a direct connection.
    expect(servers).toHaveLength(1);
    expect(servers[0]?.urls).toContain("stun:stun.l.google.com:19302");
  });
});
