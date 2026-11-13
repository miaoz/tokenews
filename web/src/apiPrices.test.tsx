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
  const archived = data.supersededPoints ?? [];
  const archivedIds = new Set(archived.map(p=>p.id));
  for (const point of [...archived, ...data.points.filter(p=>!p.price_origin && !archivedIds.has(p.id))]) {
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

test('Terra reference includes the reviewed cache-write fee instead of adding or omitting it',()=>{
  const ref=apiPriceReference(data,'gpt-6.1-terra')!;
  assert.ok(Math.abs(ref.blended!-.10475)<1e-12);
  assert.equal(ref.variant.context?.max,272000);
  assert.equal(ref.variant.rates.cacheWrite,1.25);
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

test('Claude 5.2 references retain exact API prices and access caveats as upstream evidence evolves',()=>{
  const evidenceBefore=structuredClone({points:data.points,configurations:data.configurations,mappings:data.mappings});
  for (const family of ['fable','mythos']) {
    const id=`claude-${family}-5.2`;
    assert.ok(data.models?.some(m=>m.id===id));
    const ref=apiPriceReference(data,id)!;
    assert.equal(ref.origin,'maintained');
    assert.deepEqual(ref.variant.rates,{input:8,cachedInput:.2,cacheWrite:10,output:40});
    const record=data.apiPrices!.models[id];
    assert.equal(record.variants.find(v=>v.id==='standard-1h')!.rates.cacheWrite,16);
    assert.equal(record.variants.find(v=>v.id==='us-only-5m')!.rates.input,8.8);
    assert.equal(record.variants.find(v=>v.id==='batch')!.rates.output,20);
    assert.ok(record.notes!.en.includes(`claude-${family}-5-2`));
    // A reference lookup must not invent evidence, but new upstream evidence
    // is allowed. Absence in the release-day snapshot is not an invariant.
  }
  assert.match(data.apiPrices!.models['claude-mythos-5.2'].notes!.en,/requires approval/);
  assert.deepEqual({points:data.points,configurations:data.configurations,mappings:data.mappings},evidenceBefore);
});

test('Carbon reference rolls to regular pricing on December 1 without showing a future tier as current',()=>{
 const edited=structuredClone(data);
 const google=JSON.parse(readFileSync(new URL('../../data/api-prices/google.json',import.meta.url),'utf8'));
 const carbon=google.models.find((m:{id:string})=>m.id==='gemini-4-carbon');
 edited.apiPrices!.models[carbon.id]={...carbon,provider:'Google',recordUrl:'/data/api-prices/google.json'};
 assert.equal(apiPriceReference(edited,carbon.id,'2026-11-12'),null);
 const intro=apiPriceReference(edited,carbon.id,'2026-11-30')!;
 const regular=apiPriceReference(edited,carbon.id,'2026-12-01')!;
 assert.equal(intro.variant.id,'standard-intro');
 assert.equal(regular.variant.id,'standard-regular');
 assert.ok(Math.abs(intro.blended!-.197)<1e-12);
 assert.ok(Math.abs(regular.blended!-.394)<1e-12);
 for(const lang of ['en','zh']){
  const before=renderToStaticMarkup(<ApiPriceDetails reference={intro} lang={lang}/>);
  const after=renderToStaticMarkup(<ApiPriceDetails reference={regular} lang={lang}/>);
  assert.ok(before.includes(lang==='en'?'Future rate':'未来费率'));
  assert.ok(after.includes(lang==='en'?'Expired rate':'已过期费率'));
 }
});

test('a stale November bundle rolls Carbon chart price and mappings forward without a rebuild',async()=>{
 const {unpackData}=await import('./loadData');
 const snapshot=structuredClone(data);
 const schedule=snapshot.apiPointSchedules!.find(s=>s.alternatives[0].point.model==='gemini-4-carbon')!;
 assert.ok(schedule,'build ships the reviewed schedule');
 const intro=schedule.alternatives[0].point,regular=schedule.alternatives[1].point;
 const originalPoint=snapshot.points.find(p=>schedule.pointIds.includes(p.id))!;
 snapshot.points=snapshot.points.map(p=>p.id===originalPoint.id?intro:p);
 snapshot.mappings=snapshot.mappings.map(m=>m.point_id===originalPoint.id?{...m,point_id:intro.id}:m);
 const before=structuredClone(snapshot);
 const november=unpackData(snapshot,'2026-11-30'),december=unpackData(snapshot,'2026-12-01');
 assert.ok(november.points.some(p=>p.id===intro.id));
 assert.ok(!december.points.some(p=>p.id===intro.id));
 assert.equal(december.points.find(p=>p.id===regular.id)!.real_usd_per_mtok,.394);
 const previousMappings=november.mappings.filter(m=>m.point_id===intro.id);
 assert.ok(previousMappings.length>0);
 assert.deepEqual(december.mappings.filter(m=>m.point_id===regular.id),previousMappings.map(m=>({...m,point_id:regular.id})));
 assert.deepEqual(snapshot,before,'runtime does not mutate downloaded history');
 assert.deepEqual(unpackData(december,'2026-12-01'),december,'repeated load is idempotent');
 assert.equal(december.points.find(p=>p.id===regular.id)!.note_en,regular.note_en);
 assert.match(regular.note_en!,/implicit caching/);
 assert.deepEqual(december.points.filter(p=>!schedule.pointIds.includes(p.id)),snapshot.points.filter(p=>!schedule.pointIds.includes(p.id)));
 const expired=structuredClone(snapshot);
 expired.apiPointSchedules!.find(s=>s.pointIds.includes(intro.id))!.alternatives.pop();
 const noCurrent=unpackData(expired,'2026-12-01');
 assert.ok(!noCurrent.points.some(p=>p.id===intro.id));
 assert.ok(!noCurrent.mappings.some(m=>m.point_id===intro.id));
 const overlap=structuredClone(snapshot);
 overlap.apiPointSchedules!.find(s=>s.pointIds.includes(intro.id))!.alternatives[1].validFrom='2026-11-30';
 assert.throws(()=>unpackData(overlap,'2026-11-30'),/Overlapping/);
});
