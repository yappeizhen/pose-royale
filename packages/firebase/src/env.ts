/**
 * Environment → FirebaseConfig plumbing.
 *
 * Vite's env system is a little quirky: `import.meta.env.VITE_FOO` is replaced
 * at *build time* via literal string substitution. Computed lookups like
 * `env[key]` won't be inlined, so we have to reference each variable by name.
 * That's why this file looks repetitive — each key has to be named explicitly.
 *
 * This helper intentionally lives in `@pose-royale/firebase` (not in the app)
 * so any caller that has Firebase as a dependency — tests, CLI tools, future
 * server-rendered shells — can share the same config shape.
 */

import type { FirebaseConfig } from "./client.js";

export class MissingFirebaseEnvError extends Error {
  constructor(public readonly missing: readonly string[]) {
    super(
      `Missing required Firebase env vars: ${missing.join(", ")}. ` +
        `Copy apps/web/.env.example to apps/web/.env.local and fill them in.`,
    );
    this.name = "MissingFirebaseEnvError";
  }
}

/**
 * Read VITE_FIREBASE_* vars from an env object (usually `import.meta.env`).
 * Returns `null` when *all* Firebase vars are missing — this is the "local/solo
 * dev without networking" case and the caller should just skip init. Throws
 * {@link MissingFirebaseEnvError} when some keys are present but others are
 * missing — that almost always means a half-filled `.env.local` and we want
 * loud failure rather than a confusing runtime crash inside Firebase.
 */
export function readFirebaseConfigFromEnv(
  env: Record<string, string | undefined>,
): FirebaseConfig | null {
  const raw = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    databaseURL: env.VITE_FIREBASE_DATABASE_URL,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };

  // Absence check uses "empty or undefined" — dotenv treats `KEY=` as an empty
  // string, and an empty string is never a valid Firebase identifier. If every
  // single value is empty we're clearly in an offline/local profile.
  const anyPresent = Object.values(raw).some((v) => v && v.length > 0);
  if (!anyPresent) return null;

  // Required subset for Pose Royale. databaseURL is load-bearing (we use RTDB
  // for room state + signaling); apiKey + projectId are needed for Auth calls
  // even in anonymous mode.
  const required = ["apiKey", "projectId", "databaseURL"] as const;
  const missing = required.filter((k) => !raw[k]).map((k) => envNameFor(k));
  if (missing.length > 0) throw new MissingFirebaseEnvError(missing);

  return {
    apiKey: raw.apiKey!,
    authDomain: raw.authDomain || undefined,
    projectId: raw.projectId!,
    databaseURL: raw.databaseURL!,
    storageBucket: raw.storageBucket || undefined,
    messagingSenderId: raw.messagingSenderId || undefined,
    appId: raw.appId || undefined,
  } as FirebaseConfig;
}

function envNameFor(key: keyof FirebaseConfig): string {
  switch (key) {
    case "apiKey":
      return "VITE_FIREBASE_API_KEY";
    case "authDomain":
      return "VITE_FIREBASE_AUTH_DOMAIN";
    case "projectId":
      return "VITE_FIREBASE_PROJECT_ID";
    case "databaseURL":
      return "VITE_FIREBASE_DATABASE_URL";
    case "storageBucket":
      return "VITE_FIREBASE_STORAGE_BUCKET";
    case "messagingSenderId":
      return "VITE_FIREBASE_MESSAGING_SENDER_ID";
    case "appId":
      return "VITE_FIREBASE_APP_ID";
    default:
      return String(key);
  }
}
