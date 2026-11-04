# Current Pareto data

The explorer uses eight current source snapshots from `current.json`, not the
archived upstream benchmark mappings. Explicitly reviewed official API tiers in
`data/api-price-points.json` additionally supply independent metered price points.
All original price points and upstream
scores remain unchanged in `site.json`; historical boards carry their snapshot
dates and are not used to fill gaps in current charts.

`npm run pareto:update` reads every source in `audit-sources.json`, validates the
reviewed methodology in `scripts/lib/current-leaderboards.mjs`, and resolves
identities through `identities.json`. Unknown releases, changed methodologies,
missing scores or duplicate source IDs fail that source's update. Successfully
validated sources can advance; failed sources retain their prior snapshot and
verification date. The command exits nonzero if any refresh failed, unless
`--allow-partial` is specified. Failures always appear in `refresh-status.json`.
Content-addressed files in `history/` retain complete prior snapshots.

## Price correspondence

- The join requires the exact catalog model ID. Dates, Preview/stable releases
  and explicitly quantized models are separate identities. Reasoning effort and
  context budget remain configuration attributes, not separate model entries.
- Every mapped price retains its original cost, quota, workload and sampling
  date. The benchmark source's task cost is never used as subscription cost.
- These are model references, not measurements of a subscription/channel.
  `quota_effort_matched` stays null and mapping confidence is medium. Harness
  and effort remain visible and filterable.
- Router agents, runs with model fallback, ambiguous source configurations and
  unverified scores do not join single-model price points. Scores without price
  evidence remain in model pages and the chart's coverage table.
- Local custom-provider prices can join catalog-only models using the same
  identity and exclusion rules. They remain explicitly user-entered prices.

## 2026-11-04 source coverage

| Source | Reviewed version | Configurations |
| --- | --- | ---: |
| AA Intelligence | 5.0.1 | 91 |
| Terminal-Bench official | 4.0 | 35 |
| AA Terminal-Bench | 4.0 | 140 |
| Arena WebDev Overall | unversioned; 2026-10-27 | 153 |
| Arena Agent Overall | unversioned; 2026-11-03 | 59 |
| AA Coding Agent | 2.0 | 34 |
| OpenDesign quality | unversioned | 22 |
| DeepSWE | 1.1 | 70 |

Counts refer to configurations, not unique models. The source subset excludes
deprecated AA configurations and includes only non-null scores for the specified
metric. OpenDesign uses raw quality, not the weighted recommendation ranking.
Terminal-Bench and DeepSWE include official records only; older vendor self
reports remain historical. AA Coding Agent v2.0 uses its new methodology and
never combines with v1.5 scores. DeepSWE's current mean/median task costs and
confidence intervals are retained separately from token prices.

## Arena retrieval limitations

Direct HTTP requests returned 403. Browser navigation initially showed a
challenge, then loaded the public pages. All 153 WebDev and 59 Agent records
were read from serialized page data, with original precision, signed scores,
confidence intervals and stable configuration IDs. Reviewed imports in `imports/`
include the raw leaderboard payload. Text-only scraping is not supported:
negative signs are SVG glyphs and disappear from text exports.

DeepSeek V4 Pro 0813 (High) is verified at -0.25836097228167776%, not guessed.
Same-label Mistral Large 4 entries are distinct agent/text contenders; their
source IDs and service modes are retained. The two same-label GPT-5.3-Codex
entries include an explicit 2026-03-05 release, which has its own catalog ID.

The scheduled updater attempts direct public retrieval and retains prior data
with an error report if blocked. After browser retrieval succeeds, save an
evaluation result containing
`{url: location.href, capturedAt: new Date().toISOString(), html: document.documentElement.outerHTML}` and
run `npm run pareto:update -- --arena-import arena_code=capture.json` (or
`arena_agent_mode=capture.json`; both flags can be supplied together). Imports
use exactly the same structured parser, identity/version validation and history
writer; they do not grant future fetches a successful status. Browser captures
are local working files; only public source records are published.
The capture timestamp must be recorded during retrieval, not added during import.
Imports preserve that date (America/Los_Angeles), reject missing/future timestamps,
wrong-board URLs and captures older than the published snapshot. Reusing an old
capture never advances its verification date. Existing captures without provenance
must be retrieved again. Failed refreshes are visible below the chart as well as
in `/data/leaderboard-refresh.json`.

## Model reconciliation

`identity-review.json` records all 185 original discovery candidates: 184 resolve
through AA's explicit model-variant → release relationship; `/models/recommend`
is rejected as navigation. The review additionally covers current AA releases
and the complete Arena tables. The catalog grows from 93 to 305 entries in this
pass (212 additions, including older omitted models and dated/quantized releases).
This is not a claim of 212 recent model launches. Source URLs, release identities
and decisions are retained. The current discovery queue is empty; newly seen
identities will require review before a future source snapshot is published.

`audit.json` still compares live sources against the upstream baseline; a failed
live fetch stays `unverified` even when a reviewed import exists. Publication
coverage is separately available as `/data/leaderboard-coverage.json` and in the
chart's expandable coverage table. `/data/current-leaderboards.json` contains all
604 observed configurations, including entries excluded from price mappings.

## Remaining gaps after the pricing follow-up (2026-11-04)

The official Kimi browser-rendered pricing table supplied four new maintained
references (K3.1 Pro, K3.1 Pro Highspeed, K3 and K2.7 Code). The Highspeed endpoint
is additionally verified by the official quickstart and has its own catalog ID:
the catalog now contains 306 models. It has no independently matched score.
The reviewed international API tiers supply four new points alongside the 332
unchanged upstream points. K3 uses default 5m cache TTL: cache writes and uncached
input are mutually exclusive and have equal rates, so the existing 97/2.5/0.5
workload is applicable without double charging. K2.7 Code remains restricted to
existing users; this restriction is included in its point notes.

K3.1 Pro now joins five current boards. Coverage is 360 matched configurations,
236 unpriced configurations across 124 unique models, and eight excluded
router/fallback configurations. These are separate counts: multiple efforts or
harnesses can describe the same model. The 233 catalog models without maintained
or upstream reference prices include historical models with no current scores.
They are not all recent launches or all active pricing gaps.

Highest-impact remaining price research, by distinct boards / configurations:
GPT-6.1 Terra (6 / 21), Muse Wonder (6 / 6), Gemini 4 Carbon (5 / 9),
Mistral Large 4 (5 / 9), DeepSeek V4.1 Flash 1017 (5 / 9), Beam 1.0 (5 / 5),
MiniMax M3.1 Flash (5 / 5), and Muse Wonder Full (5 / 5).
The current Google pricing page was checked and contains no Carbon entry;
Argon's rates are not a substitute. The Kimi source's raw HTML and Markdown
contain empty tables: browser hydration is required to read its official rates.
Evidence is saved in `data/api-price-research/kimi-2026-11-04.json`.

Arena's unattended HTTP retrieval remains blocked; browser import is still a
manual fallback. Official price research and review of new identities or changed
methodologies are also manual. The workflow must be merged/deployed before its
daily schedule takes effect. A source failure preserves prior evidence and is
now surfaced in the chart, without advancing its verification date.
