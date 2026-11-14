import { createHash } from 'node:crypto';
import { resolveModel, resolveAAReleaseIdentity } from './leaderboard-audit.mjs';

export const CURRENT_BOARDS = {
  aa_intelligence_index: { id:'aa_intelligence_index_v5_0_1', version:'5.0.1', name:'Artificial Analysis Intelligence Index v5.0.1', metric:'Intelligence Index' },
  terminal_bench_4: { id:'terminal_bench_v4_1', version:'4.1', name:'Terminal-Bench 4.1', metric:'Resolution Rate %' },
  aa_terminal_bench_4: { id:'aa_terminal_bench_v4_0', version:'4.0', name:'Terminal-Bench 4.0 (AA)', metric:'Resolution Rate %' },
  arena_code: { id:'arena_code_current', version:null, name:'Code Arena | WebDev Overall', metric:'Arena Score' },
  arena_agent_mode: { id:'arena_agent_mode_current', version:null, name:'Agent Arena | Overall', metric:'Net Improvement %' },
  aa_coding_agent_index: { id:'aa_coding_agent_index_v2_1', version:'2.1', name:'Artificial Analysis Coding Agent Index v2.1', metric:'Coding Agent Index' },
  open_design_arena: { id:'open_design_arena_current', version:null, name:'OpenDesign Arena | Quality', metric:'Average task score' },
  deepswe_1_1: { id:'deepswe_v1_1', version:'1.1', name:'DeepSWE v1.1', metric:'Pass@1 %' },
};
const date = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0,10) === v;
const url = v => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };

export function prepareCurrentSource(source, parsed, checkedAt, catalog, identities) {
  const board = CURRENT_BOARDS[source.board];
  if (!board || parsed.version !== board.version) throw new Error(`Methodology review required: ${source.board} ${parsed.version}`);
  if (!date(checkedAt) || !url(source.url) || !parsed.rows?.length) throw new Error('Invalid current source provenance');
  const seen = new Set();
  const rows = parsed.rows.map(row => {
    if (!row.sourceId || seen.has(row.sourceId)) throw new Error(`Duplicate source configuration: ${row.sourceId}`);
    seen.add(row.sourceId);
    if (row.score !== null && !Number.isFinite(row.score)) throw new Error(`Invalid score: ${row.label}`);
    // Some source release slugs are reused for a new checkpoint. Where reviewed,
    // require the exact release name too; an unknown name remains quarantined.
    const resolved = row.router ? null : row.releaseSlug ? resolveAAReleaseIdentity(row,identities)
      : source.adapter === 'arena' ? identities.arenaSources?.[row.sourceId]
      : resolveModel(row.identity, catalog.models, identities.aliases);
    const model = resolved && catalog.models.some(m=>m.id===resolved) ? resolved : null;
    const exclusion = row.router ? 'router' : !model ? 'identity-review-required' : row.score === null ? 'unverified-score'
      : row.ambiguousConfiguration ? 'ambiguous-configuration' : row.fallback ? 'multi-model-fallback' : row.fallbackEnabled ? 'fallback-enabled' : null;
    return {...row, model, exclusion};
  });
  return {board:source.board, id:board.id, version:parsed.version, source:source.url, checkedAt,
    sourceUpdatedAt:parsed.sourceUpdatedAt??null, retrievalMethod:parsed.retrievalMethod??'direct-public-source',
    coverage:parsed.coverage, ...(parsed.recordNote ? {recordNote:parsed.recordNote} : {}), ...(parsed.excludedSourceRows ? {excludedSourceRows:parsed.excludedSourceRows} : {}), rows};
}

