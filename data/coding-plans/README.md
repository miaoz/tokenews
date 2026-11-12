# Independently reviewed coding plans

`current.json` supplements the upstream snapshot with reviewed plan/model
combinations. The November 4 announcement audit covers the seven existing
subscription channels that distribute third-party models: OpenCode, Command
Code, Ollama, Factory, Cursor, Devin and Alibaba. Recent model generations take
priority; historical-only gaps remain out of scope.

The audit joins dated official rollout announcements and release notes to
current plan tables, endpoints and billing conditions. Directory metadata alone
cannot establish a checkpoint. `evidence-2026-11-04-02.json` contains the channel
matrix, dated release events, source hashes, per-model decisions and remaining
gaps. Evidence and availability records are published with the site.

## Calculation and identities

Each price record requires an exact catalog model, provider endpoint, identity
source, bilingual explanation, rates, credits and verification date. The shared
and per-model caps use the smaller amount. Monthly tokens equal credits divided
by workload-weighted USD/MTok, multiplied by one million. Monthly pools are not
multiplied by four weeks. Request estimates are not quota evidence.

The workload uses 97% cache reads, 2.5% fresh input and 0.5% output. If a channel
charges a distinct cache-write rate, the explicitly reviewed `freshInputBilling:
"cache-write"` scenario charges that rate for the 2.5% fresh share, replacing
ordinary input rather than adding both. Other unequal write prices fail review.
Time and context bands are alternative uses of the same pool. OpenCode Teams
is per member; Ollama Team covers the entire team. Command Code Max premium
models use the premium cap, not the larger standard cap. Model/category
allowances must never be added together.

`promoUntil` requires reviewed `postPromoRates` and `postPromoScope`. Builds
through the stated date use the promotion; later builds restore regular rates.
OpenCode Argon's 50% offer ends November 30, 2026. The daily build/deploy process
updates the static site; an already built artifact does not change itself.

## Preserving history

`replaces` explicitly names superseded upstream points. Newer upstream data
blocks replacement pending review. Originals are published in
`/data/superseded-points.json`; upstream CSVs and benchmark downloads stay intact.
Ollama's former session/weekly plans and Cursor's former Pro/Pro+/Ultra plans
are labeled Legacy, preserving measured quantities and original dates.

Official rollout announcements confirm that the unchanged OpenCode and Command
Code DeepSeek alias serves 1017. Stable point IDs retain saved links, but old
benchmark mappings cannot follow an ID onto a different model. The same rule
applies when OpenCode Argon Contributor is replaced by standard Argon. Global
undated models and unconfirmed Fast variants do not inherit checkpoint upgrades.
Benchmark mappings are model references, not channel benchmark claims.

## Availability without a plotted price

Free Beam and stealth previews retain time, region and capacity conditions.
Decision models (Jev/Clef), undocumented credit conversions (Factory/Alibaba),
extra-usage-only access (new Cursor plans), and Mistral's unresolved weight
revision do not receive invented quotas or scores. An ambiguous GLM 1017 mention
in a recap does not create a new benchmark identity. Newly cataloged models may
have a price table while remaining off the plot until a compatible score exists.

Update official announcements, release notes, plan tables and identity evidence
together, then run `npm test`, `npm --prefix web run build`, and `npm run check`.
The daily leaderboard workflow does not independently refresh plan credits.

## Scheduled announcement and plan watch

`.github/workflows/watch-coding-plans.yml` checks the configured sources every 24
hours (`23 0 * * *`, UTC) and can be run manually. GitHub schedules may be delayed.
It publishes the last check, failed sources and persistent pending changes on
the explorer, methodology and provider pages, with the full report at
`/data/coding-plan-watch.json`. Status older than 72 hours is flagged as stale.

`npm run coding-plans:watch` checks the source registry in `watch-sources.json`:
public release notes, official announcements, model/endpoint lists, plan tables,
rolling limits, discounts and promotion expiry. Direct HTTP retrieval falls back
to Chromium for rendered pages. Install it with `npx playwright install chromium
--only-shell`. `--allow-partial` publishes successful observations plus explicit
failure statuses; the default exits nonzero on a source failure.

Social discovery first tries official X syndication; a mirror may supply post
IDs when discovery is unavailable. Only the configured official account's X
oEmbed response can establish announcement content. Unverifiable posts fail the
source check and preserve its last successful snapshot. A failure is never an
assertion that there were no announcements.

The first successful fetch establishes a comparison baseline, not retrospective
verification. Subsequent observations identify added/removed rows, changed
prices and credit limits, relevant release/terms changes, and expiring promotions.
Whitespace, scripts and navigation are ignored. Empty/bot pages and large losses
of table coverage fail structural guards. Source failures preserve the last good
snapshot. Records store table facts, hashes and model mentions rather than
copies of complete announcements. Snapshots and unresolved events are retained
in `watch-state.json`; workflow artifacts also retain each run for 30 days.

Table coverage guards apply to table sources, not paginated release documents.
The Command Code pricing overview also requires the individual-plan and usage
limit tables, so removed promotional sections do not freeze a valid page while
a partial overview still fails. Its minimum row count covers the core tables
rather than assuming every temporary promotion remains forever.

Table row identities use section/offer anchors and the first column, independent
of the full header and neighbouring tables. Named-column comparisons tolerate
column reordering. Only explicitly configured display metadata (`Intelligence`
on Command Code plan pages) is excluded; prices, credit caps, context and billing
columns remain monitored. Legacy snapshots migrate by matching unchanged facts
or an unambiguous row identity; ambiguous changes remain reviewable. Model-name
matches require word boundaries but allow attached version numbers such as
Qwen3.8. Old events are never deleted by a parser update.

On November 12, 432 paired additions/removals caused solely by Command Code's
removed Intelligence column were explicitly dismissed in `watch-resolutions.json`.
All original event evidence and the other 406 pending events were preserved.
The dated Command Code availability recheck is in `evidence-2026-11-12.json`.

Discovery never silently upgrades a model alias or copies quotas to another
model. To process a pending event:

1. Follow its official URL and inspect `before`/`after` in `watch-report.json`.
2. Check exact model identity, eligible tiers, context/time bands, shared caps,
   cache billing and any expiry. Update `current.json`, catalog and evidence as
   needed. Existing approved promotion fallbacks still apply automatically.
3. Add an object to `watch-resolutions.json` with the event's full `id`,
   `status: "accepted"` or `"dismissed"`, `reviewedAt` (ISO date/time), and a
   nonempty `reason` describing the evidence and resulting action.
4. Run the watch, build, tests and page checks. Pending events persist until an
   explicit resolution; they are not cleared by an unchanged or failed fetch.

The three data workflows share one concurrency group and check out current
`main` after waiting, preventing scheduled updates from racing each other.
A successful watch publishes its report through the existing validated deploy
workflow. Reviewed price data stays available when one source is unreachable.
