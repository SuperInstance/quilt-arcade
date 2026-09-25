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
# NEGATIVE SPACE

Failures, walls, and declined climbs. Format: hypothesis / protocol / exact failure /
confidence / falsification condition (when to retry).

## 2026-09-25 — Porting z patch 12 (effectful fresh-by-default) verbatim to quilt main

- **Hypothesis:** effectful cells should re-evaluate by default; memoization opt-in (`memo: true`).
- **Protocol:** reconcile all 12 z patches against main post-#27/#28 before any port.
- **Exact failure/wall:** 11 of 12 patches were already landed on main (classes 1–11).
  Patch 12's default (re-run everything) is a real cost regression on fan-out sheets
  (main's 5k-fan-out push is 3–5ms *because* of memo-by-default). Verbatim port trades
  one wall (same-input stale cache) for another (unbounded re-evaluation cost).
- **Confidence:** high that a verbatim port is wrong; medium that the deps-version key
  alternative preserves both properties.
- **Falsification condition / when to retry:** if a quilt-main pin shows the fish-reset
  freeze (same caller+input, mutated unread state, stale verdict) is reachable even with
  class-7 invalidation active, escalate to the deps-version cache-key PR. Receipt:
  FAIL-first pin on main reproducing the freeze, then passing with the key change.

## 2026-09-25 — Trusting the vendored engine diff as "unknown fork"

- **Hypothesis:** arcade's `engine/` = main + unknown delta; refactor must diff everything.
- **Protocol:** site-by-site read of main's source for each of z's 12 claimed fixes.
- **Exact finding:** the delta is exactly one documented semantic difference (patch 12),
  not a fork. Recon-by-reading beat recon-by-diffing because the patches were described
  in PROVENANCE.md with file-level locations.
- **Confidence:** high.
- **When to retry:** re-run this reconcile after any main merge touching
  `engine.ts`, `cells/formula.ts`, `cells/ai.ts`, `cells/listener.ts`, or `context.ts`.
