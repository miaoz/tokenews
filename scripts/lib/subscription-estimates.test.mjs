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

test('anchor-pool supports worth-ratio and same-token-carry with strict low confidence and vendor guards',()=>{
 const d={
  conventions:{monthWeeks:4,anthropicTokenMix:{cache:.97,cacheWrite:.025,output:.005},standardTokenMix:{cache:.97,input:.025,output:.005}},
  models:[
   {id:'gemini-3.8-flash',name:'Gemini 3.8 Flash',maker:'Google'},
   {id:'gemini-4-neon',name:'Gemini 4 Neon',maker:'Google'},
   {id:'gpt-6-astra',name:'GPT-6 Astra',maker:'OpenAI'},
   {id:'gpt-6.2-astra',name:'GPT-6.2 Astra',maker:'OpenAI'},
  ],
  points:[
   {id:'google_ai_pro_us::gemini-3.8-flash',plan_id:'google_ai_pro_us',model:'gemini-3.8-flash',vendor:'Google',billing:'subscription',monthly_tokens:2581e6,real_usd_per_mtok:.0077450601,data_date:'2026-09-27'},
   {id:'chatgpt_pro_20x::gpt-6-astra',plan_id:'chatgpt_pro_20x',model:'gpt-6-astra',vendor:'OpenAI',billing:'subscription',monthly_tokens:3812e6,real_usd_per_mtok:.052465897,data_date:'2026-09-21'},
  ],
  mappings:[],configurations:[],supersededPoints:[],
 };
 const m={
  version:1,checkedAt:'2026-11-18',evidenceFiles:['evidence-2026-11-18.json'],archivedPointIds:[],
  entries:[
   {id:'estimate:google-ai-ultra-20x:gemini-4-neon',planId:'google_ai_ultra_20x_estimate',upstreamPlanIds:['google_ai_ultra_20x_us'],name:'Google AI Ultra 20x',model:'gemini-4-neon',monthlyUsd:199.99,confidence:'low',sampleDate:'2026-11-18',sampleFrom:'Google AI Pro · gemini-3.8-flash',calibration:{meter:'anchor-pool',anchorMode:'worth-ratio',anchorPointId:'google_ai_pro_us::gemini-3.8-flash',planRatio:20,anchorRates:{cache:.075,input:.75,output:3.75}},rates:{cache:.15,input:3,output:15},sources:[{label:'Antigravity models',url:'https://antigravity.google/docs/models'}],note:{en:'Derived from Pro main pool.',zh:'基于 Pro 主池折算。'}},
   {id:'estimate:chatgpt-pro-20x:gpt-6.2-astra',planId:'chatgpt_pro_20x_estimate',upstreamPlanIds:['chatgpt_pro_20x'],name:'ChatGPT Pro 20x',model:'gpt-6.2-astra',monthlyUsd:200,confidence:'low',sampleDate:'2026-11-18',sampleFrom:'ChatGPT Pro 20x · gpt-6-astra',calibration:{meter:'anchor-pool',anchorMode:'same-token-carry',anchorPointId:'chatgpt_pro_20x::gpt-6-astra',planRatio:1},rates:{cache:.4,input:8,cacheWrite:10,output:40},freshInputBilling:'cache-write',sources:[{label:'GPT-6.2 Astra docs',url:'https://developers.openai.com/api/docs/models/gpt-6.2-astra'}],note:{en:'Carries over GPT-6 Astra tokens.',zh:'沿用 GPT-6 Astra 额度。'}},
  ],
 };
 const res=mergeSubscriptionEstimates(d,m);
 const neon=res.points.find(p=>p.id==='estimate:google-ai-ultra-20x:gemini-4-neon');
 const astra=res.points.find(p=>p.id==='estimate:chatgpt-pro-20x:gpt-6.2-astra');
 assert.ok(Math.abs(neon.monthly_yi - (2581*.11025*20/.2955/100)) < 1e-9);
 assert.equal(neon.workload,'standard');assert.equal(neon.quota_is_estimated,true);assert.equal(neon.confidence,'low');
 assert.equal(astra.monthly_tokens,3812e6);assert.equal(astra.workload,'cacheWrite');assert.ok(Math.abs(astra.list_blended_usd_per_mtok-.838)<1e-12);
 const badConf=clone(m);badConf.entries[0].confidence='medium';assert.throws(()=>mergeSubscriptionEstimates(d,badConf),/invalid calibration/);
 const crossVendor=clone(m);crossVendor.entries[0].calibration.anchorPointId='chatgpt_pro_20x::gpt-6-astra';assert.throws(()=>mergeSubscriptionEstimates(d,crossVendor),/invalid anchor point/);
});

