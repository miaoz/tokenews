import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBrowserCapture,attachRefreshStatus} from './leaderboard-refresh.mjs';

const source={url:'https://arena.ai/leaderboard/agent'};
const capture={url:source.url,html:'<html>public source</html>',capturedAt:'2026-11-04T01:00:00Z'};
const now=new Date('2026-11-06T12:00:00Z');
test('reimporting a capture preserves its actual local verification date',()=>{
 const imported=validateBrowserCapture(capture,source,undefined,now);
 assert.equal(imported.checkedAt,'2026-11-03');
 assert.equal(imported.capturedAt,capture.capturedAt);
});
test('browser imports reject missing evidence, wrong boards, future dates and rollbacks',()=>{
 for(const changes of [{capturedAt:undefined},{capturedAt:'2026-11-04'},{capturedAt:'invalid'},
   {capturedAt:'2026-11-07T00:00:00Z'},{url:'https://arena.ai/leaderboard/code/webdev'},{html:''}])
   assert.throws(()=>validateBrowserCapture({...capture,...changes},source,undefined,now));
 assert.throws(()=>validateBrowserCapture(capture,source,{checkedAt:'2026-11-04'},now));
 assert.throws(()=>validateBrowserCapture(capture,source,{checkedAt:'2026-11-03',capturedAt:'2026-11-04T02:00:00Z'},now));
});
test('a failed refresh is published with the retained data date; outdated reports are ignored',()=>{
 const data={boardAliases:{arena:'arena_current'},leaderboardCoverage:{arena_current:{checkedAt:'2026-11-04'}}};
 const report={version:1,attemptedAt:'2026-11-06',results:[{board:'arena',status:'retained-previous',retainedCheckedAt:'2026-11-04'}]};
 assert.deepEqual(attachRefreshStatus(data,report).leaderboardRefresh.arena_current,
   {status:'retained-previous',attemptedAt:'2026-11-06',checkedAt:'2026-11-04'});
 assert.deepEqual(attachRefreshStatus(data,{...report,attemptedAt:'2026-11-03'}).leaderboardRefresh,{});
 assert.deepEqual(attachRefreshStatus(data,{...report,results:[{...report.results[0],retainedCheckedAt:'2026-11-03'}]}).leaderboardRefresh,{});
});
