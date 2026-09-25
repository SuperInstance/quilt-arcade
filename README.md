# quilt-arcade

Games and experiments on the Quilt reactive-cell engine — standalone, linkable, modular.
Origin: Super Z portfolio drop 2026-09-25 (z.ai lane). Imported by kimi1; attribution in worklog lineage.

## Constitution (Casey, 2026-09-25)
- Every game is a **plugin**: a self-contained module exposing a manifest (cells, listeners, receipts surface).
- Components rearrange: engine core, game modules, receipt-renderer, judge/jester/quantum plugin slots — each independently replaceable.
- Linkable: any module must run embedded (iframe) with a two-file surface (module + manifest).
- Every experiment leaves a receipt; failures documented in NEGATIVE_SPACE.md.
- No framework, no build step required to play.

## The plugin surface (implemented 2026-09-25, branch modular-plugins)

Each game is two files — the whole linkable surface:

| file | role |
|------|------|
| `games/<g>/manifest.json` | declarations: cells, listeners, receipts surface (sources + fnv1a64 fields), deps, slots |
| `games/<g>/module.mjs`    | behavior: `id`, `buildSheet()`, `createDriver(engine)`, `smoke(engine)`, `slots`, `receipts` |

- **No cross-imports between game modules.** Games talk to the engine core
  (`engine/`) and the shared platform (`shared/`: kit, driver, viewer,
  receipts) only. Swap any block — engine core, a game module, the
  receipt-renderer, a slot — without touching the others.
- **Slots** (`slots/`): judge (JEV), jester, quantum (MOTH/MicroMoth),
  predictor (JEPA) — interfaces now, implementations later. Credentials,
  when needed, come from env vars (`QUILT_SLOT_*_KEY`); none are
  configured yet, and every game must stay fully playable with all slots
  returning null.
- **Receipts** (`shared/receipts.mjs`): the one renderer every plugin
  mounts. Human-readable lines; chained sources carry an fnv1a64 hash
  chain from GENESIS and the panel shows a chain-verification badge.
- **Headless smoke**: `node run_all.mjs` Phase A loads every plugin under
  a stub DOM, validates manifest ≡ buildSheet(), boots it, runs its own
  `smoke()` interaction and asserts ≥1 receipt (chains re-derived). It
  failed on all five games before this refactor — pins first, code
  second. Phase B runs the full playtest harnesses (behavior-preserving).
- **Embedding**: `games/<g>/index.html` is the zero-build iframe surface
  (single-file bundle, unchanged by this refactor).
