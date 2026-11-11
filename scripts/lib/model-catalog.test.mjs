import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, mergeCatalog, validateCatalog } from './model-catalog.mjs';
import { parseLeaderboard, appendSnapshots, discoverAA } from './leaderboards.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = { version: 1, models: [{id:'new-model', name:'New Model', maker:'Maker', source:'https://example.com/model', checkedAt:'2026-11-04'}] };
const target = { adapter:'artificial-analysis', model:'new-model', label:'New Model (High)', version:'5.0.1', variant:'high', effort:'high', url:'https://artificialanalysis.ai/models/new-model' };
const html = '<h1>New Model (High)</h1><p>Model summary Intelligence Updated # 2 / 62</p><p>New Model (High) scores 60 on the Artificial Analysis Intelligence Index.</p><p>Artificial Analysis Intelligence Index v5.0.1 includes evaluations</p>';
const record = parseLeaderboard(html, target, '2026-11-04');
const upstream = { points: [], configurations: [], boards: { aa_intelligence_index: {name:'AA v4.3'} }, mappings: [] };
test('models without price points remain visible, and local benchmarks do not overwrite old versions or create price mappings', () => {
  const data = mergeCatalog(upstream, catalog, { version:1, records:[record] });
  assert.equal(data.models[0].id, 'new-model');
  assert.equal(data.points.length, 0);
  assert.equal(data.mappings.length, 0);
  assert.equal(data.boards.aa_intelligence_index.name, 'AA v4.3');
  assert.equal(data.configurations[0].board, 'aa_intelligence_index_v5_0_1');
  assert.equal(data.configurations[0].source_rank, 2);
  assert.deepEqual(upstream.configurations, []);
});
test('reject unknown models, slug collisions, missing source and invalid scores', () => {
  for(const bad of [{model:'unknown'}, {score:null}, {score:NaN}, {sourceHome:'javascript:bad'}, {sourceRank:0}])
    assert.throws(() => mergeCatalog(upstream, catalog, {version:1,records:[{...record,...bad}]}));
  assert.throws(() => validateCatalog({version:1, models:[...catalog.models, {...catalog.models[0]}]}));
  assert.throws(() => validateCatalog({version:1, models:[{...catalog.models[0],id:'m.1'}, {...catalog.models[0],id:'m-1'}]}));
});
test('upstream sync additions still join the catalog; local identity takes precedence', () => {
  const data = mergeCatalog({...upstream, points:[{model:'new-model',model_display:'Old name',vendor:'Wrong'}, {model:'upstream-model',model_display:'Upstream',vendor:'Google'}]}, catalog, {version:1,records:[]});
  assert.equal(data.models[0].name, 'New Model');
  assert.equal(data.models[1].maker, 'Google');
});
test('parser refuses changed versions, wrong model identity, missing score and ambiguous versions', () => {
  for(const bad of [html.replaceAll('5.0.1','6.0'), html.replaceAll('New Model','Other Model'), html.replace('scores 60','scores unavailable'), html+' Artificial Analysis Intelligence Index v4.3'])
    assert.throws(() => parseLeaderboard(bad,target,'2026-11-04'));
  assert.equal(parseLeaderboard(html+'<script>New Model (High) scores 999 on the Artificial Analysis Intelligence Index</script>',target,'2026-11-04').score,60);
});
test('Crusader adapter preserves source ranking and rejects effort changes', () => {
  const t={...target,adapter:'crusader-bench',version:'1.7'};
  const h='<h1>New Model (High)</h1> Reasoning high Benchmark v1.7 Score, every map 32.1 5th of 12 models with a score on every map';
  assert.equal(parseLeaderboard(h,t,'2026-11-04').sourceRank,5);
  assert.throws(()=>parseLeaderboard(h.replace('Reasoning high','Reasoning low'),t,'2026-11-04'));
});
test('snapshots preserve history, replace same-day observations and publish latest values', () => {
  const old={...record,checkedAt:'2026-11-03',score:59};
  const archive=appendSnapshots({version:1,records:[old]},[record]);
  assert.equal(archive.records.length,2);
  assert.equal(appendSnapshots(archive,[record]).records.length,2);
  assert.throws(()=>appendSnapshots(archive,[old]));
  const merged=mergeCatalog(upstream,catalog,archive);
  assert.equal(merged.configurations.length,1);
  assert.equal(merged.configurations[0].score,60);
});
test('discovery normalizes release links and fails on empty pages', () => {
  const h=Array.from({length:12},(_,i)=>`<a href="/models/releases/model-${i}">Model ${i}</a>`).join('');
  const found=discoverAA(h,new Set(['https://artificialanalysis.ai/models/model-0']));
  assert.equal(found.length,11);
  assert.throws(()=>discoverAA('<p>Unavailable</p>',new Set()));
});
test('maintained catalog includes both requested models with no fabricated price records', async () => {
  const {catalog,snapshots}=await loadCatalog(root);
  const result=mergeCatalog(upstream,catalog,snapshots);
  for(const id of ['gemini-4-carbon','kimi-k3.1-pro']) {
    assert.ok(result.models.some(m=>m.id===id));
    assert.ok(result.configurations.some(c=>c.model===id));
  }
  assert.equal(result.points.length,0);
});

