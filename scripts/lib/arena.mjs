import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

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

const HF_ORG_MAKERS = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', deepseek: 'DeepSeek', xai: 'xAI',
  alibaba: 'Alibaba', zhipu: 'Zhipu', zai: 'Zhipu', moonshot: 'Moonshot', mistral: 'Mistral',
  meta: 'Meta', tencent: 'Tencent', xiaomi: 'Xiaomi', minimax: 'MiniMax', stepfun: 'StepFun',
  nvidia: 'NVIDIA', thinky: 'Thinking Machines', thinkingmachines: 'Thinking Machines',
  bytedance: 'ByteDance', ibm: 'IBM', 'inception-ai': 'Inception', poolside: 'Poolside',
  reflection: 'Reflection', synlan: 'SynLan', unisound: 'Unisound', upstage: 'Upstage',
};

const isIsoCalendarDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const finiteNumber = value => typeof value === 'number' ? (Number.isFinite(value) ? value : NaN)
  : typeof value === 'bigint' ? Number(value) : NaN;

export function parseArenaDatasetRows(rawRows, board) {
  if (board !== 'arena_code' && board !== 'arena_agent_mode') throw new Error('Wrong Arena dataset board: ' + board);
  if (!Array.isArray(rawRows)) throw new Error('Invalid Arena dataset rows');
  const agent = board === 'arena_agent_mode';
  const subset = agent ? 'agent' : 'webdev';
  const overall = rawRows.filter(r => r && r.category === 'overall');
  if (!overall.length) throw new Error('Incomplete Arena dataset snapshot: missing overall category');

  const publishDates = new Set();
  for (const r of overall) {
    if (!isIsoCalendarDate(r.leaderboard_publish_date)) throw new Error('Invalid Arena dataset publish date: ' + r.leaderboard_publish_date);
    publishDates.add(r.leaderboard_publish_date);
  }
  if (publishDates.size !== 1) throw new Error('Mixed Arena dataset publish dates: ' + [...publishDates].join(', '));
  const [publishDate] = publishDates;

  const parsed = overall.map(r => {
    const label = typeof r.model_name === 'string' ? r.model_name.trim() : '';
    if (!label) throw new Error('Missing Arena dataset model_name');
    const sourceRank = finiteNumber(r.rank);
    if (!Number.isSafeInteger(sourceRank) || sourceRank < 1) throw new Error('Invalid Arena dataset rank: ' + label);
    const scale = agent ? 100 : 1;
    const rawScore = finiteNumber(agent ? r.score : r.rating);
    const rawLow = finiteNumber(agent ? r.score_ci_lower : r.rating_lower);
    const rawHigh = finiteNumber(agent ? r.score_ci_upper : r.rating_upper);
    const score = rawScore * scale, scoreLow = rawLow * scale, scoreHigh = rawHigh * scale;
    if (!Number.isFinite(score) || !Number.isFinite(scoreLow) || !Number.isFinite(scoreHigh) || scoreLow > score || scoreHigh < score)
      throw new Error('Invalid Arena dataset numeric record: ' + label);
    const rawCost = agent && r.cost_per_task_p50 != null ? finiteNumber(r.cost_per_task_p50) : NaN;
    const medianCost = Number.isFinite(rawCost) ? rawCost : null;
    const org = typeof r.organization === 'string' ? r.organization.trim().toLowerCase() : '';
    const maker = org ? (HF_ORG_MAKERS[org] ?? r.organization.trim()) : null;
    return {
      identity: label,
      label,
      sourceRank,
      score,
      scoreLow,
      scoreHigh,
      maker,
      modelSource: null,
      preliminary: false,
      releaseType: null,
      effort: label.match(/\b(Max|xHigh|High|Medium|Low|Non-Thinking|Thinking|Reasoning|Instant|Minimal)\b(?=[^()]*\))/i)?.[1]?.toLowerCase() ?? null,
      harness: /Codex Harness/.test(label) ? 'Codex' : agent ? 'Arena Agent' : 'Arena WebDev',
      serviceMode: null,
      medianCost,
      meanCost: null,
    };
  }).sort((a, b) => a.sourceRank - b.sourceRank);

  if (parsed.some((r, i) => r.sourceRank !== i + 1 || (i > 0 && r.score > parsed[i - 1].score)))
    throw new Error('Invalid Arena dataset ranking or score order');

  const labelCounts = new Map();
  for (const r of parsed) labelCounts.set(r.label, (labelCounts.get(r.label) ?? 0) + 1);
  const labelSeen = new Map();
  const rows = parsed.map(r => {
    const ambiguous = labelCounts.get(r.label) > 1;
    const idx = (labelSeen.get(r.label) ?? 0) + 1;
    labelSeen.set(r.label, idx);
    const sourceId = ambiguous ? `hf:${subset}:${r.label}#${idx}` : `hf:${subset}:${r.label}`;
    return { ...r, sourceId, ambiguousConfiguration: ambiguous };
  });

  return {
    version: null,
    sourceUpdatedAt: publishDate,
    retrievalMethod: 'official-hf-dataset',
    rows,
    excludedSourceRows: [],
    coverage: `Official LMArena Hugging Face dataset (${subset}/latest, overall): ${rows.length} ranked configurations validated (published ${publishDate}). Unranked Day-1 AutoEval entries are omitted by the official dataset.`,
  };
}

export async function parseArenaParquet(arrayBuffer, board) {
  const rawRows = await parquetReadObjects({ file: arrayBuffer, compressors });
  return parseArenaDatasetRows(rawRows, board);
}
