# Pose Royale

A browser-based Bishi-Bashi-style tournament platform for CV-driven minigames. Two players on their own devices play a randomized 3-game gauntlet (30s each), their webcams are the playfield, and the highest cumulative score wins.

## Stack

- **Monorepo** — pnpm workspaces (no Turborepo yet — `pnpm -r` is plenty).
- **App** — Vite + React 19 + TypeScript (`apps/web`).
- **CV** — MediaPipe Tasks Vision (self-hosted WASM) + optional TFJS classifiers.
- **Multiplayer** — Firebase RTDB for state + WebRTC for webcam feeds.
- **State** — Zustand.
- **Games** — Each game is a workspace package in `games/*` implementing the `GameModule` contract from `@pose-royale/sdk`.

## Layout

```
pose-royale/
├── apps/
│   └── web/                    # Platform shell + tournament orchestrator
├── packages/
│   ├── sdk/                    # Game contract (GameModule, GameContext, ScoreEvent, ...)
│   ├── cv/                     # Shared MediaPipe hand tracker + TFJS model host
│   ├── multiplayer/            # Firebase RTDB rooms + WebRTC signaling
│   ├── ui/                     # BackButton, CameraGate, OpponentBubble, HUD, ...
│   ├── state/                  # Shared Zustand stores
│   └── firebase/               # Initialized Firebase SDK + typed schema helpers
└── games/
    ├── frootninja/
    └── ponghub/
```

## Getting started

Requires **Node ≥ 20** and **pnpm ≥ 9**.

```bash
pnpm install
pnpm dev                # runs apps/web (default port 5173)
```

### Scripts

| Script            | What it does                                     |
| ----------------- | ------------------------------------------------ |
| `pnpm dev`        | Run the web app in dev mode                      |
| `pnpm build`      | Build all packages then the web app              |
| `pnpm lint`       | Lint every workspace                             |
| `pnpm test`       | Run Vitest across every workspace                |
| `pnpm typecheck`  | `tsc --noEmit` across every workspace            |
| `pnpm format`     | Prettier write                                   |

## Adding a new game

See `games/README.md` for the porting checklist. TL;DR: scaffold a package that exports a `GameModule` from `@pose-royale/sdk`, register it in `apps/web/src/tournament/registry.ts`, done.

## Tournament rules (v1)

- Gauntlet = 3 minigames × 30s each (config in `apps/web/src/tournament/config.ts`).
- Setlist is seeded-random on both peers; no back-to-back repeats.
- Per-round score: `round(1000 * clamp(raw / manifest.par, 0, 1))`. Max 3000 cumulative.
- Tie → sudden-death single random 15s game. Still tied → draw.
- Opponent disconnect → 15s pause overlay, then auto-0 remaining rounds, present player wins.
