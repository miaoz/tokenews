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
 assert.equal(matches.length,5);
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
