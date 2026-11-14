import {parseLeaderboard,appendSnapshots} from './leaderboards.mjs';
export const individualTargetId=t=>`${t.adapter}:${t.model}:${t.version}:${t.variant}`;

// Fail individual sources independently; a partial run never replaces a good
// observation with an empty result or changes its successful verification date.
export async function refreshIndividualTargets(targets,previous,get,checkedAt) {
 if(!Array.isArray(targets)||!targets.length||new Set(targets.map(individualTargetId)).size!==targets.length)throw Error('Invalid individual source manifest');
 const results=new Array(targets.length),records=new Array(targets.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(4,targets.length)},async()=>{while(cursor<targets.length){
  const i=cursor++,target=targets[i],id=individualTargetId(target);
  const before=previous.records.filter(r=>r.model===target.model&&r.version===target.version&&r.variant===target.variant&&r.source===target.url).sort((a,b)=>a.checkedAt.localeCompare(b.checkedAt)).at(-1);
  try {
   records[i]=parseLeaderboard(await get(target.url),target,checkedAt);
   results[i]={id,source:target.url,status:'updated',retainedCheckedAt:checkedAt};
  } catch(e) {
   results[i]={id,source:target.url,status:before?'retained-previous':'failed',retainedCheckedAt:before?.checkedAt??null,error:e.message};
  }
 }}));
 const incoming=records.filter(Boolean);
 return {snapshots:appendSnapshots(previous,incoming),records:incoming,results};
}
