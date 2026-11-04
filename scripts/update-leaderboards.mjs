import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseLeaderboard, discoverAA, appendSnapshots } from './lib/leaderboards.mjs';
import { loadCatalog, mergeCatalog } from './lib/model-catalog.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { catalog, snapshots } = await loadCatalog(root);
const config = JSON.parse(await readFile(path.join(root, 'data/leaderboards/sources.json'), 'utf8'));
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const get = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { 'user-agent': 'Tokenews/1.0 (+https://tokenews.xyz)' } });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response.text();
};
const records = [];
for (const target of config.targets) records.push(parseLeaderboard(await get(target.url), target, day));
const reviewed = JSON.parse(await readFile(path.join(root, 'data/leaderboards/identity-review.json'), 'utf8'));
const knownUrls = new Set([...config.targets.map(t => t.url), ...catalog.models.map(m=>m.source), ...reviewed.originalDiscovery.map(r=>r.url)]);
const candidates = discoverAA(await get('https://artificialanalysis.ai/models/releases'), knownUrls);
const next = appendSnapshots(snapshots, records);
mergeCatalog({ points: [], configurations: [], boards: {} }, catalog, next);
// All network work and validation completes before any maintained file changes.
const dir = path.join(root, 'data/leaderboards');
await writeFile(path.join(dir, 'snapshots.json.tmp'), JSON.stringify(next, null, 2) + '\n');
await rename(path.join(dir, 'snapshots.json.tmp'), path.join(dir, 'snapshots.json'));
await writeFile(path.join(dir, 'discovery.json'), JSON.stringify({ version: 1, checkedAt: day, source: 'https://artificialanalysis.ai/models/releases',
  note: 'Unmapped source entries requiring identity/configuration review; these may already exist under another catalog ID. Not automatically published.', candidates: candidates.map(c => ({ ...c, possibleCatalogMatches: catalog.models.filter(m => c.label.toLowerCase().startsWith(m.name.toLowerCase() + " ")).map(m => m.id) })) }, null, 2) + '\n');
console.log(`Updated ${records.length} configurations; ${candidates.length} unmapped AA entries to review.`);