export function mergeCurrentLeaderboards(data, snapshot) {
  if (snapshot.version !== 1 || snapshot.sources?.length !== 8 || new Set(snapshot.sources.map(s=>s.board)).size!==8)
    throw new Error('Current publication must contain all eight boards exactly once');
  const boards = {}, configs = [], mappings = [], coverage = {}, boardAliases = {};
  const models = new Set(data.models.map(m=>m.id));
  for (const source of snapshot.sources) {
    const meta = CURRENT_BOARDS[source.board];
    if (!meta || meta.id!==source.id || meta.version!==source.version || !date(source.checkedAt) || !url(source.source) || !source.rows.length)
      throw new Error(`Invalid current snapshot: ${source.board}`);
    boardAliases[source.board] = meta.id;
    boards[meta.id] = {name:meta.name, metric:meta.metric, url:source.source,
      snapshot:source.sourceUpdatedAt?.slice(0,10)??source.checkedAt, checkedAt:source.checkedAt, current:true,
      retrievalMethod:source.retrievalMethod};
    const seen = new Set(), unpriced = [], excluded = [];
    let matchedConfigurations=0;
    for (const r of source.rows) {
      if (!r.sourceId || seen.has(r.sourceId) || (!r.exclusion && !Number.isFinite(r.score)) || (r.model && !models.has(r.model))) throw new Error(`Invalid published row: ${r.label}`);
      seen.add(r.sourceId);
      // Enabling the provider's default refusal fallback does not establish
      // that another model actually ran. Preserve that configuration and its
      // caveat as a primary-model reference, not a pure-model measurement.
      // Actual observed fallback, routers and identity failures remain blocked.
      const fallbackReference = r.fallbackEnabled === true && r.fallback !== true &&
        (r.exclusion === 'fallback-enabled' || r.exclusion == null);
      const exclusion = fallbackReference ? null : r.exclusion ?? (r.fallback === true ? 'multi-model-fallback' : null);
      const displayLabel = source.rows.filter(other=>other.label===r.label).length>1
        ? `${r.label} · ${r.sourceId.replace(/^contenders\//,'')}` : r.label;
      const configId=`current:${meta.id}:${createHash('sha256').update(r.sourceId).digest('hex').slice(0,16)}`;
      const note = {en:'Current source configuration. Subscription cost is an independent model reference, not a measurement of this agent/channel.',zh:'当前来源评测配置；订阅成本仅按模型对应，并非该代理或渠道的实测表现。'};
      if (r.recordNote) {note.en+=' '+r.recordNote.en;note.zh+=' '+r.recordNote.zh;}
      if (source.board.startsWith('arena_')) {note.en+=` Source configuration: ${r.sourceId}.`;note.zh+=` 来源配置：${r.sourceId}。`;}
      if (fallbackReference) {note.en += ' The benchmark enables default refusal fallback. Actual fallback use is unverified; this is a primary-model price reference, not verified pure-model or same-plan performance.';note.zh += ' 评测启用默认拒绝回退，实际是否触发尚未核实；仅关联主模型价格作参考，不代表已核实的纯模型或同套餐实测表现。';}
      if (r.exclusion === 'multi-model-fallback') {note.en += ' This run uses fallback models and is excluded from single-model price mappings.';note.zh += ' 此运行包含回退模型，不关联单一模型价格。';}
      if (r.exclusion === 'ambiguous-configuration') {note.en += ' Source runs share this label; price mappings are withheld until their configurations can be distinguished.';note.zh += ' 来源存在同名运行，配置尚不能区分，因此不关联价格。';}
      if (r.model && Number.isFinite(r.score)) configs.push({configuration_id:configId,board:meta.id,model:r.model,
        variant:displayLabel,board_label:displayLabel,score:r.score,score_low:r.scoreLow??null,score_high:r.scoreHigh??null,
        score_is_estimated:false,score_is_preliminary:!!r.preliminary,score_is_self_reported:false,
        source_id:r.sourceId,source_created_at:r.sourceCreatedAt??null,source_updated_at:r.sourceUpdatedAt??null,
        model_release_date:r.modelReleaseDate??null,n_trials:r.nTrials??null,n_successes:r.nSuccesses??null,
        score_provenance:r.scoreProvenance??null,
        source_rank:r.sourceRank,source_rank_scope:r.sourceRank?'leaderboard':undefined,source_total:r.sourceRank?source.rows.length:undefined,
        agent_harness:r.harness??null,reasoning_effort:r.effort??null,service_mode:r.serviceMode??null,
        mean_cost_usd_per_task:r.meanCost??null,median_cost_usd_per_task:r.medianCost??null,
        source:r.source??source.source,checked_at:source.checkedAt,archive_url:'/data/current-leaderboards.json',
        record_note_en:note.en+(r.costBasis?` ${r.costBasis}`:''),record_note_zh:note.zh,
        price_mapping_exclusion:exclusion,fallback_enabled:!!r.fallbackEnabled,fallback_observed:typeof r.fallback==='boolean'?r.fallback:null});
      const entry={model:r.model,label:displayLabel,score:r.score,reason:exclusion,preliminary:!!r.preliminary,sourceId:r.sourceId,source:r.source??source.source,...(r.releaseSlug?{releaseSlug:r.releaseSlug}:{})};
      if (exclusion) {excluded.push(entry);continue;}
      const points=data.points.filter(p=>p.model===r.model);
      if (!points.length) {unpriced.push({...entry,reason:'no-price-evidence'});continue;}
      matchedConfigurations++;
      for (const point of points) mappings.push({point_id:point.id,configuration_id:configId,
        mapping_kind:fallbackReference?'primary_model_configuration_reference':'model_configuration_reference',mapping_confidence:fallbackReference?'low':'medium',quota_effort_matched:null,
        mapping_note:fallbackReference
          ? 'Primary-model price reference for a default-fallback-enabled benchmark. Actual fallback use, product harness and quota-measurement effort are unverified. Not measured performance of this plan or pure model.'
          : 'Exact served-model reference only; product harness and quota-measurement effort are unverified. Not a benchmark measurement of this subscription or API channel.'});
    }
    coverage[meta.id]={coverage:source.coverage,...(source.recordNote ? {recordNote:source.recordNote} : {}),...(source.excludedSourceRows ? {excludedSourceRows:source.excludedSourceRows} : {}),observed:source.rows.length,matchedConfigurations,unpriced,excluded,checkedAt:source.checkedAt,sourceUpdatedAt:source.sourceUpdatedAt,retrievalMethod:source.retrievalMethod};
  }
  // Keep the original upstream snapshots intact and explicitly historical. The
  // same version's old observations never fill gaps in a current leaderboard.
  const activeIds=new Set(Object.keys(boards));
  const oldConfigs=data.configurations.filter(c=>!activeIds.has(c.board));
  const keepIds=new Set(oldConfigs.map(c=>c.configuration_id));
  const oldBoards=Object.fromEntries(Object.entries(data.boards).filter(([id])=>!activeIds.has(id)).map(([id,b])=>[id,
    Object.hasOwn(CURRENT_BOARDS,id)?{...b,current:false,name:`${b.name} — snapshot ${b.snapshot}`} : b]));
  return {...data,boards:{...boards,...oldBoards},configurations:[...configs,...oldConfigs],
    mappings:[...mappings,...data.mappings.filter(m=>keepIds.has(m.configuration_id))],
    currentBoards:[...activeIds],boardAliases,leaderboardCoverage:coverage,
    leaderboardUpdatedAt:snapshot.sources.map(s=>s.checkedAt).sort().at(-1)};
}
