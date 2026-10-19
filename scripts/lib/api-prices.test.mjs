import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadApiPrices, priceCoverage, validatePriceFile } from "./api-prices.mjs";

const fixture = () => ({
  schemaVersion: 1, provider: "Example", unit: "per_million_tokens",
  models: [{
    id: "model-a", source: "https://example.com/pricing", checkedAt: "2026-10-01", defaultVariant: "standard",
    variants: [{ id: "standard", label: { en: "Standard", zh: "标准档" }, currency: "USD", region: "global", serviceTier: "standard", context: { min: 0, max: null }, rates: { input: 2, cachedInput: null, output: 10 } }],
  }],
});

test("Bad source, units, dates, prices and ambiguous defaults identify the faulty file and field", () => {
  const cases = [
    ["source", (v) => { v.models[0].source = "javascript:alert(1)"; }],
    ["additionalSources", (v) => { v.models[0].additionalSources = ["http://example.com"]; }],
    ["unit", (v) => { v.unit = "per_token"; }],
    ["checkedAt", (v) => { v.models[0].checkedAt = "2026-02-30"; }],
    ["checkedAt", (v) => { v.models[0].checkedAt = "2026-10-20"; }],
    ["rates.input", (v) => { v.models[0].variants[0].rates.input = -1; }],
    ["rates.cachedInput", (v) => { delete v.models[0].variants[0].rates.cachedInput; }],
    ["rates.cachedInput", (v) => { v.models[0].variants[0].rates.cachedInput = "0.1"; }],
    ["rates.cacheWrite", (v) => { v.models[0].variants[0].rates.cacheWrite = Infinity; }],
    ["rates.ouput", (v) => { v.models[0].variants[0].rates.ouput = 2; }],
    ["context", (v) => { v.models[0].variants[0].context = { min: 20, max: 10 }; }],
    ["defaultVariant", (v) => { v.models[0].defaultVariant = "nonexistent"; }],
    ["duplicate variant", (v) => { v.models[0].variants.push(structuredClone(v.models[0].variants[0])); }],
    ["duplicate model", (v) => { v.models.push(structuredClone(v.models[0])); }],
  ];
  for (const [message, change] of cases) {
    const data = fixture();
    change(data);
    assert.throws(() => validatePriceFile(data, "provider.json", "2026-10-19"), (error) =>
      error.message.startsWith("provider.json") && error.message.includes(message), message);
  }
});

test("Unknown cache prices remain null; explicit zero and new region/service tiers are accepted", () => {
  const value = fixture();
  const extra = structuredClone(value.models[0].variants[0]);
  extra.id = "batch-eu";
  extra.region = "DE";
  extra.currency = "EUR";
  extra.serviceTier = "batch";
  extra.context = { min: 272001, max: 1000000 };
  extra.rates = { input: 0, cachedInput: null, cacheWrite: 0, output: 0 };
  value.models[0].variants.push(extra);
  value.models[0].defaultVariant = extra.id;
  validatePriceFile(value, "provider.json", "2026-10-19");
  assert.equal(value.models[0].variants[0].rates.cachedInput, null);
  assert.equal(value.models[0].variants[1].rates.cacheWrite, 0);
});

test("New provider files load automatically; duplicate model IDs fail and file removal takes effect", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "tokenews-api-prices-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "first.json"), JSON.stringify(fixture()));
  await writeFile(path.join(directory, "README.md"), "Not a price file");
  await writeFile(path.join(directory, "second.json"), JSON.stringify(fixture()));
  await assert.rejects(loadApiPrices(directory), /duplicate model model-a across price files/);
  const next = fixture();
  next.models[0].id = "model-b";
  await writeFile(path.join(directory, "second.json"), JSON.stringify(next));
  const result = await loadApiPrices(directory);
  assert.deepEqual(Object.keys(result.catalog.models), ["model-a", "model-b"]);
  assert.equal(result.catalog.models["model-b"].recordUrl, "/data/api-prices/second.json");
  await rm(path.join(directory, "first.json"));
  assert.deepEqual(Object.keys((await loadApiPrices(directory)).catalog.models), ["model-b"]);
  await writeFile(path.join(directory, "broken.json"), "{invalid");
  await assert.rejects(loadApiPrices(directory), /broken.json/);
});

test("Coverage separates locally checked, upstream-only, missing and ahead-of-upstream models without changing points", () => {
  const local = fixture().models[0];
  const catalog = { models: { "model-a": local, pending: { ...local, id: "pending" } } };
  const points = [
    { model: "model-a", vendor: "Example", list_price: { input: 1, cached: 0.1, output: 5, currency: "USD" } },
    { model: "model-b", vendor: "Example", list_price: { input: 1, cached: 0.1, output: 5, currency: "USD" } },
    { model: "model-c", vendor: "Example", list_price: null },
    { model: "model-c", vendor: "Example", list_price: null },
  ];
  const before = structuredClone(points);
  const report = priceCoverage(catalog, points);
  assert.deepEqual([report.maintainedModels, report.upstreamOnlyModels, report.missingModels, report.missingRecords], [1, 1, 1, 2]);
  assert.deepEqual(report.differences, ["model-a"]);
  assert.deepEqual(report.unusedModels, ["pending"]);
  assert.deepEqual(points, before);
});
