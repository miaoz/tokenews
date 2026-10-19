import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadApiPrices, priceCoverage } from "./lib/api-prices.mjs";

const root = new URL("../", import.meta.url);
const [command = "check", ...flags] = process.argv.slice(2);
if (!["check", "report"].includes(command) || flags.some((f) => f !== "--json"))
  throw new Error("Usage: node scripts/api-prices.mjs check|report [--json]");
const { catalog, files } = await loadApiPrices(fileURLToPath(new URL("data/api-prices/", root)));
if (command === "check") {
  const result = { files: files.length, models: Object.keys(catalog.models).length, variants: Object.values(catalog.models).reduce((n, m) => n + m.variants.length, 0), checkedAt: catalog.updatedAt };
  console.log(flags.includes("--json") ? JSON.stringify(result, null, 2) : `API prices valid: ${result.models} models, ${result.variants} variants, ${result.files} provider files; latest check ${result.checkedAt ?? "—"}.`);
} else {
  const { points } = JSON.parse(await readFile(new URL("upstream/derived/points.json", root), "utf8"));
  const report = priceCoverage(catalog, points);
  if (flags.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`API price coverage: ${report.maintainedModels} maintained locally, ${report.upstreamOnlyModels} upstream-only, ${report.missingModels} missing / ${report.totalModels} models (${report.missingRecords} records without prices).`);
    console.table(report.rows.map(({ model, status, checkedAt, differsFromUpstream }) => ({ model, status, checkedAt: checkedAt ?? "—", reviewDifference: differsFromUpstream ? "yes" : "" })));
    if (report.unusedModels.length) console.log(`Not in the current upstream snapshot: ${report.unusedModels.join(", ")}`);
    if (report.differences.length) console.log(`Local default and upstream references differ; compare dates and conditions: ${report.differences.join(", ")}. Upstream records are preserved.`);
  }
}
