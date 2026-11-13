import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeCurrentLeaderboards,prepareCurrentSource,CURRENT_BOARDS} from './current-leaderboards.mjs';
import {parseArenaData} from './arena.mjs';
import {resolveModel} from './leaderboard-audit.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const snapshot=read('data/leaderboards/current.json'), catalog=read('data/models.json'), identities=read('data/leaderboards/identities.json');
const points=read('upstream/derived/points.json');
const historical=read('upstream/derived/benchmark-configurations.json');
const baseline={models:catalog.models,points:points.points,boards:points.boards,configurations:historical,mappings:read('upstream/derived/benchmark-points.json')};
const merged=mergeCurrentLeaderboards(baseline,snapshot);

test('every current board has real price references and only its own current configurations',()=>{
 assert.equal(merged.currentBoards.length,8);
 const byId=new Map(merged.configurations.map(c=>[c.configuration_id,c]));
 assert.equal(byId.size,merged.configurations.length);
 for(const board of merged.currentBoards){
  const mappings=merged.mappings.filter(m=>byId.get(m.configuration_id).board===board);
  assert.ok(mappings.length,board);
  assert.ok(mappings.every(m=>m.configuration_id.startsWith('current:')));
  for(const m of mappings){
   const c=byId.get(m.configuration_id),p=baseline.points.find(p=>p.id===m.point_id);
   assert.equal(c.model,p.model);
   assert.equal(m.quota_effort_matched,null);
   assert.equal(c.price_mapping_exclusion,null);
  }
 }
 assert.deepEqual(merged.points,baseline.points);
 assert.ok(historical.every(c=>merged.configurations.includes(c)));
 assert.equal(merged.boards.aa_intelligence_index.current,false);
 assert.equal(merged.boards.aa_intelligence_index_v5_0_1.current,true);
});
test('unpriced models, dated releases and composite agents never borrow another model’s quota',()=>{
 const currentMappings=merged.mappings.filter(m=>m.configuration_id.startsWith('current:'));
 const ids=new Set(currentMappings.map(m=>m.configuration_id));
 for(const c of merged.configurations.filter(c=>c.configuration_id.startsWith('current:'))){
  if(c.price_mapping_exclusion||!baseline.points.some(p=>p.model===c.model))assert.ok(!ids.has(c.configuration_id));
 }
 const coverage=merged.leaderboardCoverage.aa_coding_agent_index_v2_0;
 assert.equal(coverage.excluded.filter(r=>r.reason==='router').length,4);
 assert.equal(coverage.excluded.filter(r=>r.reason==='multi-model-fallback').length,4);
 assert.ok(merged.leaderboardCoverage.aa_intelligence_index_v5_0_1.unpriced.some(r=>r.model==='gemini-4-carbon'));
 assert.notEqual(identities.aaReleases['deepseek-v4-pro'],'deepseek-v4-pro');
 assert.notEqual(identities.arenaConfigurations['NVIDIA-Nemotron-3.5-Super-VL-120B-A12B (NVFP4)'],'nemotron-3.5-super-vl');
});
test('publication rejects broken structure/methodology but quarantines unknown identities',()=>{
 assert.throws(()=>mergeCurrentLeaderboards(baseline,{...snapshot,sources:snapshot.sources.slice(1)}));
 const duplicate=structuredClone(snapshot);duplicate.sources[0].rows.push(duplicate.sources[0].rows[0]);
 assert.throws(()=>mergeCurrentLeaderboards(baseline,duplicate));
 const source={board:'aa_intelligence_index',adapter:'aa-models',url:'https://artificialanalysis.ai/leaderboards/models'};
 const parsed={version:'5.0.1',rows:[{sourceId:'unknown',identity:'unknown',label:'unknown',score:42}]};
 assert.throws(()=>prepareCurrentSource(source,{...parsed,version:'6.0'},'2026-11-04',catalog,identities));
 const quarantined=prepareCurrentSource(source,parsed,'2026-11-04',catalog,identities);
 assert.equal(quarantined.rows[0].model,null);
 assert.equal(quarantined.rows[0].exclusion,'identity-review-required');
});
test('Arena preserves source negative signs and stable IDs, including near-zero and identically labelled runs',()=>{
 const source=parseArenaData(read('data/leaderboards/imports/arena-agent-2026-11-04.json').rawPayload,'arena_agent_mode');
 assert.equal(source.rows.filter(r=>r.score===null).length,0);
 assert.ok(source.rows.find(r=>r.label==='Solar Pro 4').score<0);
 assert.equal(source.rows.find(r=>r.label==='DeepSeek-V4-Pro (High, 20260813)').score,-0.25836097228167776);
 const mistral=source.rows.filter(r=>r.label==='Mistral Large 4');
 assert.equal(new Set(mistral.map(r=>r.sourceId)).size,2);
 assert.deepEqual(new Set(mistral.map(r=>r.serviceMode)),new Set(['agent','text']));
 assert.notEqual(identities.arenaSources['gpt-5.3-codex'],identities.arenaSources['gpt-5.3-codex-2026-03-05']);
});
test('Arena structured parser rejects partial arrays, invalid signs and duplicate IDs; retains preliminary status',()=>{
 const imported=read('data/leaderboards/imports/arena-agent-2026-11-04.json');
 const parsed=parseArenaData(imported.rawPayload,'arena_agent_mode');
 assert.equal(parsed.rows.length,59);
 assert.equal(parsed.rows.find(r=>r.label==='Gemini 4 Carbon (High)').preliminary,true);
 assert.throws(()=>parseArenaData({...imported.rawPayload,modelCount:60},'arena_agent_mode'));
 const bad=structuredClone(imported.rawPayload);bad.rows.at(-1).avgScore.value=Math.abs(bad.rows.at(-1).avgScore.value);
 assert.throws(()=>parseArenaData(bad,'arena_agent_mode'));
 const duplicate=structuredClone(imported.rawPayload);duplicate.rows[1].contenderName=duplicate.rows[0].contenderName;
 assert.throws(()=>parseArenaData(duplicate,'arena_agent_mode'));
});
test('original discovery queue is completely resolved or explicitly rejected, plus signs distinguish model names',()=>{
 const review=read('data/leaderboards/identity-review.json');
 assert.equal(review.originalDiscovery.length,185);
 assert.ok(review.originalDiscovery.every(r=>r.status==='resolved'?catalog.models.some(m=>m.id===r.model):r.status==='excluded-navigation'));
 assert.notEqual(resolveModel('Command A+',catalog.models),resolveModel('Command A',catalog.models));
 assert.equal(Object.keys(CURRENT_BOARDS).length,8);
});

