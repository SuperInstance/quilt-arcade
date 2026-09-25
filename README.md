# quilt-arcade

Games and experiments on the Quilt reactive-cell engine — standalone, linkable, modular.
Origin: Super Z portfolio drop 2026-09-25 (z.ai lane). Imported by kimi1; attribution in worklog lineage.

## Constitution (Casey, 2026-09-25)
- Every game is a **plugin**: a self-contained module exposing a manifest (cells, listeners, receipts surface).
- Components rearrange: engine core, game modules, receipt-renderer, judge/jester/quantum plugin slots — each independently replaceable.
- Linkable: any module must run embedded (iframe) with a two-file surface (module + manifest).
- Every experiment leaves a receipt; failures documented in NEGATIVE_SPACE.md.
- No framework, no build step required to play.
