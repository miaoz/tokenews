import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshIndividualTargets,individualTargetId} from './individual-leaderboard-refresh.mjs';
const target={adapter:'artificial-analysis',model:'example',label:'Example (High)',headingLabel:'Example',version:'5.0.1',variant:'high',effort:'high',url:'https://example.com/model'};
const html='<h1>Example: Intelligence, Performance &amp; Price Analysis</h1>Model summary Intelligence Updated # 2 / 60 Example (High) scores 60 on the Artificial Analysis Intelligence Index. Artificial Analysis Intelligence Index v5.0.1';
test('one failed individual source preserves its history while independent sources advance',async()=>{
 const prior={model:'example',board:'aa_intelligence_index',version:'5.0.1',variant:'high',source:target.url,checkedAt:'2026-11-12',score:59};
 const previous={version:1,records:[prior]},second={...target,model:'second',url:'https://example.com/second'};
 const result=await refreshIndividualTargets([target,second],previous,async url=>{if(url===target.url)throw Error('HTTP 403');return html;},'2026-11-14');
 assert.deepEqual(previous.records,[prior]);assert.deepEqual(result.snapshots.records[0],prior);
 assert.equal(result.records.length,1);assert.equal(result.snapshots.records.length,2);
 assert.deepEqual(result.results[0],{id:individualTargetId(target),source:target.url,status:'retained-previous',retainedCheckedAt:'2026-11-12',error:'HTTP 403'});
 assert.equal(result.results[1].status,'updated');
});
test('an unverified new source stays failed and duplicate target identities are rejected',async()=>{
 const empty={version:1,records:[]};
 const result=await refreshIndividualTargets([target],empty,async()=>'<h1>Other model</h1>','2026-11-14');
 assert.deepEqual(result.snapshots,empty);assert.equal(result.results[0].status,'failed');assert.equal(result.results[0].retainedCheckedAt,null);
 await assert.rejects(()=>refreshIndividualTargets([target,target],empty,async()=>html,'2026-11-14'));
});
