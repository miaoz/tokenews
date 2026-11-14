# Independent models and leaderboards

`data/models.json` is Tokenews' model identity catalog. Each model has a stable
`id`, display `name`, `maker`, source URL and `checkedAt` date. Existing IDs and
URLs are preserved. Models need no price point to receive English and Chinese
model pages, maker listings, news references, sitemap and Markdown entries.
New upstream price models are still included by the adapter as a compatibility
fallback; promote their identity into the catalog to retain them independently.

Add a verified model to `data/models.json`. Add explicitly reviewed source
configurations to `sources.json` (`adapter`, `model`, `url`, exact source `label`,
benchmark `version`, `variant`, and optional `effort`). Model identity and source
configuration are separate: a family can have several effort levels or harnesses.
Never infer that a leaderboard evaluation measures a subscription product.

Run `npm run leaderboards:update`. The initial adapters read public rendered
Artificial Analysis model pages and Crusader Bench model pages; no API key is
required. They validate identity, score, rank, reasoning configuration where
reported, and benchmark version. An HTTP error, missing score or version change
fails before writing data. Review a version change and update `sources.json`
explicitly; versions receive separate board IDs and are never mixed with the
upstream AA v4.3 snapshot. These are display-precision scores, not API precision.

`snapshots.json` retains daily observations with source URLs, source rank and
population, retrieval date, version and a short score excerpt. Same-day reruns
replace that day's observation. Builds choose the latest observation per model,
board version and configuration; historical observations remain downloadable.
Source-reported ranks are labelled separately from ranks computed over the
upstream subset. AA model pages report ranks within comparison groups; these
are labelled as source-group ranks, not global leaderboard ranks. Downloadable source records retain their providers' terms;
Tokenews code licensing does not relicense third-party benchmark data.

`discovery.json` records AA release-page entries without a reviewed source
mapping. This is a **review queue**, not a list of confirmed missing models:
entries may already exist under another ID, and release links may group several
configurations. Review identity, maker and version before publishing new models.
Only the source entries actually present in the retrieved page are discovered;
this is not a guarantee of complete historical coverage.

The `update-leaderboards.yml` workflow runs daily at 02:47 UTC and on demand.
It audits all configured boards, updates reviewed sources, builds, tests and
checks pages before committing snapshots, discovery and audit reports and
invoking deployment. Failures stay visible in Actions
and leave the deployed snapshot intact. The discovery report is also uploaded as
an Actions artifact. The workflow becomes active when merged into the default
branch. Additional source adapters belong in `scripts/lib/leaderboards.mjs` with
parser failure tests; targets are data, not a code manifest.

The catalog has 305 models after reconciliation of the original discovery
queue, current AA releases and complete Arena tables. Dated releases, Preview
and stable releases, and explicit quantizations remain distinct; effort levels
remain configurations. A missing score or price is never manufactured.

Publication and auditing have different scopes:

- `npm run pareto:update` refreshes all eight current boards in `current.json`.
  The explorer uses those current configurations and exact-model price mappings.
  See [PARETO.md](PARETO.md) for versions, coverage, identity review and exclusions.
- `sources.json` also refreshes individual AA model-page observations and Kimi's
  Crusader Bench configuration. The full current AA payload takes precedence in
  publication, while individual page observations remain archived.
- `npm run leaderboards:audit` checks **every one of the eight upstream Pareto
  boards**, enforced against `points.boards`, and writes `audit.json`. It compares
  benchmark versions, source configurations, model identities and exact matched
  scores; DeepSWE task-cost changes are tracked separately. A methodology change
  suppresses direct score comparisons. AA router agents are not base models.
- A missing/blocked response is `unverified`, never “unchanged”. The command exits
  nonzero if any source cannot be verified. `--allow-partial` retains this status
  and emits a warning while letting the daily workflow continue other validated
  updates. Both audit and discovery reports are uploaded as workflow artifacts.
- Arena returned HTTP 403 during direct fetches; browser navigation subsequently
  succeeded. Complete structured imports in `imports/` preserve signed numeric
  scores and source configuration IDs. See PARETO.md for the browser import
  command. These dated imports never override future fetch errors.
