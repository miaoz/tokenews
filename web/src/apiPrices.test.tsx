import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiPriceDetails } from "./ApiPriceDetails";
import { apiPriceReference, apiPriceScope, formatApiAmount } from "./apiPrices";
import { COMPARISON_PAIRS } from "./comparisons";
import type { SiteData } from "./types";

const data: SiteData = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
const original = JSON.parse(readFileSync(new URL("../../upstream/derived/points.json", import.meta.url), "utf8"));

test("Current references leave all adopted points, historical list prices and snapshot dates intact", () => {
  const before = structuredClone(data.points);
  for (const point of data.points) {
    const adopted = original.points.find((p: { id: string }) => p.id === point.id)!;
    for (const key of ["list_price", "list_blended_usd_per_mtok", "real_usd_per_mtok", "price_usd", "monthly_yi", "workload", "confidence", "data_date"] as const)
      assert.deepEqual(point[key], adopted[key], `${point.id}: ${key}`);
    apiPriceReference(data, point.model);
  }
  assert.equal(data.generatedAt, original.generatedAt);
  assert.deepEqual(data.points, before);
  assert.equal(data.apiPrices?.models["gpt-6.1-sol"].checkedAt, "2026-10-19");
});

test("The explicit default wins over a cheaper tier, cache prices are exact, and missing rates are not inferred", () => {
  const edited = structuredClone(data);
  const model = edited.apiPrices!.models["gpt-6.1-sol"];
  model.variants[1].rates.input = 0.01;
  assert.equal(apiPriceReference(edited, model.id)!.variant.id, model.defaultVariant);
  assert.equal(apiPriceReference(edited, model.id)!.prices.cached, 0.1);
  model.defaultVariant = model.variants[1].id;
  model.variants[1].rates.cachedInput = null;
  model.variants[1].currency = "EUR";
  const selected = apiPriceReference(edited, model.id)!;
  assert.equal(selected.variant.id, model.defaultVariant);
  assert.equal(selected.prices.cached, null);
  assert.equal(selected.blended, null, "unknown cache rates or FX must not produce a USD reference");
  assert.equal(formatApiAmount(null, "EUR"), "—");
  assert.equal(formatApiAmount(0, "EUR"), "€0");
  model.variants[1].rates = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };
  model.variants[1].currency = "USD";
  assert.equal(apiPriceReference(edited, model.id)!.blended, 0, "an explicitly free reference stays zero, not missing");
});

test("Uncovered models retain upstream references, and genuinely missing models stay missing", () => {
  const without = { ...data, apiPrices: undefined };
  assert.equal(apiPriceReference(without, "gpt-6-astra"), null);
  assert.equal(apiPriceReference(data, "claude-opus-5.5")!.origin, "upstream");
  assert.equal(apiPriceReference(data, "not-a-model"), null);
  for (const pair of COMPARISON_PAIRS) for (const model of pair)
    assert.ok(apiPriceReference(data, model), `${model} in a curated comparison needs an API reference`);
});

test("Shared API details expose every tier, conditions, write fees, source and verification date in both languages", () => {
  for (const lang of ["en", "zh"]) {
    const reference = apiPriceReference(data, "gpt-6-astra")!;
    const html = renderToStaticMarkup(<ApiPriceDetails reference={reference} lang={lang} />);
    assert.ok(html.includes("2026-10-19"));
    assert.ok(html.includes(reference.source!));
    assert.ok(html.includes("272,000") && html.includes("272,001"));
    assert.ok(html.includes("$12.5") && html.includes("$25"));
    assert.ok(html.includes(reference.recordUrl!));
    assert.ok(html.includes(apiPriceScope(reference.variant, lang)));
  }
  const qwen = apiPriceReference(data, "qwen3.8-max")!;
  assert.equal(qwen.variant.id, "singapore-implicit");
  assert.equal(qwen.variants.find((v) => v.id === "singapore-explicit")!.rates.cachedInput, 0.17);
  assert.ok(renderToStaticMarkup(<ApiPriceDetails reference={qwen} lang="zh" />).includes("context-cache"));
});
