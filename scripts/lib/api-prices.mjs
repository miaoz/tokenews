// Tokenews-owned official API references. No upstream files are modified here.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const PRICE_UNIT = "per_million_tokens";

export function validatePriceFile(value, file, today = new Date().toISOString().slice(0, 10)) {
  const fail = (at, message) => { throw new Error(`${file}${at}: ${message}`); };
  const object = (v, at, required, optional = []) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) fail(at, "expected an object");
    for (const key of required) if (!(key in v)) fail(`${at}.${key}`, "required");
    for (const key of Object.keys(v))
      if (![...required, ...optional].includes(key)) fail(`${at}.${key}`, "unknown field");
  };
  const text = (v, at) => {
    if (typeof v !== "string" || !v.trim() || v !== v.trim()) fail(at, "expected non-empty trimmed text");
  };
  const bilingual = (v, at) => {
    object(v, at, ["en", "zh"]);
    for (const lang of ["en", "zh"]) text(v[lang], `${at}.${lang}`);
  };
  const amount = (v, at) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(at, "expected a non-negative finite number");
  };
  const url = (v, at) => {
    text(v, at);
    let source;
    try { source = new URL(v); } catch { fail(at, "expected an official HTTPS URL"); }
    if (source.protocol !== "https:" || source.username || source.password) fail(at, "expected an official HTTPS URL without credentials");
  };
  object(value, "", ["schemaVersion", "provider", "unit", "models"]);
  if (value.schemaVersion !== 1) fail(".schemaVersion", "expected 1");
  if (value.unit !== PRICE_UNIT) fail(".unit", `expected ${PRICE_UNIT}`);
  text(value.provider, ".provider");
  if (!Array.isArray(value.models) || !value.models.length) fail(".models", "expected a non-empty array");
  const modelIds = new Set();
  for (const [i, model] of value.models.entries()) {
    const at = `.models[${i}]`;
    object(model, at, ["id", "source", "checkedAt", "defaultVariant", "variants"], ["notes", "additionalSources"]);
    text(model.id, `${at}.id`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model.id)) fail(`${at}.id`, "expected an exact model ID");
    if (modelIds.has(model.id)) fail(`${at}.id`, `duplicate model ${model.id}`);
    modelIds.add(model.id);
    url(model.source, `${at}.source`);
    if (model.additionalSources !== undefined) {
      if (!Array.isArray(model.additionalSources)) fail(`${at}.additionalSources`, "expected an array of official HTTPS URLs");
      model.additionalSources.forEach((v, n) => url(v, `${at}.additionalSources[${n}]`));
    }
    if (typeof model.checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(model.checkedAt)
        || !Number.isFinite(Date.parse(model.checkedAt))
        || new Date(model.checkedAt).toISOString().slice(0, 10) !== model.checkedAt
        || model.checkedAt > today) fail(`${at}.checkedAt`, "expected a valid non-future YYYY-MM-DD date");
    text(model.defaultVariant, `${at}.defaultVariant`);
    if (model.notes !== undefined) bilingual(model.notes, `${at}.notes`);
    if (!Array.isArray(model.variants) || !model.variants.length) fail(`${at}.variants`, "expected a non-empty array");
    const variants = new Set();
    for (const [j, variant] of model.variants.entries()) {
      const va = `${at}.variants[${j}]`;
      object(variant, va, ["id", "label", "currency", "region", "serviceTier", "context", "rates"], ["notes"]);
      text(variant.id, `${va}.id`);
      if (variants.has(variant.id)) fail(`${va}.id`, `duplicate variant ${variant.id}`);
      variants.add(variant.id);
      bilingual(variant.label, `${va}.label`);
      if (typeof variant.currency !== "string" || !/^[A-Z]{3}$/.test(variant.currency)) fail(`${va}.currency`, "expected a three-letter uppercase currency code");
      for (const key of ["region", "serviceTier"]) text(variant[key], `${va}.${key}`);
      object(variant.context, `${va}.context`, ["min", "max"]);
      const { min, max } = variant.context;
      if (!Number.isSafeInteger(min) || min < 0 || (max !== null && (!Number.isSafeInteger(max) || max < min)))
        fail(`${va}.context`, "expected inclusive input-token bounds: min >= 0, max >= min or null");
      object(variant.rates, `${va}.rates`, ["input", "cachedInput", "output"], ["cacheWrite"]);
      for (const key of ["input", "output"]) amount(variant.rates[key], `${va}.rates.${key}`);
      for (const key of ["cachedInput", "cacheWrite"])
        if (key in variant.rates && variant.rates[key] !== null) amount(variant.rates[key], `${va}.rates.${key}`);
      if (variant.notes !== undefined) bilingual(variant.notes, `${va}.notes`);
    }
    if (!variants.has(model.defaultVariant)) fail(`${at}.defaultVariant`, "does not name a variant");
  }
  return value;
}

export async function loadApiPrices(directory) {
  const files = (await readdir(directory)).filter((f) => f.endsWith(".json")).sort();
  const models = {};
  for (const file of files) {
    if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(file)) throw new Error(`API price file must use a lowercase provider filename: ${file}`);
    let parsed;
    try { parsed = JSON.parse(await readFile(path.join(directory, file), "utf8")); }
    catch (error) { throw new Error(`${file}: ${error.message}`); }
    const value = validatePriceFile(parsed, file);
    for (const model of value.models) {
      if (Object.hasOwn(models, model.id)) throw new Error(`${file}: duplicate model ${model.id} across price files`);
      models[model.id] = { ...model, provider: value.provider, recordUrl: `/data/api-prices/${file}` };
    }
  }
  return {
    catalog: { version: 1, unit: PRICE_UNIT, updatedAt: Object.values(models).map((m) => m.checkedAt).sort().at(-1) ?? null, models },
    files,
  };
}

export function priceCoverage(catalog, points) {
  const groups = new Map();
  for (const p of points) {
    if (!groups.has(p.model)) groups.set(p.model, []);
    groups.get(p.model).push(p);
  }
  const rows = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([model, records]) => {
    const local = Object.hasOwn(catalog.models, model) ? catalog.models[model] : undefined;
    const variant = local?.variants.find((v) => v.id === local.defaultVariant);
    const upstream = [...new Map(records.filter((p) => p.list_price).map((p) => [JSON.stringify(p.list_price), p.list_price])).values()];
    return {
      model, provider: local?.provider ?? records[0].vendor, records: records.length,
      status: local ? "maintained" : upstream.length ? "upstream-only" : "missing",
      checkedAt: local?.checkedAt ?? null,
      source: local?.source ?? null,
      upstreamReferences: upstream,
      differsFromUpstream: !!variant && upstream.some((p) => p.currency !== variant.currency
        || p.input !== variant.rates.input || p.cached !== variant.rates.cachedInput || p.output !== variant.rates.output),
    };
  });
  return {
    totalModels: rows.length,
    maintainedModels: rows.filter((r) => r.status === "maintained").length,
    upstreamOnlyModels: rows.filter((r) => r.status === "upstream-only").length,
    missingModels: rows.filter((r) => r.status === "missing").length,
    missingRecords: rows.filter((r) => r.status === "missing").reduce((n, r) => n + r.records, 0),
    unusedModels: Object.keys(catalog.models).filter((id) => !groups.has(id)),
    differences: rows.filter((r) => r.differsFromUpstream).map((r) => r.model),
    rows,
  };
}
