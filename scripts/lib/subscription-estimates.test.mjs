import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSubscriptionEstimates} from './subscription-estimates.mjs';
const model='claude-fable-5.2', old='claude_pro::claude-fable-5.2';
const data={conventions:{monthWeeks:4,anthropicTokenMix:{cache:.97,cacheWrite:.025,output:.005}},models:[{id:model,name:'Claude Fable 5.2',maker:'Anthropic'}],points:[{id:old,plan_id:'claude_pro',model,data_date:'2026-11-09',monthly_tokens:782e6,real_usd_per_mtok:.025575448,note:'original'}],mappings:[{point_id:old,configuration_id:'original'}],configurations:[{configuration_id:'original',model}],supersededPoints:[{id:'existing-archive'}]};
const manifest={version:1,checkedAt:'2026-11-13',evidenceFiles:['evidence-2026-11-13.json'],archivedPointIds:[{id:old,model,latestSampleDate:'2026-11-09',expectedMonthlyTokens:782000000,expectedPriceUsdPerMillion:.025575448,reason:{en:'Historical launch sample',zh:'历史活动样本'}}],entries:[{id:'estimate:max',planId:'claude_max_estimate',upstreamPlanIds:['claude_max_5x','claude_max'],name:'Claude Max',model,monthlyUsd:100,confidence:'medium',sampleDate:'2026-11-12',sampleFrom:'Claude Max · claude-fable-5.2',calibration:{sampleWorthUsd:80.385168,quotaFraction:.27,meter:'fable-weekly',planRatio:1,monthWeeks:4},rates:{cache:.2,input:8,cacheWrite:10,output:40},sources:[{label:'Audited sample',url:'https://example.com/sample'}],note:{en:'Single audited calibration.',zh:'单次审计校准。'}}]};
const clone=v=>structuredClone(v);
test('normalizes audited sub-meter once, preserves originals and removes only archived mappings',()=>{
 const before=clone(data), m=clone(manifest);const result=mergeSubscriptionEstimates(data,manifest),p=result.points[0];
 const expected=80.385168/.27*4/.644*1e6;
 assert.equal(p.monthly_tokens,expected);assert.equal(p.monthly_yi,expected/1e8);
 assert.equal(p.real_usd_per_mtok,100/(expected/1e6));assert.equal(p.list_blended_usd_per_mtok,.644);
 assert.equal(p.list_price.input,8);assert.equal(p.list_price.cached,.2);
 assert.equal(p.d,100/(80.385168/.27*4));assert.equal(p.quota_is_estimated,true);
 assert.equal(p.data_date_kind,'derived');assert.equal(p.data_date_from,'Claude Max · claude-fable-5.2');assert.equal(p.confidence,'medium');assert.equal(p.workload,'anthropic');
 assert.match(p.note_en,/not an official or guaranteed/);assert.match(p.note,/不再次折半/);
 assert.equal(p.evidence.at(-1).url,'/data/evidence/subscription-estimates-evidence-2026-11-13.json');
 assert.deepEqual(result.supersededPoints,[...data.supersededPoints,data.points[0]]);assert.deepEqual(result.mappings,[]);
 assert.deepEqual(result.configurations,data.configurations);assert.deepEqual(data,before);assert.deepEqual(manifest,m);
});
test('Ultra ratio two is explicitly low confidence and does not add another cap',()=>{
 const m=clone(manifest);m.entries.push({...clone(m.entries[0]),id:'estimate:ultra',planId:'claude_ultra_estimate',upstreamPlanIds:['claude_max_20x','claude_ultra'],name:'Claude Ultra',monthlyUsd:200,confidence:'low',calibration:{...m.entries[0].calibration,planRatio:2}});
 const [max,ultra]=mergeSubscriptionEstimates(data,m).points;
 assert.equal(ultra.monthly_tokens,2*max.monthly_tokens);assert.equal(ultra.real_usd_per_mtok,max.real_usd_per_mtok);assert.equal(ultra.confidence,'low');
});
test('rejects stale archive requests and ID/plan/model collisions without changing inputs',()=>{
 for(const mutate of [d=>d.points[0].data_date='2026-11-10',d=>d.points[0].model='other',d=>d.points=[],d=>d.points.push({...d.points[0],id:'estimate:max'}),d=>d.points.push({...d.points[0],id:'other',plan_id:'claude_max_estimate'})]){
 const d=clone(data);mutate(d);const before=clone(d);assert.throws(()=>mergeSubscriptionEstimates(d,manifest),/review required/);assert.deepEqual(d,before);
 }
 const m=clone(manifest);m.entries.push(clone(m.entries[0]));assert.throws(()=>mergeSubscriptionEstimates(data,m),/collision/);
});
test('rejects invalid provenance, units, rounding policy and extra cap assumptions',()=>{
 const cases=[m=>m.entries[0].sampleFrom='',m=>m.entries[0].confidence='high',m=>m.entries[0].sources[0].url='http://example.com',m=>m.entries[0].note.zh='',m=>m.entries[0].sampleDate='2026-11-14',m=>m.entries[0].calibration.quotaFraction=27,m=>m.entries[0].calibration.quotaFraction=0,m=>m.entries[0].calibration.meter='main-weekly',m=>m.entries[0].calibration.monthWeeks=30/7,m=>m.entries[0].calibration.cap=.5,m=>m.entries[0].calibration.planRatio=2,m=>m.entries[0].calibration.sampleWorthUsd=Infinity,m=>m.entries[0].rates.cacheWrite=16,m=>m.evidenceFiles=['../secret'],m=>m.archivedPointIds[0].reason.en=''];
 for(const mutate of cases){const m=clone(manifest);mutate(m);assert.throws(()=>mergeSubscriptionEstimates(data,m),/review required/);}
 const d=clone(data);d.conventions.anthropicTokenMix.cache=.98;assert.throws(()=>mergeSubscriptionEstimates(d,manifest),/normalization/);
});
test('28 percent conservative scenario lowers quota and increases cost; unaffected records survive',()=>{
 const m=clone(manifest);m.entries[0].calibration.quotaFraction=.28;
 const d=clone(data);d.points.push({id:'keep',plan_id:'keep',model});d.mappings.push({point_id:'keep',configuration_id:'original'});
 const r=mergeSubscriptionEstimates(d,m),p=r.points.find(p=>p.quota_is_estimated);
 assert.ok(p.monthly_tokens<mergeSubscriptionEstimates(data,manifest).points[0].monthly_tokens);
 assert.deepEqual(r.points[0],d.points[1]);assert.deepEqual(r.mappings,[d.mappings[1]]);
});

