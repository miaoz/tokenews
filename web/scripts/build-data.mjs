import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { buildSiteData } from "../../scripts/lib/build-site-data.mjs";
import { loadApiPrices, priceCoverage } from "../../scripts/lib/api-prices.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// The data snapshot synced from upstream (scripts/sync-upstream.mjs).
const repo = path.resolve(root, "../upstream");
const out = path.join(root, "public/data");
const read = async (p) =>
  JSON.parse(await readFile(path.join(repo, p), "utf8"));
const { data, evidenceToCopy } = await buildSiteData({ repo, parseCsv: parse });
const priceDirectory = path.resolve(root, "../data/api-prices");
const { catalog, files: priceFiles } = await loadApiPrices(priceDirectory);
// Keep adopted points byte-for-byte meaningful: current prices never replace
// the historical list_price / blended reference used to explain a quota.
data.apiPrices = catalog;
const coverage = priceCoverage(catalog, data.points);
await mkdir(path.join(out, "evidence"), { recursive: true });
await rm(path.join(out, "api-prices"), { recursive: true, force: true });
await mkdir(path.join(out, "api-prices"), { recursive: true });
for (const file of priceFiles) await copyFile(path.join(priceDirectory, file), path.join(out, "api-prices", file));
await writeFile(path.join(out, "api-prices.json"), JSON.stringify(catalog));
await writeFile(path.join(out, "api-price-coverage.json"), JSON.stringify(coverage));
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
await writeFile(
  path.join(out, "explorer.json"),
  JSON.stringify({ ...data, points: points.core, configurations: configurations.core }),
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
  `Website data: ${data.points.length} points, ${data.configurations.length} configurations, ${data.mappings.length} references, ${evidenceToCopy.size} evidence files. Values verified against adopted.csv.`,
);
console.log(`API prices: ${coverage.maintainedModels} maintained, ${coverage.upstreamOnlyModels} upstream-only, ${coverage.missingModels} missing / ${coverage.totalModels} models.`);
if (coverage.differences.length) console.warn(`API reference differences (review source dates and conditions): ${coverage.differences.join(", ")}. Adopted points are unchanged.`);
if (coverage.unusedModels.length) console.warn(`API prices recorded ahead of upstream model coverage: ${coverage.unusedModels.join(", ")}.`);
