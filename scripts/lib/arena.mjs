// Parse serialized numeric data; SVG minus signs disappear from text exports.
export function parseArenaData(payload, board, costStats) {
  const agent=board==='arena_agent_mode';
  if (!agent && (payload.arenaSlug!=='code' || payload.leaderboardSlug!=='overall' || !payload.id?.includes('webdev-overall-raw')))
    throw new Error('Wrong Arena category');
  const data=agent?payload.rows:payload.entries;
  const total=agent?payload.modelCount:payload.totalModels;
  const sourceUpdatedAt=agent?payload.lastUpdated:payload.voteCutoffISOString;
  if (!sourceUpdatedAt || !Number.isFinite(Date.parse(sourceUpdatedAt)) || !Array.isArray(data) || data.length!==total || !total)
    throw new Error('Incomplete Arena snapshot');
  const costs=new Map((costStats?.entries??[]).map(r=>[r.contenderName??r.modelKey,r]));
  const excludedSourceRows=[];
  const allRows=data.map(r=>{
    const label=agent?r.model:r.modelDisplayName;
    const sourceId=agent?r.contenderName:r.modelKey;
    const score=agent?r.avgScore?.value*100:r.rating;
    const scoreLow=agent?(r.avgScore?.value-r.avgScore?.ci)*100:r.ratingLower;
    const scoreHigh=agent?(r.avgScore?.value+r.avgScore?.ci)*100:r.ratingUpper;
    if (!sourceId || !label || !Number.isFinite(score) || !Number.isFinite(scoreLow) || !Number.isFinite(scoreHigh) || scoreLow>score || scoreHigh<score)
      throw new Error('Invalid Arena numeric record: '+sourceId);
    if (!agent && r.isDay1===true && r.rank===0) {
      excludedSourceRows.push({sourceId,label,sourceRank:r.rank,rank:r.rank,isDay1:true,score,scoreLow,scoreHigh,
        reason:'unranked-autoeval',note:'Official Day-1 AutoEval entry has no human-vote rank; excluded from the ranked WebDev comparison.'});
    }
    const cost=costs.get(sourceId);
    return {identity:label,label,sourceId,sourceRank:r.rank,score,scoreLow,scoreHigh,
      maker:r.modelOrganization,modelSource:r.modelUrl,preliminary:['pre_release','co_release'].includes(r.releaseType),releaseType:r.releaseType,
      effort:label.match(/\b(Max|xHigh|High|Medium|Low|Non-Thinking|Thinking|Reasoning|Instant|Minimal)\b(?=[^()]*\))/i)?.[1]?.toLowerCase()??null,
      harness:/Codex Harness/.test(label)?'Codex':agent?'Arena Agent':'Arena WebDev',
      serviceMode:agent&&sourceId.endsWith('-text')?'text':agent&&sourceId.endsWith('-agent')?'agent':null,
      medianCost:cost?.medianUsd??null,meanCost:cost?.meanUsd??null};
  });
  const excludedIds=new Set(excludedSourceRows.map(r=>r.sourceId));
  const rows=allRows.filter(r=>!excludedIds.has(r.sourceId)).sort((a,b)=>a.sourceRank-b.sourceRank);
  if(new Set(allRows.map(r=>r.sourceId)).size!==total || !rows.length || rows.some((r,i)=>r.sourceRank!==i+1 || (i && r.score>rows[i-1].score)))
    throw new Error('Invalid Arena source IDs/ranking');
  return {version:null,sourceUpdatedAt,rows,excludedSourceRows,
    coverage:'Complete Overall structured payload: '+total+' configurations validated; '+rows.length+' ranked configurations with signed scores, confidence intervals and stable source IDs.'+
      (excludedSourceRows.length?' Excluded '+excludedSourceRows.length+' unranked Day-1 AutoEval entries (isDay1=true, rank=0), not human-vote ranks.':'')};
}
