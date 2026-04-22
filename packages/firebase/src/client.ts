/**
 * Singleton Firebase client for Pose Royale. The app calls {@link initFirebase} once at
 * startup with runtime config (usually sourced from Vite env vars). After that, the rest of
 * the platform imports {@link getRtdb} / {@link getFirebaseAuth} without threading the app
 * handle through every layer.
 */

import { initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";

export interface FirebaseConfig extends FirebaseOptions {
  /** Required for Pose Royale — plan §5. */
  databaseURL: string;
}

interface ClientBundle {
  app: FirebaseApp;
  auth: Auth;
  rtdb: Database;
}

let bundle: ClientBundle | null = null;

export function initFirebase(config: FirebaseConfig): ClientBundle {
  if (bundle) return bundle;
  const app = initializeApp(config, "pose-royale");
  const auth = getAuth(app);
  const rtdb = getDatabase(app);
  bundle = { app, auth, rtdb };
  return bundle;
}

export function isInitialized(): boolean {
  return bundle !== null;
}

export function getFirebaseApp(): FirebaseApp {
  if (!bundle) throw new Error("initFirebase() must be called first.");
  return bundle.app;
}

export function getFirebaseAuth(): Auth {
  if (!bundle) throw new Error("initFirebase() must be called first.");
  return bundle.auth;
}

export function getRtdb(): Database {
  if (!bundle) throw new Error("initFirebase() must be called first.");
  return bundle.rtdb;
}

/**
 * Testing-only: reset the singleton between test runs. Do not call in production code.
 * @internal
 */
export function __resetFirebaseClient(): void {
  bundle = null;
}
