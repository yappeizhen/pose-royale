# Games

Each folder in here is a **workspace package** that exports a `GameModule` from `@pose-royale/sdk`. The platform shell knows nothing about it beyond what the manifest declares.

## Current games

| Folder        | Package                        | Status    |
| ------------- | ------------------------------ | --------- |
| `frootninja/` | `@pose-royale/game-frootninja` | Shipping  |
| `ponghub/`    | `@pose-royale/game-ponghub`    | Shipping  |

## Scaffold a new game

From the repo root:

```bash
pnpm create-game <kebab-id> --name "Display Name"
```

Add `--list` to preview the files without writing. The scaffolder creates `games/<id>/` with a working GameModule stub (canvas, hand-tracker subscription, RAF loop, score emission, clean destroy) and prints the snippets to register it. After running it:

1. Add `"@pose-royale/game-<id>": "workspace:*"` to `apps/web/package.json` dependencies.
2. In `apps/web/src/tournament/registry.ts`:
   ```ts
   import { manifest as m } from "@pose-royale/game-<id>";
   { id: m.id, manifest: m, load: () => import("@pose-royale/game-<id>") },
   ```
3. `pnpm install` to link the workspace.
4. Replace the stub render loop in `src/index.ts` with your gameplay.

Target: **a brand-new minigame integrates in under a day** once the scaffolder runs.

## Porting / authoring checklist

1. **Manifest** — export a `GameManifest` with required fields:
   - `id`, `name`, `shortDescription`, `version`
   - `preferredDurationSec`, `minPlayers`, `maxPlayers`
   - `cvRequires` (e.g. `["hands"]`)
   - `scoring` (e.g. `"cumulative"`)
   - `par` — raw score that maps to a full 1000 tournament points (plan §1).
   - `demo.previewUrl` — short looping mp4/webm or `.lottie` (≤5 MB), shown in the lobby for 60s or until Skip.
   - `demo.howToPlay` — one-liner.
   - `demo.controls` — array of `{ icon, label }` control hints.
2. **Implement `GameModule`** — export a `mount(el, ctx): GameInstance` function.
3. **Follow the rules** (enforced by ESLint + leak tests):
   - No direct `navigator.mediaDevices.getUserMedia` — use `ctx.hands`.
   - No direct `firebase` imports — use `ctx.net` if you need sync.
   - No imports from `@pose-royale/firebase` or `@pose-royale/multiplayer`.
   - All randomness goes through `ctx.rng` so both peers stay deterministic.
   - All time-based logic uses `deltaTime`, never frame count.
   - `destroy()` must leave the DOM, WebGL contexts, RAF loops, and listeners clean — the mount→destroy→mount→destroy leak test is CI-enforced.
   - `emitScore({ raw, label? })` — pass game-native `raw` values; the SDK normalizes against `manifest.par`.
4. **Optional: online sync** — in 2P matches `ctx.net` is a `RoomChannel`. Use it to broadcast per-player score or gameplay events:
   ```ts
   ctx.net?.set(`score_${ctx.localPlayerId}`, raw);
   ctx.net?.subscribe(`score_${remoteId}`, (v) => {...});
   ```
   Keys are automatically namespaced under `rooms/<id>/gameState/<gameId>/<key>`.
5. **Register** the game in `apps/web/src/tournament/registry.ts` (single line).
6. **Ship** — the orchestrator handles lobby integration, transitions, scoring, and leaderboards.