test('anchor-pool supports lowCache workloadMix and enforces anchor workload matching',()=>{
 const d={
  conventions:{monthWeeks:4,anthropicTokenMix:{cache:.97,cacheWrite:.025,output:.005},standardTokenMix:{cache:.97,input:.025,output:.005},lowCacheTokenMix:{cache:.85,input:.145,output:.005}},
  models:[
   {id:'gemini-4-neon',name:'Gemini 4 Neon',maker:'Google'},
   {id:'gemini-4-carbon',name:'Gemini 4 Carbon',maker:'Google'},
   {id:'gpt-6.1-sol',name:'GPT-6.1 Sol',maker:'OpenAI'},
  ],
  points:[
   {id:'google_ai_pro_us::gemini-4-neon',plan_id:'google_ai_pro_us',model:'gemini-4-neon',vendor:'Google',billing:'subscription',workload:'lowCache',monthly_tokens:536e6,real_usd_per_mtok:.037294776,data_date:'2026-11-20'},
   {id:'google_ai_pro_us::gemini-4-argon',plan_id:'google_ai_pro_us',model:'gpt-6.1-sol',vendor:'Google',billing:'subscription',workload:'standard',monthly_tokens:100e6,real_usd_per_mtok:.1,data_date:'2026-10-16'},
  ],
  mappings:[],configurations:[],supersededPoints:[],
 };
 const m={
  version:1,checkedAt:'2026-11-22',evidenceFiles:['evidence-2026-11-22.json'],archivedPointIds:[],
  entries:[
   {id:'estimate:ultra5x:neon',planId:'google_ai_ultra_5x_estimate',upstreamPlanIds:['google_ai_ultra_5x_us'],name:'Google AI Ultra 5x',model:'gemini-4-neon',monthlyUsd:99.99,confidence:'low',sampleDate:'2026-11-20',sampleFrom:'Google AI Pro · gemini-4-neon',calibration:{meter:'anchor-pool',anchorMode:'same-token-carry',anchorPointId:'google_ai_pro_us::gemini-4-neon',planRatio:5,workloadMix:'lowCache'},rates:{cache:.15,input:3,output:15},sources:[{label:'Issue 248',url:'https://github.com/Fei2411/real-api-pricing/issues/248'}],note:{en:'Low-cache carry.',zh:'低缓存沿用。'}},
   {id:'estimate:ultra5x:carbon',planId:'google_ai_ultra_5x_estimate',upstreamPlanIds:['google_ai_ultra_5x_us'],name:'Google AI Ultra 5x',model:'gemini-4-carbon',monthlyUsd:99.99,confidence:'low',sampleDate:'2026-11-20',sampleFrom:'Google AI Pro · gemini-4-neon',calibration:{meter:'anchor-pool',anchorMode:'worth-ratio',anchorPointId:'google_ai_pro_us::gemini-4-neon',planRatio:5,workloadMix:'lowCache',anchorRates:{cache:.15,input:3,output:15}},rates:{cache:.2,input:4,output:20},sources:[{label:'Issue 248',url:'https://github.com/Fei2411/real-api-pricing/issues/248'}],note:{en:'Low-cache worth ratio.',zh:'低缓存价值折算。'}},
  ],
 };
 const res=mergeSubscriptionEstimates(d,m);
 const neon5=res.points.find(p=>p.id==='estimate:ultra5x:neon');
 const carbon5=res.points.find(p=>p.id==='estimate:ultra5x:carbon');
 assert.equal(neon5.workload,'lowCache');
 assert.equal(neon5.monthly_tokens,536e6*5);
 assert.ok(Math.abs(neon5.list_blended_usd_per_mtok-.6375)<1e-12);
 assert.equal(carbon5.workload,'lowCache');
 assert.ok(Math.abs(carbon5.monthly_yi - 20.1)<1e-9);
 assert.match(carbon5.note_en,/85%\/14\.5%\/0\.5% low-cache mix/);
 const badAnchorWorkload=clone(m);badAnchorWorkload.entries[0].calibration.anchorPointId='google_ai_pro_us::gemini-4-argon';
 assert.throws(()=>mergeSubscriptionEstimates(d,badAnchorWorkload),/anchor workload mismatch/);
 const badWrite=clone(m);badWrite.entries[0].freshInputBilling='cache-write';badWrite.entries[0].rates.cacheWrite=3.75;
 assert.throws(()=>mergeSubscriptionEstimates(d,badWrite),/invalid freshInputBilling/);
});

