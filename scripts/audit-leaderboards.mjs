import { readFile, writeFile, rename } from 'node:fs/promises';
import { pageText } from './lib/leaderboards.mjs';
import { parseAuditSource, compareAudit, resolveModel } from './lib/leaderboard-audit.mjs';
const root = new URL('../', import.meta.url);
if (process.argv.slice(2).some(a=>a!=='--allow-partial')) throw new Error('Usage: node scripts/audit-leaderboards.mjs [--allow-partial]');
const read = async p => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const [config, catalog, points, configurations] = await Promise.all([
  read('data/leaderboards/audit-sources.json'), read('data/models.json'), read('upstream/derived/points.json'), read('upstream/derived/benchmark-configurations.json'),
]);
const expected = Object.keys(points.boards).sort();
const identities = await read('data/leaderboards/identities.json');
if (JSON.stringify(config.sources.map(s=>s.board).sort()) !== JSON.stringify(expected)) throw new Error('Audit must cover every upstream Pareto board exactly once');
const responses = new Map();
const fetchOnce = url => {
  if (!responses.has(url)) responses.set(url, fetch(url, {signal:AbortSignal.timeout(45000)}).then(async r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }));
  return responses.get(url);
};
const knownModels = [...catalog.models];
for (const id of new Set(configurations.map(c => c.model))) if (!knownModels.some(m => m.id === id)) knownModels.push({id, name:id});
const releaseSince = Object.values(points.boards).map(b=>b.snapshot).sort().at(-1);
let releases = [];
const results = await Promise.all(config.sources.map(async source => {
  try {
    const parsed = parseAuditSource(source.adapter, await fetchOnce(source.url), source.board);
    if (source.versionCheckUrl) {
      const versions = [...new Set([...pageText(await fetchOnce(source.versionCheckUrl)).matchAll(/\bv(\d+(?:\.\d+)+)/g)].map(m=>m[1]))];
      if (!versions.includes(parsed.version) || versions.some(v=>v.localeCompare(parsed.version, 'en', {numeric:true})>0))
        throw new Error(`Version review required: configured feed ${parsed.version}; source home lists ${versions.join(', ') || 'no recognizable version'}`);
    }
    if (parsed.releases) releases = parsed.releases;
    const baselineVersion = points.boards[source.board].name.match(/\bv?(\d+(?:\.\d+)+)/)?.[1] ?? null;
    const aliases = {...config.aliases, ...identities.aliases};
    for (const row of parsed.rows) if (row.releaseSlug && identities.aaReleases[row.releaseSlug]) aliases[row.identity] = identities.aaReleases[row.releaseSlug];
    return compareAudit({...source, baselineVersion}, parsed, knownModels, configurations, aliases);
  } catch (error) { return {board:source.board,source:source.url,status:'unverified',error:error.message}; }
}));
const checkedAt = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const report = {version:1,checkedAt,baselineCommit:(await read('upstream.lock.json')).commit,
  note:'Source audit is separate from publication. Unverified sources are never reported as unchanged. Identity-review rows may be aliases, historical models, or new releases. Scores across changed versions must not be mixed.',
  results, releaseSince, recentReleases: releases.filter(r=>!r.deprecated && r.releaseDate>=releaseSince).map(r=>({name:r.name,slug:r.slug,maker:r.creator.name,releaseDate:r.releaseDate,source:`https://artificialanalysis.ai/models/releases/${r.slug}`,
    catalogModel: resolveModel(r.name, catalog.models, config.aliases),
    inUpstreamDirectory: points.points.some(p => p.model === resolveModel(r.name, catalog.models, config.aliases)),
    inUpstreamBenchmarks: configurations.some(c => c.model === resolveModel(r.name, catalog.models, config.aliases))
  }))};
const destination = new URL('data/leaderboards/audit.json',root);
await writeFile(new URL('data/leaderboards/audit.json.tmp',root),JSON.stringify(report,null,2)+'\n');
await rename(new URL('data/leaderboards/audit.json.tmp',root),destination);
for(const r of results) console.log(`${r.board}: ${r.status}${r.status==='checked'?`, version ${r.baselineVersion??'unversioned'} → ${r.currentVersion??'unversioned'}, ${r.observedConfigurations} configurations, ${r.missingFromBoard.length} catalog models missing from board, ${r.unresolvedIdentities.length} identities to review`:` (${r.error})`}`);
if(results.some(r=>r.status!=='checked')) {
  console.warn('::warning::Some leaderboard sources remain unverified. See data/leaderboards/audit.json.');
  if(!process.argv.includes('--allow-partial')) process.exitCode=1;
}