test('reviewed upstream plan aliases block coexistence, using either plan_id or stable ID prefix',()=>{
 for (const alias of ['claude_max_5x','claude_max']) for(const usePlanId of [true,false]) {
  const d=clone(data);d.points.push({id:usePlanId?'another-id':`${alias}::${model}`,plan_id:usePlanId?alias:'different-plan',model,data_date:'2026-11-14'});
  assert.throws(()=>mergeSubscriptionEstimates(d,manifest),/upstream plan sample requires review/);
 }
 const m=clone(manifest);m.entries[0]={...m.entries[0],upstreamPlanIds:['claude_max_20x','claude_ultra'],planId:'claude_ultra_estimate'};
 for(const alias of m.entries[0].upstreamPlanIds){const d=clone(data);d.points.push({id:`${alias}::${model}`,model});assert.throws(()=>mergeSubscriptionEstimates(d,m),/upstream plan sample requires review/);}
 const d=clone(data);d.points.push({id:'claude_max_5x::other-model',plan_id:'claude_max_5x',model:'other-model'});
 assert.doesNotThrow(()=>mergeSubscriptionEstimates(d,manifest));
 for(const aliases of [undefined,[],[''],['  '],['claude_max','claude_max'],[' claude_max']]){const m=clone(manifest);m.entries[0].upstreamPlanIds=aliases;assert.throws(()=>mergeSubscriptionEstimates(data,m),/review required/);}
});
test('same-date archive quota or price corrections require a fresh explicit review',()=>{
 for(const field of ['monthly_tokens','real_usd_per_mtok']){
  const d=clone(data);d.points[0][field]*=1.01;assert.equal(d.points[0].data_date,'2026-11-09');
  assert.throws(()=>mergeSubscriptionEstimates(d,manifest),/archive identity\/date changed/);
 }
 for(const field of ['expectedMonthlyTokens','expectedPriceUsdPerMillion']){
  const m=clone(manifest);delete m.archivedPointIds[0][field];assert.throws(()=>mergeSubscriptionEstimates(data,m),/invalid archive request/);
 }
});
