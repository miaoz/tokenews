# Reviewed subscription quota estimates

This layer supplements upstream without editing it. `current.json` is the reviewed
manifest; `evidence-*.json` records source observations, calculations, assumptions
and rejected alternatives. `scripts/lib/subscription-estimates.mjs` validates the
manifest, archives specified old points unchanged, removes only their active
mappings, and creates explicitly estimated subscription points. It fails for
changed archive identity/date/values, newly available upstream plan-alias samples,
duplicate point or plan/model, changed conventions,
or unreviewed calibration fields. A new upstream sample requires review, not silent
overwrite. Downloads retain original upstream data and the superseded archive.

## Fable 5.2, reviewed November 13, 2026

[Independent Max audit, fixed revision](https://github.com/plei99/plei99.github.io/blob/e6eee19e031ba3ecba375cfd06c1205877f6154e/research/fable-allowance-2026-11-10.md).
The source publishes an author audit, not the private logs. We checked the public
method and arithmetic; this is not our own account measurement. Pool its two
November 10 intervals instead of choosing the more optimistic normal-only result.

```text
Max: ($41.8921884 + $38.4929796) / 0.27 × 4 weeks = $1190.8913778 API-equivalent
Anthropic comparison mix: .97 × $.20 + .025 × $10 + .005 × $40 = $.644 / MTok
Normalized month: 1849.210214 MTok; $100 / month => $.05407714 / MTok
Ultra: official 10x-Pro weekly limit / Max 5x-Pro = 2x; $200 / month
Normalized month: 3698.420428 MTok; same $.05407714 / MTok
```

These are normalized comparison tokens, not raw measured tokens or cash credits.
The Fable-specific weekly submeter already incorporates its 50% allocation; do
not halve it again. Max is medium confidence; Ultra is low confidence and not
directly measured. Exclude one-time resets and separate Console credits.
The adverse 28-point sensitivity is $.05608/MTok, not a confidence interval.
Changing workload, integer meters, cross-plan charging and five-hour windows
limit transferability. Source-scenario variation is larger than rounding.

Pro's temporary launch-week point is not a permanent allowance. Its original
782M estimate remains in `/data/superseded-points.json`, not the active chart.

These estimates enter the reference frontier, never an unlabeled measured frontier.
AA Default Fallback scores retain their source configuration and unknown actual
fallback use. Scores and quota samples are not a same-plan joint benchmark.

## Updating

Verify current plan eligibility and same-model pricing; inspect original quota
meters and token categories, not just task counts or plan marketing multipliers.
Prefer directly auditable same-window records. Document a rejected alternative
when its normalisation or source cannot be verified. Keep point notes bilingual.
Run adapter tests, web tests, typecheck, full build and static-page checks.