test('direct-weekly supports channel, promoUntil, exact math and upstream coexistence guard',()=>{
 const d={
  conventions:{monthWeeks:4,anthropicTokenMix:{cache:.97,cacheWrite:.025,output:.005},standardTokenMix:{cache:.97,input:.025,output:.005},lowCacheTokenMix:{cache:.85,input:.145,output:.005}},
  models:[{id:'gemini-4-carbon',name:'Gemini 4 Carbon',maker:'Google'}],
  points:[],mappings:[],configurations:[],supersededPoints:[],
 };
 const m={
  version:1,checkedAt:'2026-11-22',evidenceFiles:['evidence-2026-11-22.json'],archivedPointIds:[],
  entries:[
   {id:'estimate:devin-max:gemini-4-carbon',planId:'devin_max_estimate',upstreamPlanIds:['devin_max'],name:'Devin Max',channel:'Devin',model:'gemini-4-carbon',monthlyUsd:200,confidence:'medium',sampleDate:'2026-11-21',promoUntil:'2026-11-30',sampleFrom:'Devin Max · gemini-4-carbon',calibration:{meter:'direct-weekly',weeklyWorthUsd:200,monthWeeks:4,workloadMix:'lowCache'},rates:{cache:.1,input:2,output:10},sources:[{label:'Issue 251',url:'https://github.com/Fei2411/real-api-pricing/issues/251'}],note:{en:'Maintainer sample.',zh:'维护者样本。'}},
  ],
 };
 const res=mergeSubscriptionEstimates(d,m), p=res.points[0];
 assert.equal(p.channel,'Devin');assert.equal(p.vendor,'Google');
 assert.equal(p.promo_until,'2026-11-30');assert.equal(p.workload,'lowCache');
 assert.ok(Math.abs(p.list_blended_usd_per_mtok-.425)<1e-12);
 assert.ok(Math.abs(p.monthly_yi-(800/.425/100))<1e-9);
 assert.ok(Math.abs(p.real_usd_per_mtok-(200/(800/.425)))<1e-12);
 const badPromo=clone(m);badPromo.entries[0].promoUntil='2026-13-01';assert.throws(()=>mergeSubscriptionEstimates(d,badPromo),/invalid entry provenance/);
 const dup=clone(d);dup.points.push({id:'devin_max::gemini-4-carbon',plan_id:'devin_max',model:'gemini-4-carbon',data_date:'2026-11-21'});
 assert.throws(()=>mergeSubscriptionEstimates(dup,m),/upstream plan sample requires review/);
});

