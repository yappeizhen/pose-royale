/**
 * ICE server resolution for the opponent video bubble.
 *
 * NAT traversal quick reference (for the next person debugging this):
 *   • STUN-only         → works for ~80% of home networks where at least one
 *                         peer has an endpoint-independent NAT mapping.
 *   • STUN + TURN       → catches symmetric NATs, corporate firewalls, and
 *                         carrier-grade NAT'd mobile clients. TURN bandwidth
 *                         is metered, so we prefer STUN when we can.
 *   • TURN(S) over 443  → the "last resort" path that tunnels media inside
 *                         TLS to port 443. Expensive, slow, but punches
 *                         through basically anything short of DPI.
 *
 * This module supports two TURN configurations:
 *
 *   1. Metered dynamic credentials (their recommended pattern). We hit
 *      `https://<subdomain>.metered.live/api/v1/turn/credentials?apiKey=<key>`
 *      per session — the response contains short-lived creds that expire in a
 *      few hours, so a leaked bundle stops working quickly.
 *
 *   2. Static creds from env — paste the Metered dashboard "static credentials"
 *      block once and rotate manually.
 *
 * We always prepend Google's public STUN servers so connections can short-
 * circuit without hitting TURN at all when the network allows it.
 */

export interface IceConfig {
  /**
   * Metered TURN dynamic-credentials endpoint config. When both values are
   * present, {@link loadIceServers} will fetch fresh creds before returning.
   */
  metered?: {
    subdomain: string;
    apiKey: string;
  };
  /**
   * Static TURN servers. Usually one entry with multiple `urls` — the browser
   * tries each URL in order and uses the first one that succeeds.
   */
  staticTurn?: RTCIceServer[];
}

const GOOGLE_STUN: RTCIceServer = {
  urls: [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
  ],
};

/**
 * Resolve the full ICE server list. Always returns at least STUN, even on
 * network failures — a partially-degraded connection is better than none.
 *
 * @param signal — optional AbortSignal for timing out the Metered fetch. The
 *   credential endpoint is normally <100 ms, but we don't want a slow/hung
 *   network call to delay match start. Suggested: 3 s budget.
 */
export async function loadIceServers(
  config: IceConfig,
  signal?: AbortSignal,
): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [GOOGLE_STUN];

  if (config.staticTurn && config.staticTurn.length > 0) {
    servers.push(...config.staticTurn);
  }

  if (config.metered) {
    try {
      const fetched = await fetchMeteredCredentials(config.metered, signal);
      servers.push(...fetched);
    } catch (err) {
      console.warn(
        "[multiplayer] Metered TURN credential fetch failed; falling back to STUN/static only",
        err,
      );
    }
  }

  return servers;
}

/**
 * Read ICE config from a Vite-style env object (usually `import.meta.env`).
 * Returns `{}` when no TURN vars are set — callers should treat that as
 * "STUN only" and carry on. See `apps/web/.env.example` for the var names.
 */
export function readIceConfigFromEnv(
  env: Record<string, string | undefined>,
): IceConfig {
  const cfg: IceConfig = {};

  const subdomain = env.VITE_METERED_SUBDOMAIN?.trim();
  const apiKey = env.VITE_METERED_API_KEY?.trim();
  if (subdomain && apiKey) {
    cfg.metered = { subdomain, apiKey };
  }

  const urlsRaw = env.VITE_TURN_URLS?.trim();
  const username = env.VITE_TURN_USERNAME?.trim();
  const credential = env.VITE_TURN_CREDENTIAL?.trim();
  if (urlsRaw) {
    const urls = urlsRaw
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (urls.length > 0) {
      const entry: RTCIceServer = { urls };
      // Static creds are optional — the Metered "free" plan exposes some
      // relays without auth. If one is supplied, both should be.
      if (username && credential) {
        entry.username = username;
        entry.credential = credential;
      }
      cfg.staticTurn = [entry];
    }
  }

  return cfg;
}

interface MeteredCredential {
  urls: string | string[];
  username?: string;
  credential?: string;
}

async function fetchMeteredCredentials(
  meta: { subdomain: string; apiKey: string },
  signal?: AbortSignal,
): Promise<RTCIceServer[]> {
  const url =
    `https://${encodeURIComponent(meta.subdomain)}.metered.live` +
    `/api/v1/turn/credentials?apiKey=${encodeURIComponent(meta.apiKey)}`;

  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) {
    throw new Error(`Metered credentials endpoint returned ${res.status}`);
  }
  const body = (await res.json()) as MeteredCredential[];
  if (!Array.isArray(body)) {
    throw new Error("Metered credentials endpoint returned non-array payload");
  }
  return body
    .filter((entry) => entry && entry.urls)
    .map((entry) => {
      const server: RTCIceServer = { urls: entry.urls };
      if (entry.username) server.username = entry.username;
      if (entry.credential) server.credential = entry.credential;
      return server;
    });
}
