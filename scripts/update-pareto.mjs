import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseAuditSource} from './lib/leaderboard-audit.mjs';
import {parseArenaParquet} from './lib/arena.mjs';
import {prepareCurrentSource} from './lib/current-leaderboards.mjs';
import {sourceDate,validateBrowserCapture} from './lib/leaderboard-refresh.mjs';
const root=new URL('../',import.meta.url);
const read=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const args=process.argv.slice(2);
const imports=new Map();
for(let i=0;i<args.length;i++){
 if(args[i]==='--allow-partial')continue;
 if(args[i]==='--arena-import'){
  const value=args[++i]??'', separator=value.indexOf('='), board=value.slice(0,separator), file=value.slice(separator+1);
  if(!['arena_code','arena_agent_mode'].includes(board)||!file||imports.has(board))throw Error('Expected --arena-import arena_code|arena_agent_mode=browser-capture.json');
  imports.set(board,file);continue;
 }
 throw Error('Usage: node scripts/update-pareto.mjs [--allow-partial] [--arena-import board=capture.json]');
}
const [manifest,catalog,identities]=await Promise.all([read('data/leaderboards/audit-sources.json'),read('data/models.json'),read('data/leaderboards/identities.json')]);
let previous;
try{previous=await read('data/leaderboards/current.json');}catch(e){if(e.code!=='ENOENT')throw e;previous={sources:[]};}
const checkedAt=sourceDate(new Date());
const fetches=new Map();
const get=url=>{if(!fetches.has(url))fetches.set(url,fetch(url,{signal:AbortSignal.timeout(45000)}).then(async r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.text();}));return fetches.get(url);};
const results=await Promise.all(manifest.sources.map(async source=>{
 try{
  let body,parsed,imported=false,sourceCheckedAt=checkedAt,capturedAt;
  if(imports.has(source.board)){
   const capture=JSON.parse(await readFile(imports.get(source.board),'utf8'));
   const validated=validateBrowserCapture(capture,source,previous.sources.find(s=>s.board===source.board));
   body=validated.html;sourceCheckedAt=validated.checkedAt;capturedAt=validated.capturedAt;imported=true;
   parsed=parseAuditSource(source.adapter,body,source.board);
   parsed.retrievalMethod='browser-public-source';
  }else{
   try{
    body=await get(source.url);
    parsed=parseAuditSource(source.adapter,body,source.board);
   }catch(primaryError){
    if(source.adapter==='arena'&&source.datasetUrl){
     const prior=previous.sources.find(s=>s.board===source.board);
     const res=await fetch(source.datasetUrl,{signal:AbortSignal.timeout(45000)});
     if(!res.ok)throw Error(`${primaryError.message}; dataset HTTP ${res.status}`);
     parsed=await parseArenaParquet(await res.arrayBuffer(),source.board);
     if(prior?.sourceUpdatedAt&&parsed.sourceUpdatedAt.slice(0,10)<prior.sourceUpdatedAt.slice(0,10)){
      throw Error(`Official dataset (${parsed.sourceUpdatedAt}) predates retained snapshot (${prior.sourceUpdatedAt.slice(0,10)})`);
     }
    }else throw primaryError;
   }
  }
  if(source.versionCheckUrl){
   const text=await get(source.versionCheckUrl);
   const versions=[...text.matchAll(/\bv(\d+(?:\.\d+)+)/g)].map(m=>m[1]);
   if(!versions.includes(parsed.version)||versions.some(v=>v.localeCompare(parsed.version,'en',{numeric:true})>0))throw Error('New DeepSWE version requires review');
  }
  const snapshot=prepareCurrentSource(source,parsed,sourceCheckedAt,catalog,identities);
  if(capturedAt)snapshot.capturedAt=capturedAt;
  const identityReview=snapshot.rows.filter(r=>r.exclusion==='identity-review-required').map(r=>({label:r.label,sourceId:r.sourceId,releaseSlug:r.releaseSlug??null}));
  return {board:source.board,status:'updated',reviewRequired:identityReview.length,identityReview,snapshot};
 }catch(e){
  const prior=previous.sources.find(s=>s.board===source.board);
  let snapshot=prior;
  if(prior){
   snapshot=prepareCurrentSource(source,prior,prior.checkedAt,catalog,identities);
   if(prior.capturedAt)snapshot.capturedAt=prior.capturedAt;
  }
  return {board:source.board,status:prior?'retained-previous':'failed',error:e.message,snapshot};
 }
}));
const report={version:1,attemptedAt:checkedAt,results:results.map(({snapshot,...r})=>({...r,retainedCheckedAt:snapshot?.checkedAt??null}))};
await writeFile(new URL('data/leaderboards/refresh-status.json',root),JSON.stringify(report,null,2)+'\n');
if(results.some(r=>!r.snapshot))throw Error('Missing a validated board; current publication was not changed');
const next={version:1,sources:results.map(r=>r.snapshot)};
// Content-addressed archives retain complete source configurations across updates.
await mkdir(new URL('data/leaderboards/history/',root),{recursive:true});
for(const value of [previous,next])if(value.sources.length){
 const json=JSON.stringify(value,null,2)+'\n',hash=createHash('sha256').update(json).digest('hex').slice(0,16);
 await writeFile(new URL(`data/leaderboards/history/${hash}.json`,root),json);
}
await writeFile(new URL('data/leaderboards/current.json.tmp',root),JSON.stringify(next,null,2)+'\n');
await rename(new URL('data/leaderboards/current.json.tmp',root),new URL('data/leaderboards/current.json',root));
for(const r of results)console.log(`${r.board}: ${r.status}${r.error?` (${r.error})`:''}`);
if(results.some(r=>r.status!=='updated')){
 console.warn('::warning::Some sources failed refresh; their prior checked dates and snapshots were retained. See refresh-status.json.');
 if(!args.includes('--allow-partial'))process.exitCode=1;
}
