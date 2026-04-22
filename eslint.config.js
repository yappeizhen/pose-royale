// Root ESLint config (flat config). Shared by all workspaces.
// Enforces two project-wide invariants the plan calls out:
//   1. Code under games/* must NOT call navigator.mediaDevices.getUserMedia directly.
//   2. Code under games/* must NOT import firebase/* directly.
// Both should only be reached through the SDK handles in ctx.hands / ctx.net.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "apps/web/public/mediapipe/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Game-package invariants: no direct camera or firebase access.
  {
    files: ["games/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Block any direct getUserMedia member call shape in games/*.
          // This catches navigator.mediaDevices.getUserMedia(...), optional chains,
          // and common aliases like mediaDevices.getUserMedia(...).
          selector: "CallExpression:matches([callee.property.name='getUserMedia'], [callee.expression.property.name='getUserMedia'])",
          message:
            "Games must not call navigator.mediaDevices.getUserMedia directly. Use ctx.hands from @pose-royale/sdk.",
        },
        {
          selector:
            "VariableDeclarator[id.type='ObjectPattern'][id.properties.0.key.name='getUserMedia']",
          message:
            "Games must not destructure getUserMedia from mediaDevices. Use ctx.hands from @pose-royale/sdk.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["firebase", "firebase/*", "@firebase/*"],
              message:
                "Games must not import firebase directly. Use ctx.net from @pose-royale/sdk.",
            },
            {
              group: ["@pose-royale/firebase", "@pose-royale/multiplayer"],
              message:
                "Games must not import platform multiplayer/firebase packages. Use ctx.net from @pose-royale/sdk.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