- `history/` retains previous current snapshots. Original upstream scores remain
  available as explicitly historical boards; they never fill current-score gaps.
- The daily workflow runs audit, current Pareto refresh, individual source refresh,
  build, tests and page checks. `refresh-status.json` reports retained snapshots
  and errors. Both audit and refresh failures are retained as workflow artifacts.

The audit's recent-release window starts at the newest board snapshot in the
upstream baseline. It reports release identity, catalog ID, and whether the model
was present in the upstream directory or upstream benchmarks. Its public payload
coverage is stated per source, and it does not claim to enumerate every model
that exists. Add source adapters in `scripts/lib/leaderboard-audit.mjs` and keep
`audit-sources.json` in step with every supported Pareto board.

## Row-level identity review and fallback provenance

Unknown identities are quarantined as `identity-review-required` with their source
ID, release slug, label and score retained in coverage. They receive no model
price mapping; other validated rows refresh normally. The refresh report remains
`updated` and records `reviewRequired` and `identityReview`. This differs from
unreviewed methodology changes, malformed payloads, duplicate IDs or retrieval
failures, which retain the entire prior board with its original date.

AA agent payloads support both release `name` and `shortName`. The reviewed AA
release `claude-fable-5-2` maps to the existing Claude Fable 5.2 catalog entry,
matching AA release name/Anthropic creator metadata and its official model source.
`Default Fallback` means fallback is enabled, not proof it was used. Such scores
retain their configuration labels and are excluded from single-model price
mappings as `fallback-enabled`. Explicit positive fallback attempt counts remain
`multi-model-fallback`. Neither flag is inferred to be a pure-model measurement.


See [the November 13 all-board review](review-2026-11-13.json) for source freshness,
Fable/Carbon coverage, the isolated official TB 4.1 migration and unranked Arena
AutoEval handling. All eight homepage sources are refreshed; missing source
results are not approximated from another benchmark. Crusader remains a partial
model-page integration, documented separately rather than advertised as a full
current homepage board.

## Scheduled source-health check

The refresh job still retains previous snapshots when individual sources fail,
then validates and deploys successful partial updates. A separate `source-health`
job consumes only this workflow run and attempt's
`leaderboard-source-health-${{ github.run_attempt }}` artifact and
fails when any source is retained/failed, absent, duplicated, or malformed. Its
job summary lists the attempted date, each snapshot's checked date, and exact
reported failure. A missing artifact also fails health rather than reading a
committed old report. `deploy` depends only on the validated update job, not on
health, so source failures are visible without blocking valid updates.

Run `node scripts/check-leaderboard-health.mjs [report-path]` to inspect existing
refresh evidence without network requests or data changes. Identity-review rows
within an otherwise successful refresh are not transport failures.

This surfaces GitHub Actions HTTP 403 failures; it cannot grant that runner access
to Arena. There are no additional retries, user-agent changes, proxies, cookies,
or access-control workarounds. GitHub workflow failure notifications follow the
repository/user's existing notification settings; no external alert subscription
is created by this check.

Main-branch pushes changing this workflow or its collector/health code also run
this validation. Generated snapshot/data commits do not match the path filter,
so the updater's own commits cannot create a refresh loop.

### November 14 source maintenance

AA's public model payload now embeds release slugs instead of variant slugs.
The adapter accepts both schemas and links modern records to official release
pages. Modern configuration IDs are explicitly local release/name pairs, not
invented source IDs. Source releases must exist and configurations must be unique.
Reviewed Solar Pro 4 and Inkling 2 Small slug changes preserve their identities.
AA reused `ling-3-1-flash` for the 1019 checkpoint; exact release-name guards keep
legacy and current payloads separate, while `ling-3-1-flash-1001` identifies the
older checkpoint. Unknown names still require review.

Gemini 4 Hydrogen now has independently verified paid Developer API rates and a
standard-workload price reference. Its new official TB 4.1 Antigravity High row
is published without copying Google's separate self-reported result. No scores
are invented for boards that do not list it. AA Coding Agent 2.1 is retained as a
methodology-review failure, not silently mixed with the reviewed 2.0 snapshot.
