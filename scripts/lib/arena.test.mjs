import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseArenaData,parseArenaDatasetRows} from './arena.mjs';
const read=name=>JSON.parse(readFileSync(new URL('../../data/leaderboards/imports/'+name,import.meta.url))).rawPayload;
const board='arena_code';
function fixture(){
  const payload=structuredClone(read('arena-webdev-2026-11-04.json'));
  payload.entries=payload.entries.slice(0,3);payload.totalModels=3;
  return payload;
}
function withAutoEval(){
  const payload=fixture();
  payload.entries.push({...payload.entries[1],modelKey:'test-autoeval',modelDisplayName:'Test AutoEval',rank:0,isDay1:true,day1Lambda:0.8864});
  payload.totalModels++;
  return payload;
}
test('Arena validates complete payload and excludes only explicitly unranked Day-1 AutoEval',()=>{
  const payload=withAutoEval(),result=parseArenaData(payload,board);
  assert.deepEqual(result.rows.map(r=>r.sourceRank),[1,2,3]);
  assert.equal(result.rows.length,3);
  assert.deepEqual(result.excludedSourceRows,[{sourceId:'test-autoeval',label:'Test AutoEval',sourceRank:0,rank:0,isDay1:true,
    score:payload.entries[3].rating,scoreLow:payload.entries[3].ratingLower,scoreHigh:payload.entries[3].ratingUpper,
    reason:'unranked-autoeval',note:'Official Day-1 AutoEval entry has no human-vote rank; excluded from the ranked WebDev comparison.'}]);
  assert.match(result.coverage,/4 configurations validated; 3 ranked/);
  assert.match(result.coverage,/Excluded 1 unranked Day-1 AutoEval/);
  assert.equal(payload.entries.length,4,'input untouched');
});
test('Arena rejects unmarked zero ranks, missing ranks, broken rank order and incomplete source IDs',()=>{
  for(const mutate of [
    p=>{delete p.entries[3].isDay1;},
    p=>{p.entries[3].isDay1='true';},
    p=>{delete p.entries[3].rank;},
    p=>{p.entries[2].rank=4;},
    p=>{p.entries[2].rank=2;},
    p=>{p.entries[3].modelKey=p.entries[0].modelKey;},
    p=>{delete p.entries[3].modelKey;},
    p=>{p.entries[3].rating=NaN;},
    p=>{p.entries[3].ratingLower=p.entries[3].rating+1;},
    p=>{p.totalModels++;},
    p=>{p.entries[1].rating=p.entries[0].rating+1;p.entries[1].ratingUpper=p.entries[1].rating+1;},
    p=>{p.arenaSlug='chat';},
    p=>{p.leaderboardSlug='frontend';},
    p=>{p.id='leaderboard-sets/public/leaderboards/webdev-frontend-raw/leaderboard-snapshots/latest';},
  ]){const payload=withAutoEval();mutate(payload);assert.throws(()=>parseArenaData(payload,board));}
});
test('Arena does not exclude ranked Day-1 rows or apply WebDev exception to Agent',()=>{
  const payload=fixture();payload.entries[1].isDay1=true;
  assert.equal(parseArenaData(payload,board).rows.length,3);
  assert.deepEqual(parseArenaData(payload,board).excludedSourceRows,[]);
  const agent=structuredClone(read('arena-agent-2026-11-04.json'));
  agent.rows[0].isDay1=true;agent.rows[0].rank=0;
  assert.throws(()=>parseArenaData(agent,'arena_agent_mode'));
});

test('Official HF dataset parser supports webdev and agent overall rows, BigInt ranks, and duplicate labels',()=>{
  const webdevRows=[
    {model_name:'Old React Model',organization:'openai',rating:1500,rating_lower:1490,rating_upper:1510,rank:1n,category:'webdev-react',leaderboard_publish_date:'2026-11-19'},
    {model_name:'GPT-5.3-Codex (Codex Harness)',organization:'openai',rating:1371,rating_lower:1359,rating_upper:1382,rank:3n,category:'overall',leaderboard_publish_date:'2026-11-22'},
    {model_name:'Claude Fable 5.2 (xHigh)',organization:'anthropic',rating:1822,rating_lower:1806,rating_upper:1837,rank:1n,category:'overall',leaderboard_publish_date:'2026-11-22'},
    {model_name:'GPT-5.3-Codex (Codex Harness)',organization:'openai',rating:1406,rating_lower:1392,rating_upper:1420,rank:2n,category:'overall',leaderboard_publish_date:'2026-11-22'},
  ];
  const webdev=parseArenaDatasetRows(webdevRows,'arena_code');
  assert.equal(webdev.retrievalMethod,'official-hf-dataset');
  assert.equal(webdev.sourceUpdatedAt,'2026-11-22');
  assert.equal(webdev.rows.length,3);
  assert.equal(webdev.rows[0].sourceId,'hf:webdev:Claude Fable 5.2 (xHigh)');
  assert.equal(webdev.rows[0].ambiguousConfiguration,false);
  assert.equal(webdev.rows[0].maker,'Anthropic');
  assert.equal(webdev.rows[0].effort,'xhigh');
  assert.equal(webdev.rows[1].sourceId,'hf:webdev:GPT-5.3-Codex (Codex Harness)#1');
  assert.equal(webdev.rows[2].sourceId,'hf:webdev:GPT-5.3-Codex (Codex Harness)#2');
  assert.equal(webdev.rows[1].ambiguousConfiguration,true);
  assert.equal(webdev.rows[2].ambiguousConfiguration,true);
  assert.equal(webdev.rows[1].harness,'Codex');

  const agentRows=[
    {model_name:'Claude Fable 5.2 (Max)',organization:'anthropic',score:0.2744,score_ci_lower:0.2444,score_ci_upper:0.3044,cost_per_task_p50:9.15,rank:1n,category:'overall',leaderboard_publish_date:'2026-11-22'},
    {model_name:'Inkling 2 Mini',organization:'thinky',score:-0.0774,score_ci_lower:-0.10,score_ci_upper:-0.05,cost_per_task_p50:null,rank:2n,category:'overall',leaderboard_publish_date:'2026-11-22'},
  ];
  const agent=parseArenaDatasetRows(agentRows,'arena_agent_mode');
  assert.equal(agent.rows.length,2);
  assert.ok(Math.abs(agent.rows[0].score-27.44)<1e-9);
  assert.equal(agent.rows[0].medianCost,9.15);
  assert.equal(agent.rows[1].maker,'Thinking Machines');
  assert.equal(agent.rows[1].medianCost,null);

  for(const mutate of [
    rows=>{rows[1].leaderboard_publish_date='2026-11-21';},
    rows=>{rows[1].leaderboard_publish_date='2026-02-30';},
    rows=>{rows[1].rank=4n;},
    rows=>{rows[2].rating_lower=rows[2].rating+1;},
    rows=>{rows[3].rating=1900;rows[3].rating_upper=1910;},
    rows=>{rows.length=1;},
  ]){const bad=structuredClone(webdevRows);mutate(bad);assert.throws(()=>parseArenaDatasetRows(bad,'arena_code'));}
  assert.throws(()=>parseArenaDatasetRows(webdevRows,'aa_intelligence_index'));
});
