import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { discoverAA } from './lib/leaderboards.mjs';
import { refreshIndividualTargets } from './lib/individual-leaderboard-refresh.mjs';
import { loadCatalog, mergeCatalog } from './lib/model-catalog.mjs';
if(process.argv.slice(2).some(a=>a!=='--allow-partial'))throw Error('Usage: node scripts/update-leaderboards.mjs [--allow-partial]');
const root = fileURLToPath(new URL('../', import.meta.url));
const { catalog, snapshots } = await loadCatalog(root);
const config = JSON.parse(await readFile(path.join(root, 'data/leaderboards/sources.json'), 'utf8'));
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const get = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { 'user-agent': 'Tokenews/1.0 (+https://tokenews.xyz)' } });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response.text();
};
const {snapshots:next,records,results}=await refreshIndividualTargets(config.targets,snapshots,get,day);
const reviewed = JSON.parse(await readFile(path.join(root, 'data/leaderboards/identity-review.json'), 'utf8'));
const knownUrls = new Set([...config.targets.map(t => t.url), ...catalog.models.map(m=>m.source), ...reviewed.originalDiscovery.map(r=>r.url)]);
const dir = path.join(root, 'data/leaderboards');
let discovery, discoveryResult;
try {
 const candidates=discoverAA(await get('https://artificialanalysis.ai/models/releases'),knownUrls);
 discovery={version:1,checkedAt:day,source:'https://artificialanalysis.ai/models/releases',
  note:'Unmapped source entries requiring identity/configuration review; these may already exist under another catalog ID. Not automatically published.',
  candidates:candidates.map(c=>({...c,possibleCatalogMatches:catalog.models.filter(m=>c.label.toLowerCase().startsWith(m.name.toLowerCase()+" ")).map(m=>m.id)}))};
 discoveryResult={id:'aa-discovery',source:discovery.source,status:'updated',retainedCheckedAt:day};
} catch(e) {
 let previous;try{previous=JSON.parse(await readFile(path.join(dir,'discovery.json'),'utf8'));}catch{}
 discoveryResult={id:'aa-discovery',source:'https://artificialanalysis.ai/models/releases',status:previous?'retained-previous':'failed',retainedCheckedAt:previous?.checkedAt??null,error:e.message};
}
mergeCatalog({ points: [], configurations: [], boards: {} }, catalog, next);
// Validate before writing. Existing failed-source observations remain unchanged.
const report={version:1,attemptedAt:day,results:[...results,discoveryResult]};
const writes=[['snapshots.json',next],['individual-refresh-status.json',report],...(discovery?[['discovery.json',discovery]]:[])];
for(const [file,value] of writes){await writeFile(path.join(dir,file+'.tmp'),JSON.stringify(value,null,2)+'\n');await rename(path.join(dir,file+'.tmp'),path.join(dir,file));}
console.log(`Updated ${records.length}/${config.targets.length} tracked configurations; discovery ${discoveryResult.status}.`);
for(const r of report.results.filter(r=>r.status!=='updated'))console.warn(`::warning::${r.id}: ${r.error}; prior snapshot retained where available.`);
if(report.results.some(r=>r.status!=='updated')&&!process.argv.includes('--allow-partial'))process.exitCode=1;
