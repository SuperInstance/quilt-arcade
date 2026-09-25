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
