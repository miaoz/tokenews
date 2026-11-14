// Evaluate persisted refresh evidence only. Never refetch or retry a denied source.
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function checkLeaderboardHealth(report, expectedBoards) {
  if (!Array.isArray(expectedBoards) || !expectedBoards.length || new Set(expectedBoards).size !== expectedBoards.length)
    throw Error('Invalid expected source manifest');
  if (!report || report.version !== 1 || !validDate(report.attemptedAt) || !Array.isArray(report.results))
    return {healthy:false, attemptedAt:null, rows:[], errors:['Missing or malformed refresh report']};
  const errors=[], rows=[];
  for (const result of report.results) if (!expectedBoards.includes(result?.board)) errors.push(`Unexpected source: ${result?.board ?? 'missing board'}`);
  for (const board of expectedBoards) {
    const matches=report.results.filter(r=>r?.board===board);
    if(matches.length!==1){errors.push(`${board}: missing or duplicate refresh result`);rows.push({board,status:'invalid',checkedAt:null,error:'Missing or duplicate refresh result'});continue;}
    const r=matches[0], checkedAt=r.retainedCheckedAt??null;
    let error=typeof r.error==='string'?r.error:'';
    const validStatus=['updated','retained-previous','failed'].includes(r.status);
    if(!validStatus || (checkedAt!==null && (!validDate(checkedAt)||checkedAt>report.attemptedAt))
      || (r.status==='updated' && checkedAt!==report.attemptedAt)
      || (r.status==='retained-previous' && checkedAt===null)
      || (r.status==='failed' && checkedAt!==null)) error='Malformed refresh result'+(error?`: ${error}`:'');
    else if(r.status!=='updated' && !error) error='Source refresh failed without error details';
    if(r.status!=='updated'||error) errors.push(`${board}: ${error || r.status}`);
    rows.push({board,status:r.status,checkedAt,error:error||null});
  }
  return {healthy:errors.length===0,attemptedAt:report.attemptedAt,rows,errors};
}
const cell = v => String(v??'—').replaceAll('|','\\|').replace(/[\r\n]/g,' ').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function formatLeaderboardHealth(result) {
  return `## Leaderboard source health: ${result.healthy?'healthy':'attention required'}\n\nAttempt date: ${cell(result.attemptedAt)} (America/Los_Angeles)\n\n| Source | Refresh status | Snapshot checked date | Failure |\n|---|---|---|---|\n`
    +result.rows.map(r=>`| ${cell(r.board)} | ${cell(r.status)} | ${cell(r.checkedAt)} | ${cell(r.error)} |`).join('\n')
    +'\n\n'+result.errors.map(e=>`- ${cell(e)}`).join('\n')+'\n\nValid partial updates may deploy independently. A retained snapshot is not a successful source refresh.\n';
}

export function checkIndividualLeaderboardHealth(report, targets) {
 const id=t=>`${t.adapter}:${t.model}:${t.version}:${t.variant}`;
 const sources=new Map([...targets.map(t=>[id(t),t.url]),['aa-discovery','https://artificialanalysis.ai/models/releases']]);
 const normalized=report&&{...report,results:Array.isArray(report.results)?report.results.map(r=>({...r,board:r.id})):report.results};
 const result=checkLeaderboardHealth(normalized,[...sources.keys()]);
 for(const r of Array.isArray(report?.results)?report.results:[])if(sources.has(r.id)&&r.source!==sources.get(r.id))result.errors.push(`${r.id}: source URL does not match reviewed target`);
 result.healthy=result.errors.length===0;
 return result;
}
