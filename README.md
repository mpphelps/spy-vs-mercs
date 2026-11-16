# Spy vs Mercs — Operation Kolybel

**[▶ Play in your browser](https://mpphelps.github.io/spy-vs-mercs/)** (desktop Chrome / Edge / Firefox, mouse + keyboard)

N64-style (GoldenEye / Perfect Dark) stealth-action FPS with PC tactical controls, built with
TypeScript + Three.js. Every texture and sound is generated procedurally at startup — there are no asset files.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (pushes to main auto-deploy to GitHub Pages)
```

Debug URL flags: `?autostart&diff=0|1|2` (skip menus), `&nolock` (no pointer lock), `&god=1`, `&debug`.

## Controls

| Key | Action |
| --- | --- |
| WASD / Mouse | Move / look |
| Shift | Sprint |
| X | Toggle walk (quiet footsteps) |
| C | Crouch — while sprinting: slide |
| Z | Prone (crawl through the culvert) |
| Q / E | Lean left / right (only your head is exposed) |
| Space | Jump / mantle onto ledges |
| LMB / RMB | Fire / aim down sights (VS-9 has a scope) |
| R | Reload |
| V | Melee — silent takedown from behind |
| F | Use / open doors (hold on consoles) |
| G / T | Frag grenade / noisemaker (lure guards) |
| N | Night vision |
| 1–6, wheel | Weapons |
| Tab | Objectives |
| Esc | Pause |

## Difficulty

| | Operative | Agent | Ghost |
| --- | --- | --- | --- |
| Objectives | Steal prototype, extract | + sabotage comms, download data, ≤2 civilian deaths | + recover contract intel, no civilian deaths, max one alarm |
| Enemy tactics | Stand and shoot, charge | Cover, peeking, alarm runs, grenades, body discovery, flashlights | Squad roles (suppress / flank / assault), suppressive fire, retreat when hurt, longer hunts, snipers |
| Enemy count | 22 | ~36 | ~41 |

All tuning lives in `src/game/difficulty.ts`.

## Code map

- `src/core` — renderer + post FX (bloom, night vision, grade), input, procedural audio, procedural textures
- `src/world` — AABB physics + raycasts, level builder, auto-generated nav grid (A*), weather, **`facility.ts` (the mission layout)**
- `src/game` — player, weapons/viewmodels, AI + squad director, entities (doors, cameras, alarm panels, pickups, heli), FX, mission/objectives
- `src/ui` — HUD and menus
- `tools/*.mjs` — headless Playwright checks (`node tools/play.mjs 1` runs a scripted playthrough; needs the dev server and Chrome)

## Adding a mission

Add a `MissionDef` in `src/game/mission.ts` (set `available: true`) and a builder like `buildFacility()` that uses the
`Level` helpers (`building`, `wallX/wallZ`, `stairs`, `light`) and the `Game` helpers (`addDoor`, `addPickup`,
`addInteract`, `addCamera`, `addPanel`) and returns spawns + start/extraction points.
