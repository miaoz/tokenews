// Public, server-rendered source pages. Fail closed if identity, layout or
// benchmark version changes; never turn a failed fetch into an empty snapshot.
export function pageText(html) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:amp|#38);/g, '&')
    .replace(/&#(?:x27|39);/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function parseLeaderboard(html, target, checkedAt) {
  const text = pageText(html);
  const heading = pageText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  if (!heading.startsWith(target.label)) throw new Error(`Model identity missing: ${target.model}`);
  let score, version, name, metric, board, sourceHome, excerpt, rank, total;
  if (target.adapter === 'artificial-analysis') {
    const match = text.match(new RegExp(`${escape(target.label)} scores (\\d+(?:\\.\\d+)?) on the Artificial Analysis Intelligence Index`));
    const versions = [...text.matchAll(/Artificial Analysis Intelligence Index v(\d+(?:\.\d+)+)/g)].map(m => m[1]);
    if (new Set(versions).size !== 1) throw new Error('Missing/ambiguous AA benchmark version');
    version = versions[0]; score = match && Number(match[1]); excerpt = match?.[0];
    const placement = text.match(/Model summary Intelligence (?:Updated )?#\s*(\d+)\s*\/\s*(\d+)/);
    rank = placement && Number(placement[1]); total = placement && Number(placement[2]);
    name = 'Artificial Analysis Intelligence Index'; metric = 'Intelligence Index'; board = 'aa_intelligence_index';
    sourceHome = 'https://artificialanalysis.ai/leaderboards/models';
  } else if (target.adapter === 'crusader-bench') {
    const match = text.match(/Score, every map (\d+(?:\.\d+)?)/);
    version = text.match(/Benchmark v(\d+(?:\.\d+)+)/)?.[1];
    score = match && Number(match[1]); excerpt = match?.[0];
    const placement = text.match(/(\d+)(?:st|nd|rd|th) of (\d+) models with a score on every map/);
    rank = placement && Number(placement[1]); total = placement && Number(placement[2]);
    name = 'Crusader Bench'; metric = 'Average task score'; board = 'crusader_bench'; sourceHome = 'https://crusbench.com/';
    if (!text.includes(`Reasoning ${target.effort}`)) throw new Error('Crusader reasoning configuration changed');
  } else throw new Error(`Unknown adapter: ${target.adapter}`);
  if (!Number.isFinite(score) || !Number.isInteger(rank) || !Number.isInteger(total) || rank < 1 || total < rank || version !== target.version) throw new Error(`Score/layout/version changed for ${target.model}: expected ${target.version}, found ${version}`);
  return { model: target.model, board, name, metric, version, variant: target.variant,
    effort: target.effort ?? null, score, sourceRank: rank, sourceTotal: total, sourceRankScope: target.adapter === 'artificial-analysis' ? 'comparison-group' : 'leaderboard', source: target.url, sourceHome, checkedAt,
    excerpt, note: { en: 'Source display precision; only explicitly tracked configurations are included.', zh: '保留来源显示精度；仅收录已明确核对的评测配置。' } };
}

export function discoverAA(html, knownUrls) {
  const entries = new Map();
  const observed = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="(\/models\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = `https://artificialanalysis.ai${m[1]}`;
    if (['releases', 'comparison', 'recommend'].includes(m[1].split('/').at(-1))) continue;
    const label = pageText(m[2]);
    if (label) observed.add(url);
    if (label && !knownUrls.has(url) && !knownUrls.has(url.replace('/models/releases/', '/models/'))) entries.set(url, { url, label });
  }
  if (observed.size < 10) throw new Error('AA discovery layout changed or incomplete response');
  return [...entries.values()].sort((a,b) => a.url.localeCompare(b.url));
}

export function appendSnapshots(previous, incoming) {
  const records = [...previous.records];
  for (const next of incoming) {
    const matches = r => r.model === next.model && r.board === next.board && r.version === next.version && r.variant === next.variant;
    const latest = records.filter(matches).sort((a,b) => a.checkedAt.localeCompare(b.checkedAt)).at(-1);
    // Keep every observation date, but replace repeated same-day observations.
    if (latest?.checkedAt > next.checkedAt) throw new Error('Snapshot date would move backwards');
    const i = records.findIndex(r => matches(r) && r.checkedAt === next.checkedAt);
    if (i >= 0) records[i] = next; else records.push(next);
  }
  return { version: 1, records };
}
