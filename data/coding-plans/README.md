# Independently reviewed coding plans

`current.json` supplements the upstream snapshot with reviewed plan/model
combinations. The November 4 pass prioritizes new models, not a full historical
plan catalog. It covers OpenCode Go/Plus/Teams, Command Code GOAT and the current
Ollama monthly-credit Pro/Max/Team plans. Availability-only reviews also cover
Factory, Cursor and models whose pricing or version cannot yet be joined.

Each entry needs a plan, exact catalog identity, provider endpoint, identity
source and bilingual explanation, provider token rates, monthly credits and
verification date. `replaces` explicitly identifies old points superseded by a
new reviewed record. A newer upstream observation blocks replacement pending
review. Untouched points stay unchanged. Original replaced records are published
in `/data/superseded-points.json`, and the complete upstream points/adopted CSV
downloads remain unchanged. Legacy Ollama sample labels distinguish the old
session/weekly plans from the current monthly-credit generation.

The calculation uses 97% cache reads, 2.5% fresh input and 0.5% output. A listed
write rate must equal ordinary input, otherwise further billing review is
required. Writes and ordinary input are mutually exclusive. Effective credits
are the smaller of model credits and the shared cap; monthly tokens equal
credits divided by weighted USD/MTok, multiplied by one million. Monthly pools
are never multiplied by four weeks. Request estimates are not quota evidence.

Time bands are separate alternatives using the same monthly credit pool.
OpenCode Teams is per member; Ollama Team is one fee and pool for the entire
team. No model allowances or bands within one plan may be added together.

OpenCode Go's undated DeepSeek alias and Command Code's `latest` label do not
prove the October 17 checkpoint. Their current credits are updated on the
generic model only. Ollama explicitly offers `deepseek-v4.1-flash:1017-cloud`, so
its current plan prices can join that identity. The Ollama pricing page's peak
window differs from DeepSeek direct/OpenCode: preserve each provider's terms.
Benchmark mappings remain model references, not channel benchmark claims.

Evidence: `evidence-2026-11-04.json` records official table observations and source
hashes. Availability reviews are published on model/provider pages; they never
create free, unlimited or otherwise inferred price points. Free promotions and
Mistral weight-version ambiguity remain pending. No older-model sweep was made.

These plan records require manual source review; the daily leaderboard workflow
does not refresh plan credits. To update, check official plan pages and endpoint
identity, edit the reviewed records, then run `npm test`, `npm run build`, and
`npm run check`. Failures retain the previously deployed site.