test('price coverage counts catalog-only models as missing, not free', async () => {
  const {priceCoverage} = await import('./api-prices.mjs');
  const coverage = priceCoverage({models:{}}, [], catalog.models);
  assert.equal(coverage.totalModels,1);
  assert.equal(coverage.missingModels,1);
  assert.equal(coverage.rows[0].provider,'Maker');
});

test('a fully mapped release page produces an empty discovery queue', () => {
  const h=Array.from({length:12},(_,i)=>`<a href="/models/releases/model-${i}">Model ${i}</a>`).join('');
  assert.deepEqual(discoverAA(h,new Set(Array.from({length:12},(_,i)=>`https://artificialanalysis.ai/models/model-${i}`))),[]);
});

test('Claude catalog and price references add no evidence, while subsequent upstream samples and scores survive', async () => {
  const {addApiPricePoints} = await import('./api-price-points.mjs');
  const {loadApiPrices} = await import('./api-prices.mjs');
  const {catalog} = await loadCatalog(root);
  const {catalog:prices} = await loadApiPrices(`${root}/data/api-prices`);
  const referenceOnly = {version:1,entries:[]};
  const conventions = {standardTokenMix:{cache:.97,input:.025,output:.005}};
  const merge = source => addApiPricePoints(
    mergeCatalog({...source,conventions},catalog,{version:1,records:[]}),prices,referenceOnly);
  const empty = merge(upstream);
  for (const model of ['claude-fable-5.2','claude-mythos-5.2']) {
    assert.ok(empty.models.some(m=>m.id===model));
    assert.ok(prices.models[model]);
  }
  assert.deepEqual(empty.points,[]);
  assert.deepEqual(empty.configurations,[]);
  assert.deepEqual(empty.mappings,[]);
  // Synthetic evidence exercises the transition from catalog-only to upstream
  // coverage without depending on when a real source publishes a new result.
  const point = {id:'fixture-plan::claude-fable-5.2',model:'claude-fable-5.2',
    model_display:'Claude Fable 5.2',vendor:'Anthropic',monthly_yi:1,
    real_usd_per_mtok:.2,data_date:'2026-11-09'};
  const sampleOnly = merge({...upstream,points:[point]});
  assert.deepEqual(sampleOnly.points,[point]);
  assert.deepEqual(sampleOnly.configurations,[]);
  assert.deepEqual(sampleOnly.mappings,[]);
  const configuration = {configuration_id:'fixture:fable52',model:'claude-fable-5.2',score:42};
  const mapping = {point_id:point.id,configuration_id:configuration.configuration_id};
  const source = {...upstream,points:[point],configurations:[configuration],mappings:[mapping]};
  const before = structuredClone(source);
  const merged = merge(source);
  assert.deepEqual(merged.points,source.points);
  assert.deepEqual(merged.configurations,source.configurations);
  assert.deepEqual(merged.mappings,source.mappings);
  assert.deepEqual(source,before);
  assert.ok(!merged.points.some(p=>p.model==='claude-mythos-5.2'));
  assert.ok(!merged.configurations.some(c=>c.model==='claude-mythos-5.2'));
});