test('anchor-pool and direct-weekly support gemini workloadMix and enforce anchor workload matching',()=>{
 const d={
  conventions:{monthWeeks:4,anthropicTokenMix:{cache:.97,cacheWrite:.025,output:.005},standardTokenMix:{cache:.97,input:.025,output:.005},lowCacheTokenMix:{cache:.85,input:.145,output:.005},geminiTokenMix:{cache:.9,input:.095,output:.005}},
  models:[
   {id:'gemini-4-neon',name:'Gemini 4 Neon',maker:'Google'},
   {id:'gemini-4-hydrogen',name:'Gemini 4 Hydrogen',maker:'Google'},
   {id:'gemini-4-carbon',name:'Gemini 4 Carbon',maker:'Google'},
  ],
  points:[
   {id:'google_ai_pro_us::gemini-4-neon',plan_id:'google_ai_pro_us',model:'gemini-4-neon',vendor:'Google',billing:'subscription',workload:'gemini',monthly_tokens:691e6,real_usd_per_mtok:.028929088,data_date:'2026-11-20'},
   {id:'google_ai_pro_us::gemini-3.6-flash',plan_id:'google_ai_pro_us',model:'gemini-4-neon',vendor:'Google',billing:'subscription',workload:'lowCache',monthly_tokens:500e6,real_usd_per_mtok:.04,data_date:'2026-09-20'},
  ],
  mappings:[],configurations:[],supersededPoints:[],
 };
 const m={
  version:1,checkedAt:'2026-11-26',evidenceFiles:['evidence-2026-11-26.json'],archivedPointIds:[],
  entries:[
   {id:'estimate:pro:hydrogen',planId:'google_ai_pro_estimate',upstreamPlanIds:['google_ai_pro_us'],name:'Google AI Pro',model:'gemini-4-hydrogen',monthlyUsd:19.99,confidence:'low',sampleDate:'2026-11-20',sampleFrom:'Google AI Pro · gemini-4-neon',calibration:{meter:'anchor-pool',anchorMode:'worth-ratio',anchorPointId:'google_ai_pro_us::gemini-4-neon',planRatio:1,workloadMix:'gemini',anchorRates:{cache:.15,input:3,output:15}},rates:{cache:.075,input:1.5,output:7.5},sources:[{label:'Gemini mix',url:'https://github.com/Fei2411/real-api-pricing'}],note:{en:'Gemini mix.',zh:'Gemini 负载。'}},
   {id:'estimate:devin-max:carbon',planId:'devin_max_estimate',upstreamPlanIds:['devin_max'],name:'Devin Max',channel:'Devin',model:'gemini-4-carbon',monthlyUsd:200,confidence:'medium',sampleDate:'2026-11-21',sampleFrom:'Devin Max · gemini-4-carbon',calibration:{meter:'direct-weekly',weeklyWorthUsd:200,monthWeeks:4,workloadMix:'gemini'},rates:{cache:.2,input:4,output:20},sources:[{label:'Gemini mix',url:'https://github.com/Fei2411/real-api-pricing'}],note:{en:'Gemini direct.',zh:'Gemini 直算。'}},
  ],
 };
 const res=mergeSubscriptionEstimates(d,m);
 const h=res.points.find(p=>p.id==='estimate:pro:hydrogen');
 const c=res.points.find(p=>p.id==='estimate:devin-max:carbon');
 assert.equal(h.workload,'gemini');
 assert.ok(Math.abs(h.list_blended_usd_per_mtok-.2475)<1e-12);
 assert.ok(Math.abs(h.monthly_yi-(6.91*.495/.2475))<1e-9);
 assert.match(h.note_en,/90%\/9\.5%\/0\.5% Gemini workload mix/);
 assert.equal(c.workload,'gemini');
 assert.ok(Math.abs(c.list_blended_usd_per_mtok-.66)<1e-12);
 const badAnchor=clone(m);badAnchor.entries[0].calibration.anchorPointId='google_ai_pro_us::gemini-3.6-flash';
 assert.throws(()=>mergeSubscriptionEstimates(d,badAnchor),/anchor workload mismatch/);
});
