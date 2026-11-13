import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addApiPricePoints} from './api-price-points.mjs';
import {mergeCurrentLeaderboards} from './current-leaderboards.mjs';
import {loadApiPrices} from './api-prices.mjs';
import {fileURLToPath} from 'node:url';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const {catalog}=await loadApiPrices(fileURLToPath(new URL('../../data/api-prices',import.meta.url)));
const original=read('upstream/derived/points.json');
const base={...original,models:read('data/models.json').models,conventions:read('upstream/data/conventions.json'),configurations:[],mappings:[]};
const manifest=read('data/api-price-points.json');
test('reviewed API points preserve historical prices, calculate costs and join exact eligible configurations',()=>{
 const result=addApiPricePoints(base,catalog,manifest);
 assert.deepEqual(result.points.slice(0,base.points.length),base.points);
 const pro=result.points.find(p=>p.model==='kimi-k3.1-pro'&&p.price_origin==='maintained-api');
 assert.ok(Math.abs(pro.real_usd_per_mtok-.294)<1e-12);
 assert.equal(pro.monthly_tokens,null);
 assert.equal(pro.data_date,'2026-11-04');
 const joined=mergeCurrentLeaderboards(result,read('data/leaderboards/current.json'));
 const matches=joined.mappings.filter(m=>m.point_id===pro.id);
 assert.deepEqual(matches.map(m=>m.configuration_id.split(':')[1]).sort(),[
  'aa_intelligence_index_v5_0_1','aa_terminal_bench_v4_0','arena_agent_mode_current',
  'arena_code_current','open_design_arena_current','terminal_bench_v4_1',
 ].sort(),'current official TB 4.1 and restored Arena rows join without borrowing other versions');
 assert.ok(matches.every(m=>m.quota_effort_matched===null));
 const fast=result.points.find(p=>p.model==='kimi-k3.1-pro-highspeed');
 assert.ok(!joined.mappings.some(m=>m.point_id===fast.id),'highspeed cannot borrow standard-model scores');
 for(const id of ['muse-wonder','minimax-m3.1-flash','deepseek-v4.1-flash-1017','beam-1.0','muse-spark-open','gpt-6.1-terra']){
  const point=result.points.find(p=>p.model===id&&p.price_origin==='maintained-api');
  assert.ok(point,id);assert.ok(joined.mappings.some(m=>m.point_id===point.id),id);
 }
 const terra=result.points.filter(p=>p.model==='gpt-6.1-terra');
 assert.ok(Math.abs(terra[0].real_usd_per_mtok-.10475)<1e-12);
 assert.ok(Math.abs(terra[1].real_usd_per_mtok-.197)<1e-12);
 assert.equal(terra[0].workload,'cacheWrite');
 assert.equal(result.points.find(p=>p.model==='beam-1.0').channel,'Baseten');
 assert.ok(!result.points.some(p=>p.model==='mistral-large-4'),'unresolved preview version does not get a current endpoint price');
});
test('context bands and cache-write rates must remain explicitly reviewed',()=>{
 const entry=manifest.entries.find(e=>e.model==='gpt-6.1-terra');
 assert.throws(()=>addApiPricePoints(base,catalog,{version:1,entries:[{...entry,context:undefined}]}));
 const changed=structuredClone(catalog);
 delete changed.models['gpt-6.1-terra'].variants[0].rates.cacheWrite;
 assert.throws(()=>addApiPricePoints(base,changed,{version:1,entries:[entry]}));
});
test('price references alone do not create points; incomplete or changed billing fails closed',()=>{
 assert.deepEqual(addApiPricePoints(base,catalog,{version:1,entries:[]}).points,base.points);
 assert.throws(()=>addApiPricePoints(base,catalog,{version:1,entries:[manifest.entries[0],manifest.entries[0]]}));
 for(const changes of [{currency:'CNY'},{rates:{input:2,cachedInput:null,output:10,cacheWrite:2}},
   {rates:{input:2,cachedInput:.2,output:10,cacheWrite:4}},{context:{min:0,max:200000}}]){
   const changed=structuredClone(catalog);
   Object.assign(changed.models['kimi-k3.1-pro'].variants[0],changes);
   assert.throws(()=>addApiPricePoints(base,changed,manifest));
 }
});

test('Carbon uses dated Developer API prices with exactly one point at each promotion boundary',()=>{
 const pointsAt=day=>addApiPricePoints(base,catalog,manifest,day).points.filter(p=>p.model==='gemini-4-carbon'&&p.price_origin==='maintained-api');
 assert.equal(pointsAt('2026-11-12').length,0,'do not backdate the reviewed price');
 for(const day of ['2026-11-13','2026-11-30','2026-12-01','2027-01-01']){
  const points=pointsAt(day); assert.equal(points.length,1,day);
  const point=points[0],intro=day<='2026-11-30';
  assert.ok(Math.abs(point.real_usd_per_mtok-(intro?.197:.394))<1e-12,day);
  assert.equal(point.promo_until,intro?'2026-11-30':null);
  assert.equal(point.list_price.input,intro?2:4);
  assert.equal(point.list_price.cached,intro?.1:.2);
  assert.equal(point.list_price.output,intro?10:20);
  assert.equal(point.monthly_tokens,null);
  assert.equal(point.workload,'standard');
  assert.match(point.note_en,/implicit caching/);
  assert.match(point.note_en,/not a guaranteed hit rate/);
  assert.match(point.note_en,/not Google Cloud credits-back/);
 }
 const generated=addApiPricePoints(base,catalog,manifest,'2026-11-13');
 assert.deepEqual(generated.points.slice(0,base.points.length),base.points);
 const point=pointsAt('2026-11-13')[0];
 const joined=mergeCurrentLeaderboards(generated,read('data/leaderboards/current.json'));
 assert.ok(joined.mappings.some(m=>m.point_id===point.id),'exact Carbon identity joins its own scores');
 assert.throws(()=>addApiPricePoints(base,catalog,manifest,'2026-02-30'),/asOf/);
});

test('reviewed same-scope schedules carry both Carbon dates and reject overlapping prices',async()=>{
 const {buildApiPointSchedules}=await import('./api-price-points.mjs');
 const schedules=buildApiPointSchedules(base,catalog,manifest);
 const carbon=schedules.find(s=>s.alternatives[0].point.model==='gemini-4-carbon');
 assert.equal(carbon.alternatives.length,2);
 assert.equal(carbon.alternatives[1].point.real_usd_per_mtok,.394);
 const invalid=structuredClone(catalog);
 invalid.models['gemini-4-carbon'].variants[1].validFrom='2026-11-30';
 assert.throws(()=>buildApiPointSchedules(base,invalid,manifest),/Overlapping/);
});
