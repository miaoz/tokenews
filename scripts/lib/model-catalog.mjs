import { readFile } from 'node:fs/promises';
import path from 'node:path';

const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validUrl = value => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};
const fail = (message) => { throw new Error(message); };
export function validateCatalog(catalog) {
  if (catalog.version !== 1 || !Array.isArray(catalog.models)) fail('Invalid model catalog');
  const ids = new Set(), slugs = new Set();
  for (const m of catalog.models) {
    const slug = m.id?.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(m.id) || ids.has(m.id) || slugs.has(slug)) fail(`Duplicate/invalid model ID: ${m.id}`);
    if (!m.name?.trim() || !m.maker?.trim() || !validUrl(m.source) || !validDate(m.checkedAt)) fail(`Incomplete model: ${m.id}`);
    if (m.releaseDate != null && !validDate(m.releaseDate)) fail(`Invalid release date: ${m.id}`);
    ids.add(m.id); slugs.add(slug);
  }
  return catalog;
}

export function mergeCatalog(data, catalog, snapshots, current = { sources: [] }) {
  validateCatalog(catalog);
  const models = new Map(catalog.models.map(m => [m.id, { ...m }]));
  // Retain compatibility with newly synced upstream models without making
  // local catalog entries depend on a price point's continued existence.
  for (const p of data.points) if (!models.has(p.model)) {
    const tag = p.plan_gen ? ` (${p.plan_gen})` : '';
    models.set(p.model, { id: p.model, name: tag && p.model_display.endsWith(tag) ? p.model_display.slice(0, -tag.length) : p.model_display,
      maker: p.vendor === 'Muse' ? 'Meta' : p.model.startsWith('nemotron') ? 'NVIDIA' : p.vendor === 'other' ? 'Other' : p.vendor,
      source: 'https://github.com/Fei2411/real-api-pricing', checkedAt: data.generatedAt });
  }
  // Source dates describe the exact reviewed model, never its ingestion/check date.
  const releases = new Map();
  for (const source of current.sources) for (const row of source.rows) {
    if (!row.model || !models.has(row.model) || row.releaseDate == null) continue;
    if (!validDate(row.releaseDate)) fail(`Invalid release date: ${row.model}`);
    if (releases.has(row.model) && releases.get(row.model) !== row.releaseDate)
      fail(`Conflicting release dates: ${row.model}`);
    releases.set(row.model, row.releaseDate);
  }
  for (const [id, releaseDate] of releases) {
    const model = models.get(id);
    if (model.releaseDate == null) model.releaseDate = releaseDate;
  }
  if (snapshots.version !== 1 || !Array.isArray(snapshots.records)) fail('Invalid leaderboard snapshots');
  const boards = { ...data.boards }, configs = new Map(), observations = new Set();
  for (const r of snapshots.records) {
    if (!validUrl(r.sourceHome) || !validUrl(r.source) || !validDate(r.checkedAt)
      || !Number.isInteger(r.sourceRank) || !Number.isInteger(r.sourceTotal)
      || r.sourceRank < 1 || r.sourceTotal < r.sourceRank || !models.has(r.model)
      || !/^[a-z0-9_-]+$/.test(r.board) || !/^\d+(?:\.\d+)+$/.test(r.version)
      || !/^[a-z0-9_-]+$/.test(r.variant) || !r.name || !r.metric || !Number.isFinite(r.score))
      fail(`Invalid leaderboard record: ${r.model}`);
    const board = `${r.board}_v${r.version.replaceAll('.', '_')}`;
    if (!/^[a-z0-9_-]+$/.test(board) || data.boards[board]) fail(`Invalid/conflicting board: ${board}`);
    const id = `local:${board}:${r.model}:${r.variant}`;
    const observation = `${id}:${r.checkedAt}`;
    if (observations.has(observation)) fail(`Duplicate snapshot: ${observation}`);
    observations.add(observation);
    if (boards[board] && (boards[board].metric !== r.metric || boards[board].name !== `${r.name} v${r.version}` || boards[board].url !== r.sourceHome))
      fail(`Conflicting leaderboard metadata: ${board}`);
    const previous = configs.get(id);
    if (previous && previous.checked_at === r.checkedAt) fail(`Duplicate snapshot: ${id}`);
    if (previous && previous.checked_at > r.checkedAt) continue;
    boards[board] = { name: `${r.name} v${r.version}`, metric: r.metric, url: r.sourceHome, snapshot: [boards[board]?.snapshot, r.checkedAt].filter(Boolean).sort().at(-1) };
    configs.set(id, { configuration_id: id, board, model: r.model, variant: r.variant,
      score: r.score, source_rank: r.sourceRank, source_total: r.sourceTotal, source_rank_scope: r.sourceRankScope, agent_harness: r.harness ?? null, reasoning_effort: r.effort ?? null,
      service_mode: null, score_low: null, score_high: null, source: r.source, checked_at: r.checkedAt,
      archive_url: '/data/leaderboard-snapshots.json', record_note_en: r.note?.en, record_note_zh: r.note?.zh });
  }
  return { ...data, models: [...models.values()], catalogUpdatedAt: [...models.values()].map(m => m.checkedAt).sort().at(-1),
    leaderboardUpdatedAt: snapshots.records.map(r => r.checkedAt).sort().at(-1) ?? null,
    boards, configurations: [...data.configurations, ...configs.values()] };
}

export async function loadCatalog(root) {
  const read = async p => JSON.parse(await readFile(path.join(root, p), 'utf8'));
  return { catalog: await read('data/models.json'), snapshots: await read('data/leaderboards/snapshots.json') };
}