test('enabled fallback is an explicit primary-model reference; unknown identity and observed fallback stay excluded',()=>{
 const source={board:'aa_intelligence_index',adapter:'aa-models',url:'https://artificialanalysis.ai/leaderboards/models'};
 const model=baseline.points[0].model;
 const rows=[{sourceId:'safe',identity:model,label:'Safe',score:40},
 {sourceId:'unknown',releaseSlug:'unreviewed-new-model',identity:'New',label:'New',score:50},
 {sourceId:'fallback',identity:model,label:'Default Fallback',score:60,fallbackEnabled:true},
 {sourceId:'observed',identity:model,label:'Observed Fallback',score:70,fallbackEnabled:true,fallback:true}];
 const prepared=prepareCurrentSource(source,{version:'5.0.1',rows},'2026-11-13',catalog,identities);
 assert.equal(prepared.rows[0].exclusion,null);
 assert.equal(prepared.rows[2].exclusion,'fallback-enabled');
 const result=mergeCurrentLeaderboards(baseline,{...snapshot,sources:snapshot.sources.map(s=>s.board===source.board?prepared:s)});
 const configs=result.configurations.filter(c=>c.board===prepared.id);
 assert.equal(configs.length,3);
 const reference=configs.find(c=>c.variant==='Default Fallback');
 assert.equal(reference.fallback_observed,null,'absence of actual-use statistics is unknown, not a verified zero');
 assert.equal(reference.fallback_enabled,true);
 assert.equal(reference.price_mapping_exclusion,null);
 const refs=result.mappings.filter(m=>m.configuration_id===reference.configuration_id);
 assert.ok(refs.length);
 assert.ok(refs.every(m=>m.mapping_kind==='primary_model_configuration_reference'&&m.mapping_confidence==='low'&&m.quota_effort_matched===null));
 const observed=configs.find(c=>c.variant==='Observed Fallback');
 assert.ok(!result.mappings.some(m=>m.configuration_id===observed.configuration_id));
 assert.equal(result.leaderboardCoverage[prepared.id].excluded.length,2);
 assert.equal(result.leaderboardCoverage[prepared.id].matchedConfigurations,2);
});
