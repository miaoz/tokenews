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
  const fableSubs = fable.filter(r=>r.point.billing==='subscription');
  assert.equal(fableSubs.length,2);
  assert.ok(fable.some(r=>r.point.id==='anthropic_fable52_api::claude-fable-5.2'));
  assert.ok(fableSubs.every(r=>r.point.plan_id!=='claude_pro'&&r.point.quota_is_estimated));
  assert.ok(fable.every(r=>r.mapping?.fallback_enabled));
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
  assert.ok(unplottedRows(data, "terminal_bench_v4_1").some(r => r.reason === "identity-review-required" && r.model === null));
  assert.ok(!missing.some(r => r.model === "gemini-4-carbon"));
  assert.ok(!missing.some(r => r.model === "claude-fable-5.2" && r.reason === "no-score-evidence"));
});

test("Unreviewed source identities remain discoverable without inventing model-page links", () => {
  const tbState = { ...state, board: "terminal_bench_v4_1" };
  const unknown = data.leaderboardCoverage![tbState.board].excluded.find(r => r.reason === "identity-review-required")!;
  const results = unplottedSearch(data, { ...tbState, find: unknown.label }, rowsFor(data, tbState));
  assert.ok(results.some(r => r.model === null && r.reason === "identity-review-required"));
  assert.deepEqual(unplottedSearch(data, { ...state, find: "  " }, []), []);
});

test("An expired reference with no active successor is explained as missing price, not missing score", () => {
  const expired = { ...data, points: data.points.filter(p => p.model !== "gemini-4-carbon"), mappings: data.mappings.filter(m => !data.points.some(p => p.id === m.point_id && p.model === "gemini-4-carbon")) };
  assert.equal(unplottedSearch(expired, { ...state, find: "Carbon" }, rowsFor(expired, state))[0].reason, "no-price-evidence");
});

test("Coverage shows actual remaining gaps and precise refresh failures in both languages", () => {
  const edited = structuredClone(data);
  const reviewBoard = "terminal_bench_v4_1";
  edited.leaderboardRefresh = { [reviewBoard]: { status: "retained-previous", attemptedAt: "2026-11-13", checkedAt: "2026-11-04", error: "Methodology review required: terminal_bench_4 4.1" } };
  for (const lang of ["en", "zh"] as const) {
    const html = renderToStaticMarkup(<LeaderboardCoverage data={edited} board={reviewBoard} lang={lang} />);
    assert.match(html, /Methodology review required: terminal_bench_4 4.1/);
    assert.doesNotMatch(html, /claude-fable-5-2/);
    assert.match(html, /type="search"/);
    assert.match(html, lang === "en" ? /identity needs review/ : /身份待审核/);
  }
});


test("all eight current boards distinguish published Fable, Carbon and Hydrogen scores from source absences", () => {
  const expected: Record<string, [boolean,boolean,boolean]> = {
    aa_intelligence_index_v5_0_1:[true,true,true], terminal_bench_v4_1:[true,true,true],
    aa_terminal_bench_v4_0:[true,true,true], arena_code_current:[true,true,true],
    arena_agent_mode_current:[true,true,true], aa_coding_agent_index_v2_1:[false,true,true],
    open_design_arena_current:[false,false,false], deepswe_v1_1:[false,false,false],
  };
  assert.deepEqual(new Set(data.currentBoards),new Set(Object.keys(expected)));
  for(const [board, present] of Object.entries(expected)) {
    const rows=rowsFor(data,{...state,board});
    for(const [i,model] of ['claude-fable-5.2','gemini-4-carbon','gemini-4-hydrogen'].entries()) {
      assert.equal(rows.some(r=>r.point.model===model && r.mapping),present[i],`${board}: ${model}`);
      if(!present[i]) {
        const reason=board==='aa_coding_agent_index_v2_1'&&model==='claude-fable-5.2'?'multi-model-fallback':'no-score-evidence';
        assert.ok(unplottedRows(data,board).some(r=>r.model===model&&r.reason===reason),`${board}: ${model}: ${reason}`);
      }
    }
  }
  assert.equal(Math.max(...data.configurations.filter(c=>c.board==='terminal_bench_v4_1'&&c.model==='claude-fable-5.2').map(c=>c.score)),65.76);
  const maxArenaFable = Math.max(...data.configurations.filter(c=>c.board==='arena_code_current'&&c.model==='claude-fable-5.2').map(c=>c.score));
  assert.ok(maxArenaFable >= 1800);
  assert.ok(data.boards.arena_code_current.snapshot >= '2026-11-22');
  const codeRows = rowsFor(data, { ...state, board: 'arena_code_current' });
  assert.ok(codeRows.some(r => r.point.model === 'hy4' && r.mapping));
  assert.ok(codeRows.some(r => r.point.model === 'inkling-2-mini' && r.mapping));
});

