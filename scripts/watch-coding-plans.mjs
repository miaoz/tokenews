import {readFile,writeFile,rename,mkdir,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {observePage,observePost,discoverPostIds,reconcileWatch,validateSources,digest} from './lib/coding-plan-watch.mjs';
const dir=fileURLToPath(new URL('../data/coding-plans/',import.meta.url));
const read=async file=>JSON.parse(await readFile(path.join(dir,file),'utf8'));
const config=validateSources(await read('watch-sources.json'));
let previous;
try{previous=await read('watch-state.json');}catch(e){if(e.code!=='ENOENT')throw e;previous={version:1,sources:{},events:[]};}
const now=new Date().toISOString();
let browserPromise;
async function browserBody(url,source){
  if(process.env.CODING_PLAN_WATCH_NO_BROWSER==='1')throw Error('Browser fallback disabled');
  browserPromise??=import('playwright').then(({chromium})=>chromium.launch({headless:true}));
  const browser=await browserPromise;const context=await browser.newContext();const page=await context.newPage();
  try{
    await page.route('**/*',route=>['image','font','media'].includes(route.request().resourceType())?route.abort():route.continue());
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    if(!response?.ok())throw Error(`Browser HTTP ${response?.status()}`);
    if(source?.kind==='tables')await page.locator('table').first().waitFor({state:'attached',timeout:12000});
    else await page.locator('body').waitFor({timeout:12000});
    return await page.content();
  }finally{await context.close();}
}
async function get(url){
  const r=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'user-agent':'Tokenews source monitor (+https://tokenews.xyz)','accept':'text/html,application/json,text/plain,*/*'}});
  if(!r.ok)throw Error(`HTTP ${r.status}`);
  const b=await r.text();if(b.length>12_000_000)throw Error('Response too large');return b;
}
async function social(source){
  // Syndication is official. A discovery mirror is only a way to obtain IDs;
  // no mirror text can become an accepted announcement.
  const urls=[`https://syndication.twitter.com/srv/timeline-profile/screen-name/${source.account}`,source.discoveryUrl];
  let ids=[],discoveredVia;
  for(const url of urls){try{ids=discoverPostIds(await get(url),source.account);if(ids.length){discoveredVia=url;break;}}catch{}}
  if(!ids.length)throw Error('Announcement discovery unavailable; official social coverage is incomplete');
  const prior=new Map((previous.sources[source.id]?.snapshot?.records??[]).map(r=>[r.key,r]));
  const records=[];const errors=[];
  for(const id of ids){
    const known=prior.get(`post:${id}`);
    // Revalidate even known posts: edits can change checkpoint or promotion terms.
    try{const url='https://publish.twitter.com/oembed?'+new URLSearchParams({url:`https://twitter.com/${source.account}/status/${id}`,omit_script:'true'});records.push(observePost(source,await get(url),id));}
    catch(e){errors.push(`${id}: ${e.message}`);if(known)records.push(known);}
  }
  // Partial social fetches must not move the last-success timestamp.
  if(errors.length)throw Error(`Official announcement verification incomplete (${errors.length}/${ids.length}): ${errors[0]}`);
  if(!records.length)throw Error('No official announcements verified');
  return {records,hash:digest(records.map(r=>[r.key,r.hash]).sort()),checkedAt:now,discoveredVia};
}
async function run(source){
  try{
    if(source.kind==='social')return {id:source.id,observation:await social(source),retrieval:'official-oembed; discovery may use mirror'};
    let observation;let retrieval='http';
    try{observation=observePage(source,await get(source.url),now);}
    catch(first){try{observation=observePage(source,await browserBody(source.url,source),now);retrieval='browser';}catch(second){throw Error(`${first.message}; fallback: ${second.message}`);}}
    console.log(`${source.id}: ${observation.records.length} records (${retrieval})`);
    return {id:source.id,observation,retrieval};
  }catch(e){console.warn(`${source.id}: ${e.message}`);return {id:source.id,error:e.message};}
}
const results=[];let cursor=0;
try{
  await Promise.all(Array.from({length:4},async()=>{while(cursor<config.sources.length){const source=config.sources[cursor++];results.push(await run(source));}}));
}finally{if(browserPromise)try{await (await browserPromise).close();}catch{}}
const {state,report}=reconcileWatch(config,previous,results,await read('watch-resolutions.json'),await read('current.json'),now);
// Sources fail independently; their last good snapshots and pending changes survive.
await mkdir(dir,{recursive:true});
for(const [file,value] of [['watch-state.json',state],['watch-report.json',report]]){
  await writeFile(path.join(dir,file+'.tmp'),JSON.stringify(value,null,2)+'\n');await rename(path.join(dir,file+'.tmp'),path.join(dir,file));
}
const summary=`Coding plan watch: ${config.sources.length-report.failedSources}/${config.sources.length} sources checked; ${report.newEvents} new events; ${report.pending.length} pending; ${report.failedSources} failed.`;
console.log(summary);
if(process.env.GITHUB_ACTIONS)for(const source of report.sources.filter(s=>s.status==='failed'))console.log(`::warning::Source ${source.id} failed; last good snapshot retained. ${source.error.replace(/[\r\n]/g,' ')}`);
if(process.env.GITHUB_STEP_SUMMARY){
  const rows=report.sources.map(s=>`| ${s.channel} / ${s.id} | ${s.status} | ${s.lastSuccessAt??'Never'} |`).join('\n');
  await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Official announcements and coding plans\n\n${summary}\n\n[Published queue](https://tokenews.xyz/data/coding-plan-watch.json)\n\n| Source | Status | Last success |\n| --- | --- | --- |\n${rows}\n\nPrice/model mappings remain reviewed. A new baseline is not a retrospective verification.\n`);
}
if(report.failedSources&&!process.argv.includes('--allow-partial'))process.exitCode=1;
