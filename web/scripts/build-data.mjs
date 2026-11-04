import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { buildSiteData } from "../../scripts/lib/build-site-data.mjs";
import { loadCatalog, mergeCatalog } from "../../scripts/lib/model-catalog.mjs";
import { mergeCurrentLeaderboards } from "../../scripts/lib/current-leaderboards.mjs";
import { attachRefreshStatus } from "../../scripts/lib/leaderboard-refresh.mjs";
import { addApiPricePoints } from "../../scripts/lib/api-price-points.mjs";
import { loadApiPrices, priceCoverage } from "../../scripts/lib/api-prices.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// The data snapshot synced from upstream (scripts/sync-upstream.mjs).
const repo = path.resolve(root, "../upstream");
const out = path.join(root, "public/data");
const read = async (p) =>
  JSON.parse(await readFile(path.join(repo, p), "utf8"));
const { data: upstreamData, evidenceToCopy } = await buildSiteData({ repo, parseCsv: parse });
const { catalog: models, snapshots } = await loadCatalog(path.resolve(root, ".."));
const current = JSON.parse(await readFile(path.resolve(root, '../data/leaderboards/current.json'), 'utf8'));
const refresh = JSON.parse(await readFile(path.resolve(root, '../data/leaderboards/refresh-status.json'), 'utf8'));
const priceDirectory = path.resolve(root, "../data/api-prices");
const { catalog, files: priceFiles } = await loadApiPrices(priceDirectory);
const apiPointManifest = JSON.parse(await readFile(path.resolve(root, '../data/api-price-points.json'), 'utf8'));
const pricedData = addApiPricePoints(mergeCatalog(upstreamData, models, snapshots), catalog, apiPointManifest);
const data = attachRefreshStatus(mergeCurrentLeaderboards(pricedData, current), refresh);
// Keep adopted points byte-for-byte meaningful: current prices never replace
// the historical list_price / blended reference used to explain a quota.
data.apiPrices = catalog;
const coverage = priceCoverage(catalog, data.points, data.models);
await mkdir(path.join(out, "evidence"), { recursive: true });
await rm(path.join(out, "api-prices"), { recursive: true, force: true });
await mkdir(path.join(out, "api-prices"), { recursive: true });
for (const file of priceFiles) await copyFile(path.join(priceDirectory, file), path.join(out, "api-prices", file));
await writeFile(path.join(out, "api-prices.json"), JSON.stringify(catalog));
await writeFile(path.join(out, "api-price-coverage.json"), JSON.stringify(coverage));
await writeFile(path.join(out, "models.json"), JSON.stringify(data.models));
await writeFile(path.join(out, "leaderboard-snapshots.json"), JSON.stringify(snapshots));
await writeFile(path.join(out, "current-leaderboards.json"), JSON.stringify(current));
await writeFile(path.join(out, "leaderboard-coverage.json"), JSON.stringify(data.leaderboardCoverage));
await writeFile(path.join(out, "leaderboard-refresh.json"), JSON.stringify(refresh));
await writeFile(path.join(out, "site.json"), JSON.stringify(data));
// The explorer's first download leaves out the long-form notes it only shows in
// the "Behind the number" dialog; they load afterwards from explorer-notes.json.
// Field lists match PointNotes / ConfigurationNotes in src/types.ts.
const POINT_NOTES = ["note", "decision_note", "note_en", "decision_note_en", "evidence"];
const CONFIGURATION_NOTES = ["record_note_zh", "record_note_en", "archive", "archive_url"];
const split = (records, key, fields) => {
  const notes = {};
  const core = records.map((record) => {
    const rest = { ...record };
    const picked = {};
    for (const f of fields)
      if (f in rest) {
        picked[f] = rest[f];
        delete rest[f];
      }
    if (Object.keys(picked).length) notes[record[key]] = picked;
    return rest;
  });
  return { core, notes };
};
const points = split(data.points, "id", POINT_NOTES);
const configurations = split(data.configurations, "configuration_id", CONFIGURATION_NOTES);
const configBoards = new Map(data.configurations.map(c => [c.configuration_id, c.board]));
const pricedBoards = new Set(data.mappings.map(m => configBoards.get(m.configuration_id)));
const explorerBoards = Object.fromEntries(Object.entries(data.boards).filter(([id]) => data.currentBoards.includes(id)));
if (data.currentBoards.some(id => !pricedBoards.has(id))) throw new Error('A current Pareto board has no price mappings');
const currentConfigIds = new Set(data.configurations.filter(c=>data.currentBoards.includes(c.board)).map(c=>c.configuration_id));
await writeFile(
  path.join(out, "explorer.json"),
  JSON.stringify({ ...data, boards: explorerBoards, points: points.core,
    configurations: configurations.core.filter(c=>currentConfigIds.has(c.configuration_id)),
    mappings:data.mappings.filter(m=>currentConfigIds.has(m.configuration_id)) }),
);
await writeFile(
  path.join(out, "explorer-notes.json"),
  JSON.stringify({ points: points.notes, configurations: configurations.notes }),
);
for (const f of [
  "data/adopted.csv",
  "derived/points.json",
  "derived/points.csv",
  "derived/benchmark-configurations.json",
  "derived/benchmark-configurations.csv",
  "derived/benchmark-points.json",
  "derived/benchmark-points.csv",
  "data/conventions.json",
]) {
  const destination = path.join(out, path.basename(f));
  if (f.endsWith(".json"))
    await writeFile(destination, JSON.stringify(await read(f)));
  else await copyFile(path.join(repo, f), destination);
}
for (const f of evidenceToCopy)
  await copyFile(
    path.join(repo, "data/research", f),
    path.join(out, "evidence", f),
  );
console.log(
  `Website data: ${data.points.length} points (${upstreamData.points.length} unchanged adopted points, ${data.points.length-upstreamData.points.length} reviewed API points), ${data.configurations.length} configurations, ${data.mappings.length} references, ${evidenceToCopy.size} evidence files.`,
);
console.log(`API prices: ${coverage.maintainedModels} maintained, ${coverage.upstreamOnlyModels} upstream-only, ${coverage.missingModels} missing / ${coverage.totalModels} models.`);
if (coverage.differences.length) console.warn(`API reference differences (review source dates and conditions): ${coverage.differences.join(", ")}. Adopted points are unchanged.`);
if (coverage.unusedModels.length) console.warn(`API prices recorded ahead of upstream model coverage: ${coverage.unusedModels.join(", ")}.`);
