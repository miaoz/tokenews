import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultState, groups, rowsFor } from "./domain";
import { missingReason, unplottedRows, unplottedSearch } from "./chartCoverage";
import LeaderboardCoverage from "./LeaderboardCoverage";
import type { SiteData } from "./types";
import { unpackData } from "./loadData";

const data: SiteData = unpackData(JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8")));
const state = defaultState();

test("Carbon is plotted, while enabled Fable fallback remains searchable with its actual reason", () => {
  const rows = rowsFor(data, state);
  const models = new Set(groups(rows).flatMap(g => g.rows.map(r => r.point.model)));
  assert.ok(models.has("gemini-4-carbon"));
  assert.ok(!models.has("claude-fable-5.2"));
  assert.deepEqual(unplottedSearch(data, { ...state, find: "carbon" }, rows), []);
  const missing = unplottedSearch(data, { ...state, find: "Fable 5.2" }, rows);
  assert.equal(missing.length, 1, "five configurations collapse into one model-level explanation");
  assert.equal(missing[0].reason, "fallback-enabled");
  assert.equal(missing[0].model, "claude-fable-5.2");
  assert.match(missingReason(missing[0].reason, "en"), /actual use unverified/);
  assert.match(missingReason("multi-model-fallback", "en"), /Run used/);
});

test("Search distinguishes a filtered model from missing price or score evidence", () => {
  const filtered = { ...state, channels: ["Anthropic"], find: "Carbon" };
  const result = unplottedSearch(data, filtered, rowsFor(data, filtered));
  assert.equal(result[0].reason, "filtered-out");
  const missing = unplottedRows(data, state.board);
  assert.ok(missing.some(r => r.reason === "no-score-evidence"));
  assert.ok(missing.some(r => r.reason === "no-price-evidence"));
  assert.ok(missing.some(r => r.reason === "identity-review-required" && r.model === null));
  assert.ok(!missing.some(r => r.model === "gemini-4-carbon"));
  assert.ok(!missing.some(r => r.model === "claude-fable-5.2" && r.reason === "no-score-evidence"));
});

test("Unreviewed source identities remain discoverable without inventing model-page links", () => {
  const unknown = data.leaderboardCoverage![state.board].excluded.find(r => r.reason === "identity-review-required")!;
  const results = unplottedSearch(data, { ...state, find: unknown.label }, rowsFor(data, state));
  assert.ok(results.some(r => r.model === null && r.reason === "identity-review-required"));
  assert.deepEqual(unplottedSearch(data, { ...state, find: "  " }, []), []);
});

test("An expired reference with no active successor is explained as missing price, not missing score", () => {
  const expired = { ...data, points: data.points.filter(p => p.model !== "gemini-4-carbon"), mappings: data.mappings.filter(m => !data.points.some(p => p.id === m.point_id && p.model === "gemini-4-carbon")) };
  assert.equal(unplottedSearch(expired, { ...state, find: "Carbon" }, rowsFor(expired, state))[0].reason, "no-price-evidence");
});

test("Coverage shows reasons, fallback uncertainty and precise refresh failures in both languages", () => {
  const edited = structuredClone(data);
  edited.leaderboardRefresh = { [state.board]: { status: "retained-previous", attemptedAt: "2026-11-13", checkedAt: "2026-11-04", error: "Methodology review required: terminal_bench_4 4.1" } };
  for (const lang of ["en", "zh"] as const) {
    const html = renderToStaticMarkup(<LeaderboardCoverage data={edited} board={state.board} lang={lang} />);
    assert.match(html, /Methodology review required: terminal_bench_4 4.1/);
    assert.match(html, /claude-fable-5-2/);
    assert.match(html, /type="search"/);
    assert.match(html, lang === "en" ? /actual use unverified/ : /实际是否触发未核实/);
  }
});
