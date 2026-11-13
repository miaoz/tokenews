import { pageText } from './leaderboards.mjs';
import { parseArenaData } from './arena.mjs';

// Read serialized public page data as JSON, never execute source scripts.
export function flightText(html) {
  let result = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    const chunk = JSON.parse(m[1]);
    if (chunk[0] === 1 && typeof chunk[1] === 'string') result += chunk[1];
  }
  if (!result) throw new Error('Public page JSON missing');
  return result;
}
export function jsonAt(text, start) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('Truncated source JSON');
}
export function property(text, name) {
  const marker = `"${name}":`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Source property missing: ${name}`);
  return jsonAt(text, start + marker.length);
}
const norm = value => String(value).toLowerCase().replaceAll('+', 'plus').replace(/[^a-z0-9]/g, '');
export function resolveModel(label, models, aliases = {}) {
  if (Object.hasOwn(aliases, label)) return aliases[label];
  const matches = models.filter(m => norm(m.id) === norm(label) || norm(m.name) === norm(label));
  return matches.length === 1 ? matches[0].id : null;
}
const requireRows = rows => {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No leaderboard rows; not evidence of no updates');
  return rows;
};
export function parseAuditSource(adapter, body, board) {
  const text = pageText(body);
  if (adapter === 'aa-models' || adapter === 'aa-terminal') {
    const flight = flightText(body);
    const meta = property(flight, 'modelsAndReleases');
    const initial = requireRows(property(flight, 'initialModels'));
    const releaseByVariant = new Map(meta.models.map(m => [m.slug, m.releaseSlug]));
    const releaseBySlug = new Map(meta.releases.map(m => [m.slug, m]));
    const terminalVersions = [...new Set(initial.flatMap(m=>Object.keys(m.scores??{})).flatMap(key=>{
      const match=key.match(/^terminalbench-(\d+)-(\d+)$/);
      return match?[`${match[1]}.${match[2]}`]:[];
    }))].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
    const version = adapter === 'aa-models'
      ? flight.match(/Artificial Analysis Intelligence Index v(\d+(?:\.\d+)+)/)?.[1] : terminalVersions.at(-1);
    const rows = initial.filter(m => !m.deprecated).flatMap(m => {
      const score = adapter === 'aa-models' ? m.intelligenceIndex : m.scores?.[`terminalbench-${version?.replaceAll('.','-')}`];
      if (score == null) return [];
      if (!Number.isFinite(score)) throw new Error('Invalid AA score');
      const release = releaseBySlug.get(releaseByVariant.get(m.slug));
      if (!release) throw new Error(`Missing AA release identity: ${m.slug}`);
      return [{ identity: release.name, sourceId: m.slug, label: m.name, score: score * (adapter === 'aa-terminal' ? 100 : 1),
        fallbackEnabled: /\bDefault Fallback\b/i.test(m.name),
        maker: release.creator.name, releaseDate: release.releaseDate, releaseSlug: release.slug,
        effort: m.name.match(/\((Max|Xhigh|High|Medium|Low|Non-reasoning|Reasoning)\b/i)?.[1]?.toLowerCase() ?? null,
        source: `https://artificialanalysis.ai/models/${m.slug}` }];
    });
    if (!version) throw new Error('AA version missing');
    return { version, rows: requireRows(rows), releases: meta.releases, coverage: 'Current non-deprecated configurations in the public page payload with a non-null score; not all historical releases.' };
  }
  if (adapter === 'aa-agents') {
    const flight = flightText(body), rows = new Map();
    for (const m of flight.matchAll(/\{"id":/g)) {
      const r = jsonAt(flight, m.index);
      if (!Number.isFinite(r.indexScore) || !r.displayLabel) continue;
      rows.set(r.id, { identity: r.model?.release?.name ?? r.model?.release?.shortName ?? r.displayLabel, sourceId: r.id,
        label: r.displayLabel, score: r.indexScore * 100, harness: r.agentName,
        router: !!r.isRouter, effort: r.model?.effort?.slug ?? null,
        fallback: Number.isFinite(r.safety?.fallbackAttemptCount) ? r.safety.fallbackAttemptCount > 0 : null,
        fallbackEnabled: /\bDefault Fallback\b/i.test(r.displayLabel),
        meanCost: r.mean?.costUsd ?? null, medianCost: r.percentiles?.costUsd?.p50 ?? null });
    }
    const version = text.match(/Coding Agent Index v(\d+(?:\.\d+)+)/)?.[1];
    if (!version) throw new Error('Coding Agent Index version missing');
    return { version, rows: requireRows([...rows.values()]), coverage: 'Public agent-variant payload, including routers. Routers are not treated as standalone base models.' };
  }
  if (adapter === 'terminal') {
    const payload = property(flightText(body), 'state');
    const data = payload.queries?.find(q => q.state?.data?.leaderboard)?.state.data;
    const version = data?.leaderboard.title.match(/Terminal-Bench (\d+(?:\.\d+)+)/)?.[1];
    if (!version) throw new Error('Terminal-Bench version missing');
    const rows = requireRows(data.rows).map(r => {
      if (!Number.isFinite(r.metrics?.accuracy)) throw new Error('Invalid Terminal-Bench score');
      const name = r.metadata.model_display.label;
      return { identity: /^(Opus|Sonnet|Fable|Haiku) /.test(name) ? `Claude ${name}` : name,
        sourceId: r.id, label: `${r.metadata.agent_display.label} - ${name} (${r.metadata.reasoning_effort})`,
        score: r.metrics.accuracy, harness: r.metadata.agent_display.label, effort: r.metadata.reasoning_effort,
        scoreLow: Number.isFinite(r.metrics.accuracy_ci95_half_width) ? r.metrics.accuracy - r.metrics.accuracy_ci95_half_width : null,
        scoreHigh: Number.isFinite(r.metrics.accuracy_ci95_half_width) ? r.metrics.accuracy + r.metrics.accuracy_ci95_half_width : null,
        sourceRank: r.rank, modelSource: r.metadata.model_display.url,
        sourceCreatedAt:r.created_at??null,sourceUpdatedAt:r.updated_at??null,modelReleaseDate:r.metadata.date??null,
        nTrials:r.metrics.n_trials??r.n_trials??null,nSuccesses:r.metrics.successes??null,
        ...(version === '4.1' ? {scoreProvenance:'not-disclosed-per-row',recordNote:{
          en:'Official TB 4.1 leaderboard includes regraded TB 4.0 artifacts and retained TB 4.0 scores where regrading is unavailable or unsuitable. Per-row provenance is not disclosed; this is not evidence of a fresh 4.1 run.',
          zh:'官方TB 4.1榜包含4.0产物重评分及无法或不宜重评分时沿用的4.0成绩；逐行来源未披露，不代表该配置重新运行了4.1。'}} : {}) };
    });
    return { version, rows, ...(version === '4.1' ? {recordNote:rows[0].recordNote} : {}), sourceUpdatedAt: data.leaderboard.updated_at, coverage: version === '4.1'
      ? 'Official TB 4.1 configurations, including all efforts. Includes regraded 4.0 artifacts and retained 4.0 scores; per-row provenance is not disclosed. 官方TB 4.1全部effort配置，包含4.0产物重评分及沿用4.0成绩，逐行来源未披露。'
      : 'All rows in the official leaderboard payload, including all effort levels.' };
  }
  if (adapter === 'design') {
    const raw = body.match(/<script\b[^>]*id="model-rankings-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!raw) throw new Error('OpenDesign quality data missing');
    const rows = requireRows(JSON.parse(raw)).map(r => {
      if (!Number.isFinite(r.score)) throw new Error('Invalid OpenDesign score');
      return { identity: r.name, label: r.name, sourceId: r.name, score: r.score, maker: r.maker };
    });
    return { version: null, rows, coverage: 'Quality score dataset, not the weighted quality/cost/speed recommendation ranking. No semantic version published on the source page.' };
  }
  if (adapter === 'deepswe') {
    const data = JSON.parse(body);
    if (!data.generated_at || !data.n_tasks_in_set) throw new Error('DeepSWE provenance missing');
    const rows = requireRows(data.rows).map(r => {
      if (!Number.isFinite(r.pass_at_1)) throw new Error('Invalid DeepSWE score');
      return { identity: r.model, label: `${r.harness} - ${r.model} (${r.reasoning_effort})`, sourceId: r.config,
        score: r.pass_at_1 * 100, meanCost: r.mean_cost_usd, medianCost: r.median_cost_usd,
        scoreLow: Number.isFinite(r.ci_lo) ? r.ci_lo * 100 : null,
        scoreHigh: Number.isFinite(r.ci_hi) ? r.ci_hi * 100 : null,
        costBasis: r.cost_basis, harness: r.harness, effort: r.reasoning_effort };
    });
    return { version: '1.1', sourceUpdatedAt: data.generated_at, rows,
      coverage: 'Official v1.1 live JSON; excludes upstream additions sourced from vendor self-reports.' };
  }
  if (adapter === 'arena') {
    const flight=flightText(body);
    let costs;
    try { costs=property(flight,'costStats'); } catch { /* Task cost is optional; never a token price. */ }
    if (!costs?.entries) {
      const entries=[];
      for (const m of flight.matchAll(/\{"(?:contenderName|modelKey)":/g)) {
        const row=jsonAt(flight,m.index);
        if(Number.isFinite(row.medianUsd))entries.push(row);
      }
      costs={entries};
    }
    return parseArenaData(property(flight,board==='arena_agent_mode'?'snapshot':'leaderboard'),board,costs);
  }
  throw new Error(`Unknown audit adapter: ${adapter}`);
}

export function compareAudit(source, parsed, models, configurations, aliases = {}) {
  const old = configurations.filter(c => c.board === source.board);
  const oldModels = new Set(old.map(c => c.model));
  const baselineVersionChanged = parsed.version !== null && source.baselineVersion !== parsed.version;
  const sourceId = c => {
    const raw = c.raw_record?.secondary ?? {};
    return raw.slug ?? raw.entryId ?? raw.config ?? raw.officialName ?? null;
  };
  const scoreDifferences = [], costDifferences = [], newConfigurations = [];
  if (!baselineVersionChanged) for (const row of parsed.rows) {
    const matches = old.filter(c => sourceId(c) === row.sourceId);
    if (matches.length !== 1) { newConfigurations.push(row.label); continue; }
    const prior = matches[0];
    if (Math.abs(prior.score - row.score) > 0.0001) scoreDifferences.push({ label: row.label, before: prior.score, after: row.score });
    if (Number.isFinite(row.meanCost) && Number.isFinite(prior.mean_cost_usd_per_task) && Math.abs(row.meanCost - prior.mean_cost_usd_per_task) > 0.0001)
      costDifferences.push({ label: row.label, before: prior.mean_cost_usd_per_task, after: row.meanCost });
  }
  const rows = parsed.rows.map(r => {
    const resolved = Object.hasOwn(source, 'identityBySourceId')
      ? (Object.hasOwn(source.identityBySourceId ?? {}, r.sourceId) ? source.identityBySourceId[r.sourceId] : null)
      : resolveModel(r.identity, models, aliases);
    const model = !r.router && models.some(m => m.id === resolved) ? resolved : null;
    return { ...r, model, status: r.router ? 'router-review' : !model ? 'identity-review' : !oldModels.has(model) ? 'missing-from-board' : 'tracked-model' };
  });
  return { board: source.board, source: source.url, status: 'checked', baselineVersion: source.baselineVersion,
    currentVersion: parsed.version, versionChanged: parsed.version !== null && source.baselineVersion !== parsed.version,
    baselineConfigurations: old.length, observedConfigurations: rows.length,
    sourceUpdatedAt: parsed.sourceUpdatedAt ?? null, coverage: parsed.coverage,
    ...(parsed.excludedSourceRows ? {excludedSourceRows:parsed.excludedSourceRows} : {}),
    // A changed methodology invalidates direct score/configuration comparisons.
    configurationReviewRequired: true,
    comparisonSkippedForVersionChange: baselineVersionChanged, scoreDifferences, costDifferences, newConfigurations,
    missingFromBoard: [...new Set(rows.filter(r => r.status === 'missing-from-board').map(r => r.model))],
    unresolvedIdentities: [...new Set(rows.filter(r => r.status === 'identity-review').map(r => r.identity))], rows };
}
