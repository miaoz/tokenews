import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseArenaData} from './arena.mjs';
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
