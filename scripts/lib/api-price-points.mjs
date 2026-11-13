import { isPriceDate, isPriceVariantActive } from '../../web/src/priceValidity.mjs';
// Only explicitly reviewed tiers become chart points. Maintaining a reference
// price alone never creates a point or rewrites an adopted subscription quota.
export function addApiPricePoints(data, catalog, manifest, asOf = new Date().toISOString().slice(0, 10)) {
  if (!isPriceDate(asOf)) throw Error('Invalid API point asOf date');
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw Error('Invalid API point manifest');
  const mix = data.conventions.standardTokenMix, ids = new Set(data.points.map(p=>p.id)), added=[];
  if (![mix.cache,mix.input,mix.output].every(n=>Number.isFinite(n)&&n>=0) || Math.abs(mix.cache+mix.input+mix.output-1)>1e-9)
    throw Error('Invalid API point workload');
  for (const entry of manifest.entries) {
    const model=data.models.find(m=>m.id===entry.model), price=catalog.models[entry.model];
    const variant=price?.variants.find(v=>v.id===entry.variant);
    const context=entry.context??{min:0,max:null};
    if (!model || !variant || variant.currency!=='USD' || variant.context.min!==context.min || variant.context.max!==context.max)
      throw Error(`API point requires an exact reviewed USD tier and context band: ${entry.model}`);
    // Validate tier identity before skipping an out-of-date reference.
    if (!isPriceVariantActive(variant, asOf)) continue;
    const {input,cachedInput,output,cacheWrite}=variant.rates;
    if (![input,cachedInput,output].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)) throw Error('API point has incomplete rates');
    const writes=entry.inputBilling==='cache-write';
    if (writes ? !(typeof cacheWrite==='number' && Number.isFinite(cacheWrite) && cacheWrite>=0)
      : entry.inputBilling==='input-or-cache-write-same-rate' ? cacheWrite!==input
      : entry.inputBilling!=='input-only' || (cacheWrite!==undefined && cacheWrite!==0))
      throw Error(`Unreviewed cache write billing: ${entry.model}`);
    const cost=mix.cache*cachedInput+mix.input*(writes?cacheWrite:input)+mix.output*output;
    if (!(cost>0)) throw Error('API point requires a positive blended cost');
    const planId=`official-api:${entry.model}:${entry.variant}`, id=`${planId}::${entry.model}`;
    if (ids.has(id)) throw Error(`Duplicate API point: ${id}`);
    ids.add(id);
    const scopeZh=`计费档位：${variant.label.zh}。`,scopeEn=`Billing tier: ${variant.label.en}. `;
    const noteZh=scopeZh+`官方 API 按量计费参考；缓存读取 ${(mix.cache*100).toFixed(1)}%、${writes?'缓存写入':'非缓存输入'} ${(mix.input*100).toFixed(1)}%、输出 ${(mix.output*100).toFixed(1)}%。${writes?'假设新增输入全部写入缓存；写入价为完整费率，不额外叠加输入费。':entry.inputBilling==='input-or-cache-write-same-rate'?'5 分钟缓存写入与普通输入单价相同，互斥计费；不适用于 1 小时 TTL。':''}不代表订阅额度或榜单任务实测成本。`;
    const noteEn=scopeEn+`Official metered API reference: ${(mix.cache*100).toFixed(1)}% cache reads, ${(mix.input*100).toFixed(1)}% ${writes?'cache writes':'fresh input'}, ${(mix.output*100).toFixed(1)}% output. ${writes?'Assumes all fresh input is written to cache; write rates replace input rates, not an additional fee. ':entry.inputBilling==='input-or-cache-write-same-rate'?'5m writes and uncached input have equal rates and are mutually exclusive; excludes 1h TTL. ':''}Not a subscription quota or measured benchmark task cost.`;
    const label=`${model.name} API · ${variant.label.en}`;
    added.push({id,plan_id:planId,plan:label,plan_en:label,model:model.id,model_display:model.name,
      vendor:model.maker,channel:entry.channel??model.maker,label,billing:'metered',confidence:'high',tier:'main',
      price_usd:null,original_price:null,currency:'USD',monthly_yi:null,monthly_tokens:null,
      real_usd_per_mtok:cost,list_blended_usd_per_mtok:cost,
      list_price:{cached:cachedInput,input,output,currency:'USD'},workload:writes?'cacheWrite':'standard',d:1,
      unmetered:false,promo_until:variant.validUntil??null,data_date:price.checkedAt,data_date_kind:'official',source:price.source,
      note:noteZh+(price.notes?.zh??''),decision_note:noteZh,
      note_en:noteEn+' '+(price.notes?.en??''),decision_note_en:noteEn,
      evidence:[{label:'Official API pricing',url:price.source}],price_origin:'maintained-api'});
  }
  return {...data,points:[...data.points,...added]};
}

// Ship already-reviewed transitions so a stale static bundle cannot retain an
// expired promotion. This does not fetch or assume any future provider prices.
export function buildApiPointSchedules(data, catalog, manifest) {
  const scopes = new Map();
  for (const entry of manifest.entries) {
    const variant = catalog.models[entry.model]?.variants.find(v=>v.id===entry.variant);
    if (!variant || (!variant.validFrom && !variant.validUntil)) continue;
    const scope = JSON.stringify([entry.model,entry.channel??null,entry.inputBilling,
      variant.currency,variant.region,variant.serviceTier,variant.context]);
    const day = variant.validFrom ?? variant.validUntil;
    const point = addApiPricePoints({...data,points:[]},catalog,{version:1,entries:[entry]},day).points[0];
    if (!scopes.has(scope)) scopes.set(scope,{pointIds:[],alternatives:[]});
    const group = scopes.get(scope);
    group.pointIds.push(point.id);
    group.alternatives.push({validFrom:variant.validFrom,validUntil:variant.validUntil,point});
  }
  for (const group of scopes.values()) {
    group.alternatives.sort((a,b)=>(a.validFrom??'').localeCompare(b.validFrom??''));
    for (let i=1;i<group.alternatives.length;i++) {
      const previous=group.alternatives[i-1],next=group.alternatives[i];
      if (!previous.validUntil || !next.validFrom || previous.validUntil>=next.validFrom)
        throw Error('Overlapping reviewed API point validity ranges');
    }
  }
  return [...scopes.values()];
}
