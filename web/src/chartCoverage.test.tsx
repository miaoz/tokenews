import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultState, groups, rowsFor, pareto, referenceTags } from "./domain";
import { missingReason, unplottedRows, unplottedSearch } from "./chartCoverage";
import LeaderboardCoverage from "./LeaderboardCoverage";
import type { SiteData } from "./types";
import { unpackData } from "./loadData";

const data: SiteData = unpackData(JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8")));
const state = defaultState();

test("Carbon and Fable are plotted; Fable keeps explicit estimate and default-fallback qualifications", () => {
  const rows = rowsFor(data, state);
  const models = new Set(groups(rows).flatMap(g => g.rows.map(r => r.point.model)));
  assert.ok(models.has("gemini-4-carbon"));
  assert.ok(models.has("claude-fable-5.2"));
  assert.deepEqual(unplottedSearch(data, { ...state, find: "carbon" }, rows), []);
  assert.deepEqual(unplottedSearch(data, { ...state, find: "Fable 5.2" }, rows), []);
  const fable = rows.filter(r=>r.point.model==='claude-fable-5.2');
  assert.equal(fable.length,2);
  assert.ok(fable.every(r=>r.point.plan_id!=='claude_pro'&&r.point.quota_is_estimated&&r.mapping?.fallback_enabled));
  assert.ok(pareto(groups(rows)).some(g=>g.rows.some(r=>r.point.model==='claude-fable-5.2')));
  assert.ok(referenceTags(fable,'en').some(t=>/use unknown/.test(t)));
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

test("Coverage shows actual remaining gaps and precise refresh failures in both languages", () => {
  const edited = structuredClone(data);
  edited.leaderboardRefresh = { [state.board]: { status: "retained-previous", attemptedAt: "2026-11-13", checkedAt: "2026-11-04", error: "Methodology review required: terminal_bench_4 4.1" } };
  for (const lang of ["en", "zh"] as const) {
    const html = renderToStaticMarkup(<LeaderboardCoverage data={edited} board={state.board} lang={lang} />);
    assert.match(html, /Methodology review required: terminal_bench_4 4.1/);
    assert.doesNotMatch(html, /claude-fable-5-2/);
    assert.match(html, /type="search"/);
    assert.match(html, lang === "en" ? /identity needs review/ : /身份待审核/);
  }
});


test("all eight current boards distinguish published Fable and Carbon scores from source absences", () => {
  const expected: Record<string, [boolean,boolean]> = {
    aa_intelligence_index_v5_0_1:[true,true], terminal_bench_v4_1:[true,false],
    aa_terminal_bench_v4_0:[true,true], arena_code_current:[true,true],
    arena_agent_mode_current:[true,true], aa_coding_agent_index_v2_0:[false,true],
    open_design_arena_current:[false,false], deepswe_v1_1:[false,false],
  };
  assert.deepEqual(new Set(data.currentBoards),new Set(Object.keys(expected)));
  for(const [board, present] of Object.entries(expected)) {
    const rows=rowsFor(data,{...state,board});
    for(const [i,model] of ['claude-fable-5.2','gemini-4-carbon'].entries()) {
      assert.equal(rows.some(r=>r.point.model===model && r.mapping),present[i],`${board}: ${model}`);
      if(!present[i]) assert.ok(unplottedRows(data,board).some(r=>r.model===model&&r.reason==='no-score-evidence'));
    }
  }
  assert.equal(Math.max(...data.configurations.filter(c=>c.board==='terminal_bench_v4_1'&&c.model==='claude-fable-5.2').map(c=>c.score)),65.76);
  assert.equal(Math.max(...data.configurations.filter(c=>c.board==='arena_code_current'&&c.model==='claude-fable-5.2').map(c=>c.score)),1837.808306458596);
});

test("AutoEval and TB regrade provenance are visible without mixing different evaluation measures", () => {
  const arena=data.leaderboardCoverage!.arena_code_current;
  assert.equal(arena.observed,157);
  assert.equal(arena.excludedSourceRows?.length,1);
  assert.ok(!data.configurations.some(c=>c.board==='arena_code_current'&&c.source_id===arena.excludedSourceRows![0].sourceId));
  assert.ok(unplottedRows(data,'arena_code_current').some(r=>r.reason==='unranked-autoeval'&&r.score===null));
  for(const lang of ['en','zh'] as const) {
    const html=renderToStaticMarkup(<LeaderboardCoverage data={data} board="arena_code_current" lang={lang}/>);
    assert.match(html,/AutoEval/);
    assert.match(html,lang==='en'?/not mixed into the human-vote/:/不混入人工投票榜/);
    const tb=renderToStaticMarkup(<LeaderboardCoverage data={data} board="terminal_bench_v4_1" lang={lang}/>);
    assert.match(tb,lang==='en'?/not evidence of a fresh 4.1 run/:/逐行来源未披露/);
  }
});
