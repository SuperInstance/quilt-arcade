# NEGATIVE SPACE — what broke, what was refused, what was cut

Constitution rule: failures documented. Newest first.

## 2026-09-25 — modular-plugins refactor

- **FAIL-first pin (kept honest):** the upgraded `run_all.mjs` Phase A
  failed on all 5 games (`no manifest.json — not a plugin yet`) before any
  plugin file existed. Commit `e38a0db` records the red state; commit
  `3cca42b` turned it green. The gate ran before the refactor code, per
  the constitution's pins-first rule.
- **Tictactoe has no witness chain — refused to fake one.** The learning
  games book fnv1a64-chained receipts via `learn.update`; tictactoe has no
  learning loop, only the `log.events` audit trail. Its manifest declares
  `chained: false` rather than bolting on a chain-shaped cell it never
  earned. When tictactoe grows a learner, the manifest flips to chained
  and Phase A starts verifying it — no runner change needed.
- **Holdem's first `learn.update` books no receipt (by design).** It only
  baselines the seat's stack; the second call writes receipt #1. The
  holdem `smoke()` therefore plays two hands, not one, so both learner
  chains carry ≥1 link. Documented here so nobody \"fixes\" the learner.
- **Cut: driver duplication between viewer and module.** The four grid
  viewers and the holdem viewer each defined their driver config inline;
  that code now lives once in `games/<g>/module.mjs`. Viewers are thin
  entries (wire engine → shared viewer → receipts panel). The
  pre-refactor inline copies are the only code deleted.
- **Cut: nothing else.** `sheet.mjs`, `play.mjs`, `engine/`, `shared/kit.mjs`,
  `shared/driver.mjs` are untouched — 55/55 play checks green across all
  five games after the refactor, same as before.
- **Known rough edge:** the committed `index.html` bundles predate the
  module split. They still run (they inline the old viewer code), but a
  rebuild from the new sources would pull drivers from `module.mjs` and
  mount the receipts panel. No build script ships in this repo, so the
  rebuild is manual for now — flagged, not hidden.
