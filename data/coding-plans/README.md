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
