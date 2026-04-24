import { describe, expect, it } from "vitest";
import {
  MissingFirebaseEnvError,
  readFirebaseConfigFromEnv,
} from "./env.js";

describe("readFirebaseConfigFromEnv", () => {
  it("returns null when every Firebase var is absent (offline profile)", () => {
    expect(readFirebaseConfigFromEnv({})).toBeNull();
    expect(
      readFirebaseConfigFromEnv({
        VITE_FIREBASE_API_KEY: "",
        VITE_FIREBASE_PROJECT_ID: "",
        VITE_FIREBASE_DATABASE_URL: "",
      }),
    ).toBeNull();
  });

  it("throws when some keys are filled but the required subset isn't", () => {
    expect(() =>
      readFirebaseConfigFromEnv({
        VITE_FIREBASE_API_KEY: "abc",
        VITE_FIREBASE_PROJECT_ID: "proj",
        // databaseURL missing — half-filled .env.local
      }),
    ).toThrow(MissingFirebaseEnvError);
  });

  it("returns a populated FirebaseConfig when the required fields are present", () => {
    const cfg = readFirebaseConfigFromEnv({
      VITE_FIREBASE_API_KEY: "k",
      VITE_FIREBASE_PROJECT_ID: "p",
      VITE_FIREBASE_DATABASE_URL: "https://x.firebaseio.com",
      VITE_FIREBASE_AUTH_DOMAIN: "p.firebaseapp.com",
    });
    expect(cfg).toEqual({
      apiKey: "k",
      projectId: "p",
      databaseURL: "https://x.firebaseio.com",
      authDomain: "p.firebaseapp.com",
      storageBucket: undefined,
      messagingSenderId: undefined,
      appId: undefined,
    });
  });

  it("surfaces the missing env var names, not the FirebaseConfig key names", () => {
    try {
      readFirebaseConfigFromEnv({
        VITE_FIREBASE_API_KEY: "a",
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingFirebaseEnvError);
      const missing = (err as MissingFirebaseEnvError).missing;
      expect(missing).toContain("VITE_FIREBASE_PROJECT_ID");
      expect(missing).toContain("VITE_FIREBASE_DATABASE_URL");
    }
  });
});
