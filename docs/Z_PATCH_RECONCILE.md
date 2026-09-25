# Z-Patch Reconciliation vs quilt main (2026-09-25)

Lane: reconcile Super Z's 12 playtest engine patches (worklog Tasks 2–9; PROVENANCE.md)
against `SuperInstance/quilt` main **after** the playtest-class merges (PR #27, #28).
Method: read main's source at each claimed fix site; no rebuild, no re-run — coverage
is established by code presence plus the failing→passing pins each class carries.

## Verdict: 11 of 12 already landed on main

| z patch | main evidence | Status |
|---|---|---|
| 1 listener `watch` wired into dep graph | `engine.ts` class-1 commit `ce390f8` | ✅ landed |
| 2 value-cell get() live read | class-2 `7d3ea1b` (value case returns live `cell.value`) | ✅ landed |
| 3 eager recompute + true prev | class-3 `ae6b739` (opt-in `eager`, prev threaded) | ✅ landed |
| 4 fresh event context per listener fire | `cells/listener.ts` "invoked with a FRESH event context on every fire" | ✅ landed |
| 5 set/push thread real prev into propagate | folded into class-3 prev-source work | ✅ landed |
| 6 value-cell stale read (pull path) | covered by class-2 (see z's own notes: class-2 ↔ patch 6 family) | ✅ landed |
| 7 `contains` sugar on dotted paths | class-6 `66b4ef6` | ✅ landed |
| 8 ai schema whitelist passthrough | `cells/ai.ts` HANDLED/passthrough block (primitive+array rule) | ✅ landed |
| 9 evaluateFormula persists cell.value | `cells/formula.ts` line ~204 `cell.value = value` | ✅ landed |
| 10 callKey includes stableJson(input) | class-10 `8fb4225` ("PLAY-TEST PATCH 10" in engine.ts) | ✅ landed |
| 11 context-bound program runtime | class-11 `8fb4225` | ✅ landed |
| **12 effectful fresh-by-default; `memo: true` opt-in** | **absent — main still memoizes effectful cells per (contextKey) forever, invalidated only by class-7 propagate** | ❌ **NOT landed** |

## The one real divergence: patch 12

z's hold'em sheet found it: `callKey` = caller + input **cannot see sheet state**, so a
repeated `(caller, input)` pair (fish calling `{seq:1}` after `match.seq` reset) was served
a stale cached verdict — the table froze permanently. Patch 12's claim: *a program is a
function of its arguments AND of the cells it reads; the engine must not pretend otherwise.*

Main's counter-design (classes 7+10): invalidate on propagate + include input in the key.
That fixes upstream-set invalidation and distinct-input honesty, **but not same-input-state-change**:
identical input against mutated unread-by-key state still serves cache on main.

Honest assessment:
- Cost axis — main's default is cheap (memoized everything); patch 12's default re-runs
  every effectful cell on every call unless the sheet author opts in with `memo: true`.
  On hold'em (124 cells) the re-run cost is invisible; on 5k-fan-out sheets it is not.
- Correctness axis — patch 12 is strictly more honest; main trusts sheet authors to
  invalidate, which z's own arcade build showed is exactly the failure humans miss.
- Reconcile recommendation: **do NOT blind-port.** Main should adopt a *narrower* form:
  include a cell's declared `deps` state version in the effectful cache key (fresh when
  read-set changed, cached when not). That gets patch-12 correctness with main's cost
  profile, and it is a quilt-main PR, not an arcade patch. Logged as the arcade's first
  NEGATIVE_SPACE entry (a wall we declined to climb as-written, with the welded alternative
  specced).

## Also reconciled (z's documented do-NOT-patch gaps)
- P7 NaN flows silently — still a documented gap on main (z: do not patch).
- P10 set-throws vs get-returns-error asymmetry — documented gap, do not patch.
- Per-input memoization for formulas (contextKey excludes input) — class-10 covers
  program *calls*; formula memoization remains context-only on both sides. Do not patch
  without a design (z's own finding).

## What this unlocks
- The arcade's vendored `engine/` (patches 1–12) and quilt main are now **semantically
  aligned except on patch 12** — the modular-refactor lane can treat the vendored engine
  as main + one documented delta instead of an unknown fork.
- Next lane per constitution: modular plugin refactor, then playtest gates, then
  front-door link (SuperInstance/SuperInstance PR #23).

Referral edges: this changes how you evaluate `quilt/packages/core` cache policy
(deps-version key proposal) — receipt that would verify: a main PR whose pin repeats
z's fish-reset freeze FAIL-first, then passes with the deps-version key.
