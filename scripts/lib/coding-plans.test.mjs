import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeCodingPlans} from './coding-plans.mjs';
import {mergeCurrentLeaderboards} from './current-leaderboards.mjs';
const read = p => JSON.parse(readFileSync(new URL(`../../${p}`,import.meta.url)));
const upstream = read('upstream/derived/points.json');
const base = {...upstream, points:upstream.points.map(p=>({...p,plan_id:p.id.split('::')[0]})),
  models:read('data/models.json').models,conventions:read('upstream/data/conventions.json'),configurations:[],mappings:[]};
const manifest = read('data/coding-plans/current.json');
const result = mergeCodingPlans(base,manifest);
test('Current Go limits use monthly credits once, with distinct time bands and per-seat Teams fees',()=>{
  const peak=result.points.find(p=>p.id==='opencode_go::deepseek-v4.1-flash');
  const off=result.points.find(p=>p.id==='opencode_go::deepseek-v4.1-flash::off-peak');
  assert.ok(Math.abs(peak.real_usd_per_mtok-.001932)<1e-12);
  assert.equal(off.monthly_tokens,peak.monthly_tokens*2);
  assert.ok(Math.abs(off.real_usd_per_mtok-.000966)<1e-12);
  const plus=result.points.find(p=>p.id==='opencode_go_plus::deepseek-v4.1-flash');
  assert.equal(plus.monthly_tokens,peak.monthly_tokens*2);
  assert.equal(plus.price_usd,40);
  const teams=result.points.find(p=>p.id==='opencode_go_teams::deepseek-v4.1-flash');
  assert.equal(teams.price_usd,20);
  assert.ok(Math.abs(teams.monthly_tokens/peak.monthly_tokens-1.05)<1e-12);
});
test('GOAT model credits are capped by its shared pool, and other plan fees are never copied',()=>{
  const changed=structuredClone(manifest);
  changed.entries.find(e=>e.model==='kimi-k3.1-pro'&&e.plan==='command_code_goat').monthlyCreditsUsd=1000;
  const p=mergeCodingPlans(base,changed).points.find(p=>p.id==='command_code_goat::kimi-k3.1-pro');
  assert.ok(Math.abs(p.monthly_tokens-100/.294*1e6)<1e-6);
  assert.ok(Math.abs(result.points.find(p=>p.id==='opencode_go::kimi-k3.1-pro').real_usd_per_mtok-.196)<1e-12);
});
test('New Ollama credits are separate from legacy samples; original source values survive in the audit archive',()=>{
  const originals=new Map([...result.points.filter(p=>!p.price_origin),...result.supersededPoints].map(p=>[p.id,p]));
  for(const p of base.points) assert.deepEqual(originals.get(p.id),p);
  assert.ok(result.points.find(p=>p.id==='ollama_pro::deepseek-v4.1-flash').plan.includes('Legacy'));
  const p=result.points.find(p=>p.id==='ollama_pro_credits::deepseek-v4.1-flash-1017');
  assert.ok(Math.abs(p.real_usd_per_mtok-.00644)<1e-12);
  assert.ok(Math.abs(p.monthly_tokens-60/.01932*1e6)<1e-6);
});
test('New third-party points join current benchmarks by exact identity; officially upgraded aliases join only 1017',()=>{
  const d=mergeCurrentLeaderboards(result,read('data/leaderboards/current.json'));
  for(const id of ['opencode_go::kimi-k3.1-pro','opencode_go_plus::minimax-m3.1-flash','command_code_goat::ling-3.1-flash-1019','command_code_goat::muse-spark-open','ollama_pro_credits::deepseek-v4.1-flash-1017']) assert.ok(d.mappings.some(m=>m.point_id===id),id);
  const upgraded=result.points.filter(p=>p.price_origin==='maintained-plan'&&['OpenCode','Command Code'].includes(p.channel)&&p.id.includes('::deepseek-v4.1-flash'));
  assert.equal(upgraded.length,8);
  for(const p of upgraded){
    assert.equal(p.model,'deepseek-v4.1-flash-1017');
    assert.ok(p.evidence.some(e=>e.url.startsWith('https://x.com/')));
    const configIds=new Set(d.mappings.filter(m=>m.point_id===p.id).map(m=>m.configuration_id));
    assert.ok(configIds.size>0);
    assert.ok(d.configurations.filter(c=>configIds.has(c.configuration_id)).every(c=>c.model==='deepseek-v4.1-flash-1017'));
    const expected=d.configurations.filter(c=>c.model==='deepseek-v4.1-flash-1017'&&!c.price_mapping_exclusion);
    assert.equal(configIds.size,expected.length);
  }
  assert.ok(!result.points.some(p=>p.price_origin==='maintained-plan'&&p.model==='mistral-large-4'));
});
test('Missing rates, identity evidence, unreviewed collisions and newer upstream data fail closed',()=>{
  for(const mutate of [m=>m.entries[0].rates.cache=null,m=>m.entries[0].identitySource='',m=>m.entries[0].rates.cacheWrite=999,m=>m.entries[0].monthlyCreditsUsd=0,m=>m.entries.push(m.entries[0])]){
    const m=structuredClone(manifest);mutate(m);assert.throws(()=>mergeCodingPlans(base,m));
  }
  const newer=structuredClone(base);newer.points.find(p=>p.id==='opencode_go::deepseek-v4.1-flash').data_date='2026-11-05';
  assert.throws(()=>mergeCodingPlans(newer,manifest),/Newer upstream/);
  const collision=structuredClone(manifest);collision.entries.find(e=>e.replaces?.includes('opencode_go::deepseek-v4.1-flash')).replaces=[];
  assert.throws(()=>mergeCodingPlans(base,collision),/overwrite/);
});

test('Checkpoint upgrades remove stale mappings while preserving unrelated and original evidence',()=>{
  const history=read('upstream/derived/benchmark-configurations.json');
  const originalMappings=read('upstream/derived/benchmark-points.json');
  const source={...base,configurations:history,mappings:originalMappings};
  const merged=mergeCodingPlans(source,manifest);
  const changed=new Set(['opencode_go::deepseek-v4.1-flash','command_code_goat::deepseek-v4.1-flash']);
  assert.ok(originalMappings.some(m=>changed.has(m.point_id)));
  assert.ok(!merged.mappings.some(m=>changed.has(m.point_id)));
  assert.deepEqual(merged.mappings,originalMappings.filter(m=>!changed.has(m.point_id)));
  assert.equal(source.mappings,originalMappings);
  assert.ok(source.points.find(p=>p.id==='opencode_go::deepseek-v4.1-flash').model==='deepseek-v4.1-flash');
  assert.ok(merged.points.find(p=>p.id==='command_code_goat::deepseek-v4.1-flash-fast').model==='deepseek-v4.1-flash-fast');
});