test("HF Arena provenance and synthetic AutoEval / TB regrade provenance stay visible without mixing measures", () => {
  const arena=data.leaderboardCoverage!.arena_code_current;
  assert.equal(arena.observed,162);
  assert.equal(arena.retrievalMethod,'official-hf-dataset');
  const withAutoEval=structuredClone(data);
  withAutoEval.leaderboardCoverage!.arena_code_current.excludedSourceRows=[{sourceId:'autoeval-test',label:'Test AutoEval',reason:'unranked-autoeval',score:1668,sourceRank:0,isDay1:true}];
  assert.ok(unplottedRows(withAutoEval,'arena_code_current').some(r=>r.reason==='unranked-autoeval'&&r.score===null));
  for(const lang of ['en','zh'] as const) {
    const hfHtml=renderToStaticMarkup(<LeaderboardCoverage data={data} board="arena_code_current" lang={lang}/>);
    assert.match(hfHtml,lang==='en'?/official LMArena Hugging Face dataset/:/官方 Hugging Face 数据集/);
    const html=renderToStaticMarkup(<LeaderboardCoverage data={withAutoEval} board="arena_code_current" lang={lang}/>);
    assert.match(html,/AutoEval/);
    assert.match(html,lang==='en'?/not mixed into the human-vote/:/不混入人工投票榜/);
    const tb=renderToStaticMarkup(<LeaderboardCoverage data={data} board="terminal_bench_v4_1" lang={lang}/>);
    assert.match(tb,lang==='en'?/not evidence of a fresh 4.1 run/:/逐行来源未披露/);
  }
});

test("GPT-6.2 Astra, GPT-6.2 Sol and Gemini 4 Neon publish reviewed prices and current leaderboard coverage", () => {
  const expected: Record<string, [boolean, boolean, boolean]> = {
    aa_intelligence_index_v5_0_1: [true, true, true],
    terminal_bench_v4_1: [true, true, true],
    aa_terminal_bench_v4_0: [true, true, true],
    arena_code_current: [true, true, true],
    arena_agent_mode_current: [true, true, true],
    aa_coding_agent_index_v2_1: [true, true, true],
  };
  for (const [board, present] of Object.entries(expected)) {
    const rows = rowsFor(data, { ...state, board });
    for (const [i, model] of ["gpt-6.2-astra", "gpt-6.2-sol", "gemini-4-neon"].entries()) {
      assert.equal(rows.some(r => r.point.model === model && r.mapping), present[i], `${board}: ${model}`);
    }
  }
  assert.ok(data.points.some(p => p.id === "command_code_max_10::gpt-6.2-astra"));
  assert.ok(data.points.some(p => p.id === "command_code_pro::gpt-6.2-sol"));
  assert.ok(data.points.some(p => p.id === "command_code_pro::gemini-4-neon"));
  const proNeon = data.points.find(p => p.id === "google_ai_pro_us::gemini-4-neon");
  assert.ok(proNeon && !proNeon.quota_is_estimated && proNeon.workload === "lowCache" && proNeon.confidence === "medium");
  assert.ok(!data.points.some(p => p.id === "estimate:google-ai-pro:gemini-4-neon"), "Pro Neon estimate is retired in favour of upstream measurement");
  const ultraNeon = data.points.find(p => p.id === "estimate:google-ai-ultra-20x:gemini-4-neon");
  const ultraCarbon = data.points.find(p => p.id === "estimate:google-ai-ultra-20x:gemini-4-carbon");
  assert.ok(ultraNeon && ultraNeon.workload === "lowCache");
  assert.ok(ultraCarbon && ultraCarbon.workload === "lowCache");
  assert.ok(!data.points.some(p => p.id === "estimate:google-ai-pro:gemini-4-carbon"), "Carbon is Ultra-only");
  const devinCarbon = data.points.find(p => p.id === "estimate:devin-max:gemini-4-carbon");
  assert.ok(devinCarbon && devinCarbon.channel === "Devin" && devinCarbon.confidence === "medium" && devinCarbon.workload === "lowCache" && devinCarbon.promo_until === "2026-11-30");
  assert.ok(data.points.some(p => p.id === "estimate:chatgpt-pro-20x:gpt-6.2-astra"));
  assert.ok(data.points.some(p => p.id === "estimate:chatgpt-plus:gpt-6.2-sol"));
  for (const model of ["qwen4-max", "hy4", "hy4-flash", "inkling-2-mini", "longcat-2.5"]) {
    assert.ok(data.points.some(p => p.model === model), `coverage includes ${model}`);
  }
});
