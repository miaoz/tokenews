import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addApiPricePoints} from './api-price-points.mjs';
import {mergeCurrentLeaderboards} from './current-leaderboards.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const prices=read('data/api-prices/kimi.json');
const catalog={models:Object.fromEntries(prices.models.map(m=>[m.id,m]))};
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
