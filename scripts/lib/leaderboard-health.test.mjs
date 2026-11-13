import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkLeaderboardHealth,formatLeaderboardHealth} from './leaderboard-health.mjs';
const report=()=>({version:1,attemptedAt:'2026-11-13',results:[{board:'a',status:'updated',retainedCheckedAt:'2026-11-13'}]});
test('healthy updates include attempt and checked dates',()=>{
 const result=checkLeaderboardHealth(report(),['a']);assert.equal(result.healthy,true);
 assert.match(formatLeaderboardHealth(result),/2026-11-13/);
});
test('retained and failed sources fail health without claiming their snapshot was refreshed',()=>{
 for(const [status,checked] of [['retained-previous','2026-11-12'],['failed',null]]){
 const r=report();Object.assign(r.results[0],{status,retainedCheckedAt:checked,error:'HTTP 403'});
 const result=checkLeaderboardHealth(r,['a']);assert.equal(result.healthy,false);assert.equal(result.rows[0].checkedAt,checked);
 assert.match(formatLeaderboardHealth(result),/HTTP 403/);
 }
});
test('missing malformed duplicate stale and unexpected reports fail closed',()=>{
 const bad=[undefined,{}, {...report(),version:2}, {...report(),attemptedAt:'2026-02-30'}, {...report(),results:[]},
 {...report(),results:[...report().results,...report().results]}, {...report(),results:[{board:'a',status:'updated',retainedCheckedAt:'2026-11-12'}]},
 {...report(),results:[{board:'a',status:'retained-previous',retainedCheckedAt:null}]},
 {...report(),results:[{board:'a',status:'failed',retainedCheckedAt:'2026-11-13'}]},
 {...report(),results:[{board:'a',status:'mystery'}]}, {...report(),results:[...report().results,{board:'unexpected'}]}];
 for(const value of bad)assert.equal(checkLeaderboardHealth(value,['a']).healthy,false,JSON.stringify(value));
});
test('CLI exits nonzero for missing and malformed files, and writes summary',()=>{
 const dir=mkdtempSync(join(tmpdir(),'leaderboard-health-'));
 try{
 for(const name of ['missing','malformed']){
 const file=join(dir,name);if(name==='malformed')writeFileSync(file,'not json');
 const summary=join(dir,name+'-summary');
 const result=spawnSync(process.execPath,['scripts/check-leaderboard-health.mjs',file],{env:{...process.env,GITHUB_STEP_SUMMARY:summary},encoding:'utf8'});
 assert.equal(result.status,1);assert.match(readFileSync(summary,'utf8'),/Cannot read refresh report/);
 }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('health job and deploy depend independently on update; evidence is run-specific',()=>{
 const workflow=readFileSync('.github/workflows/update-leaderboards.yml','utf8');
 const health=workflow.split('  source-health:')[1].split('  deploy:')[0];
 assert.match(health,/needs: update/);assert.match(health,/if: always\(\)/);assert.match(health,/source-health-report\/refresh-status.json/);
 const deploy=workflow.split('  deploy:')[1];assert.match(deploy,/needs: update/);assert.doesNotMatch(deploy,/source-health/);
 assert.ok(workflow.indexOf('rm -f data/leaderboards/refresh-status.json')<workflow.indexOf('- run: npm ci'));
 assert.equal(workflow.match(/name: leaderboard-source-health-\$\{\{ github\.run_attempt \}\}/g)?.length,2,
   'rerunning a workflow must not reuse a previous attempt health artifact');
});

test('main push validation is limited to workflow and collector code, not generated data',()=>{
 const workflow=readFileSync('.github/workflows/update-leaderboards.yml','utf8');
 const push=workflow.split('  push:')[1].split('  schedule:')[0];
 assert.match(push,/branches: \[main\]/);assert.match(push,/check-leaderboard-health/);
 assert.doesNotMatch(push,/["']data\//);assert.match(workflow,/workflow_dispatch:/);
});
