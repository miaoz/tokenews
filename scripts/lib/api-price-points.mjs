// Only explicitly reviewed tiers become chart points. Maintaining a reference
// price alone never creates a point or rewrites an adopted subscription quota.
export function addApiPricePoints(data, catalog, manifest) {
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw Error('Invalid API point manifest');
  const mix = data.conventions.standardTokenMix, ids = new Set(data.points.map(p=>p.id)), added=[];
  if (![mix.cache,mix.input,mix.output].every(n=>Number.isFinite(n)&&n>=0) || Math.abs(mix.cache+mix.input+mix.output-1)>1e-9)
    throw Error('Invalid API point workload');
  for (const entry of manifest.entries) {
    const model=data.models.find(m=>m.id===entry.model), price=catalog.models[entry.model];
    const variant=price?.variants.find(v=>v.id===entry.variant);
    if (!model || !variant || variant.currency!=='USD' || variant.context.min!==0 || variant.context.max!==null)
      throw Error(`API point requires an exact reviewed USD tier without context bands: ${entry.model}`);
    const {input,cachedInput,output,cacheWrite}=variant.rates;
    if (![input,cachedInput,output].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)) throw Error('API point has incomplete rates');
    if (entry.inputBilling==='input-or-cache-write-same-rate' ? cacheWrite!==input
      : entry.inputBilling!=='input-only' || (cacheWrite!==undefined && cacheWrite!==0))
      throw Error(`Unreviewed cache write billing: ${entry.model}`);
    const cost=mix.cache*cachedInput+mix.input*input+mix.output*output;
    if (!(cost>0)) throw Error('API point requires a positive blended cost');
    const planId=`official-api:${entry.model}:${entry.variant}`, id=`${planId}::${entry.model}`;
    if (ids.has(id)) throw Error(`Duplicate API point: ${id}`);
    ids.add(id);
    const noteZh=`官方 API 按量计费参考；缓存读取 ${(mix.cache*100).toFixed(1)}%、非缓存输入 ${(mix.input*100).toFixed(1)}%、输出 ${(mix.output*100).toFixed(1)}%。${entry.inputBilling==='input-or-cache-write-same-rate'?'5 分钟缓存写入与普通输入单价相同，互斥计费；不适用于 1 小时 TTL。':''}不代表订阅额度或榜单任务实测成本。`;
    const noteEn=`Official metered API reference: ${(mix.cache*100).toFixed(1)}% cache reads, ${(mix.input*100).toFixed(1)}% fresh input, ${(mix.output*100).toFixed(1)}% output. ${entry.inputBilling==='input-or-cache-write-same-rate'?'5m writes and uncached input have equal rates and are mutually exclusive; excludes 1h TTL. ':''}Not a subscription quota or measured benchmark task cost.`;
    const label=`${model.name} API · ${variant.label.en}`;
    added.push({id,plan_id:planId,plan:label,plan_en:label,model:model.id,model_display:model.name,
      vendor:model.maker,channel:model.maker,label,billing:'metered',confidence:'high',tier:'main',
      price_usd:null,original_price:null,currency:'USD',monthly_yi:null,monthly_tokens:null,
      real_usd_per_mtok:cost,list_blended_usd_per_mtok:cost,
      list_price:{cached:cachedInput,input,output,currency:'USD'},workload:'standard',d:1,
      unmetered:false,promo_until:null,data_date:price.checkedAt,data_date_kind:'official',source:price.source,
      note:noteZh+(price.notes?.zh??''),decision_note:noteZh,
      note_en:noteEn+' '+(price.notes?.en??''),decision_note_en:noteEn,
      evidence:[{label:'Official API pricing',url:price.source}],price_origin:'maintained-api'});
  }
  return {...data,points:[...data.points,...added]};
}
