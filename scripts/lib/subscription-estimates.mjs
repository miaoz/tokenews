// Reviewed sample extrapolations, deliberately separate from official credit pools.
// This adapter never changes upstream records or treats an estimate as a guarantee.
export function mergeSubscriptionEstimates(data, manifest) {
  const fail = message => { throw Error(`Subscription estimate review required: ${message}`); };
  const date = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
  const text = s => typeof s === 'string' && s.trim().length > 0;
  const bilingual = v => v && text(v.en) && text(v.zh);
  const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const nonNeg = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const https = s => { try { return typeof s === 'string' && new URL(s).protocol === 'https:'; } catch { return false; } };
  if (manifest?.version !== 1 || !date(manifest.checkedAt) || !Array.isArray(manifest.entries) ||
      !Array.isArray(manifest.archivedPointIds) || !Array.isArray(manifest.evidenceFiles) || !manifest.evidenceFiles.length ||
      manifest.evidenceFiles.some(f=>typeof f !== 'string' || !/^evidence-\d{4}-\d{2}-\d{2}\.json$/.test(f)) ||
      new Set(manifest.evidenceFiles).size !== manifest.evidenceFiles.length) fail('invalid manifest');
  const mix = data.conventions?.anthropicTokenMix;
  if (mix?.cache !== .97 || mix.cacheWrite !== .025 || mix.output !== .005 || data.conventions.monthWeeks !== 4) fail('normalization conventions changed');
  const ids = new Set(data.points.map(p=>p.id));
  if (ids.size !== data.points.length) fail('duplicate input point IDs');
  const models = new Map(data.models.map(m=>[m.id,m]));
  const archives = [], archiveIds = new Set();
  for (const a of manifest.archivedPointIds) {
    if (!text(a.id) || !models.has(a.model) || !date(a.latestSampleDate) || a.latestSampleDate > manifest.checkedAt || !bilingual(a.reason) || !positive(a.expectedMonthlyTokens) || !positive(a.expectedPriceUsdPerMillion) || archiveIds.has(a.id)) fail('invalid archive request');
    const point = data.points.find(p=>p.id===a.id);
    if (!point || point.model !== a.model || !date(point.data_date) || point.data_date > a.latestSampleDate || point.monthly_tokens !== a.expectedMonthlyTokens || point.real_usd_per_mtok !== a.expectedPriceUsdPerMillion) fail(`archive identity/date changed: ${a.id}`);
    if ((data.supersededPoints ?? []).some(p=>p.id===a.id)) fail(`archive ID collision: ${a.id}`);
    archiveIds.add(a.id); archives.push(point);
  }
  const pairs = new Set(data.points.map(p=>`${p.plan_id ?? p.id.split('::')[0]}::${p.model}`));
  const added = [];
  for (const e of manifest.entries) {
    const c=e.calibration, rates=e.rates, model=models.get(e.model);
    if (!text(e.id) || !text(e.planId) || !text(e.name) || !text(e.sampleFrom) || !model || !positive(e.monthlyUsd) ||
        (e.channel !== undefined && (!text(e.channel) || e.channel !== e.channel.trim())) ||
        (e.promoUntil !== undefined && !date(e.promoUntil)) ||
        !['low','medium'].includes(e.confidence) || !date(e.sampleDate) || e.sampleDate > manifest.checkedAt || !bilingual(e.note) ||
        !Array.isArray(e.upstreamPlanIds) || !e.upstreamPlanIds.length || e.upstreamPlanIds.some(p=>!text(p) || p !== p.trim()) || new Set(e.upstreamPlanIds).size !== e.upstreamPlanIds.length ||
        !Array.isArray(e.sources) || !e.sources.length || e.sources.some(s=>!text(s.label)||!https(s.url))) fail(`invalid entry provenance: ${e.id}`);
    if (data.points.some(p=>p.model===e.model && (e.upstreamPlanIds.includes(p.plan_id) || e.upstreamPlanIds.includes(p.id.split('::')[0])))) fail(`upstream plan sample requires review: ${e.id}`);
    const pair=`${e.planId}::${e.model}`;
    if (ids.has(e.id) || (data.supersededPoints ?? []).some(p=>p.id===e.id) || pairs.has(pair)) fail(`point or plan/model collision: ${e.id}`);
    ids.add(e.id); pairs.add(pair);

    let blend, worth, tokens, price, workload, en, zh;
    if (c?.meter === 'fable-weekly') {
      if (!positive(c.sampleWorthUsd) || !positive(c.quotaFraction) || c.quotaFraction > 1 ||
          !positive(c.planRatio) || c.monthWeeks !== 4 || (c.planRatio !== 1 && e.confidence !== 'low')) fail(`invalid calibration: ${e.id}`);
      // A Fable sub-meter already includes its cap; no second 50% adjustment.
      if (Object.keys(c).some(k=>!['sampleWorthUsd','quotaFraction','meter','planRatio','monthWeeks'].includes(k))) fail(`unreviewed calibration field: ${e.id}`);
      if (!rates || rates.cache !== .2 || rates.input !== 8 || rates.cacheWrite !== 10 || rates.output !== 40 || Object.keys(rates).some(k=>!['cache','input','cacheWrite','output'].includes(k))) fail(`rates need review: ${e.id}`);
      blend=mix.cache*rates.cache + mix.cacheWrite*rates.cacheWrite + mix.output*rates.output;
      worth=c.sampleWorthUsd / c.quotaFraction * c.monthWeeks * c.planRatio;
      const monthlyMt=worth/blend;
      tokens=monthlyMt*1e6; price=e.monthlyUsd/monthlyMt; workload='anthropic';
      en=`Sample-based quota estimate, not an official or guaranteed allowance. Fable weekly sub-meter already includes its allocation cap; no additional halving. Monthly normalized tokens = sample API worth $${c.sampleWorthUsd} / ${c.quotaFraction} × ${c.monthWeeks} weeks × plan ratio ${c.planRatio} / $${blend}/MTok × 1,000,000. Anthropic comparison mix: 97% cache reads, 2.5% 5-minute cache writes, 0.5% output; not raw tokens. Session limits, resets and cross-plan charging can reduce usable quota. ${e.note.en}`;
      zh=`基于样本推算的额度，不是官方或保证额度。Fable 子周表已含分配上限，不再次折半。月标准 token = 样本 API 价值 $${c.sampleWorthUsd} ÷ ${c.quotaFraction} × ${c.monthWeeks} 周 × 套餐倍率 ${c.planRatio} ÷ $${blend}/MTok × 1,000,000。Anthropic 比较负载：97% 缓存读、2.5% 五分钟缓存写、0.5% 输出；不是原始 token。会话限制、重置及跨套餐扣费差异可能降低实际可用量。${e.note.zh}`;
    } else if (c?.meter === 'anchor-pool') {
      const std = data.conventions?.standardTokenMix;
      if (std?.cache !== .97 || std.input !== .025 || std.output !== .005) fail('normalization conventions changed');
      const workloadMix = c.workloadMix ?? 'standard';
      if (!['standard','lowCache'].includes(workloadMix)) fail(`invalid workloadMix: ${e.id}`);
      const lowMix = workloadMix === 'lowCache' ? data.conventions?.lowCacheTokenMix : null;
      if (workloadMix === 'lowCache' && (lowMix?.cache !== .85 || lowMix.input !== .145 || lowMix.output !== .005)) fail('normalization conventions changed');
      const mixSpec = workloadMix === 'lowCache' ? lowMix : std;
      if (e.confidence !== 'low' || !text(c.anchorPointId) || !positive(c.planRatio) || !['worth-ratio','same-token-carry'].includes(c.anchorMode)) fail(`invalid calibration: ${e.id}`);
      const allowedCal = c.anchorMode === 'worth-ratio'
        ? ['meter','anchorMode','anchorPointId','planRatio','anchorRates','workloadMix']
        : ['meter','anchorMode','anchorPointId','planRatio','workloadMix'];
      if (Object.keys(c).some(k=>!allowedCal.includes(k))) fail(`unreviewed calibration field: ${e.id}`);
      const anchor = data.points.find(p=>p.id===c.anchorPointId);
      if (!anchor || archiveIds.has(anchor.id) || anchor.billing !== 'subscription' || anchor.vendor !== model.maker || !positive(anchor.monthly_tokens))
        fail(`invalid anchor point: ${e.id}`);
      if (workloadMix === 'lowCache' && anchor.workload !== 'lowCache') fail(`anchor workload mismatch: ${e.id}`);
      if (!rates || !nonNeg(rates.cache) || !nonNeg(rates.input) || !nonNeg(rates.output) ||
          (rates.cacheWrite !== undefined && !positive(rates.cacheWrite)) ||
          Object.keys(rates).some(k=>!['cache','input','cacheWrite','output'].includes(k))) fail(`rates need review: ${e.id}`);
      const usesWrite = e.freshInputBilling === 'cache-write';
      if (e.freshInputBilling !== undefined && (!usesWrite || workloadMix === 'lowCache')) fail(`invalid freshInputBilling: ${e.id}`);
      if (usesWrite ? !positive(rates.cacheWrite) : rates.cacheWrite !== undefined) fail(`cacheWrite mismatch: ${e.id}`);
      blend = mixSpec.cache * rates.cache + mixSpec.input * (usesWrite ? rates.cacheWrite : rates.input) + mixSpec.output * rates.output;
      if (!positive(blend)) fail(`non-positive target blend: ${e.id}`);
      const mixEn = workloadMix === 'lowCache' ? '85%/14.5%/0.5% low-cache mix' : '97%/2.5%/0.5% standard mix';
      const mixZh = workloadMix === 'lowCache' ? '85%/14.5%/0.5% 低缓存负载' : '97%/2.5%/0.5% 标准负载';
      if (c.anchorMode === 'worth-ratio') {
        const ar = c.anchorRates;
        if (!ar || !nonNeg(ar.cache) || !nonNeg(ar.input) || !nonNeg(ar.output) || Object.keys(ar).some(k=>!['cache','input','output'].includes(k))) fail(`anchor rates need review: ${e.id}`);
        const anchorBlend = mixSpec.cache * ar.cache + mixSpec.input * ar.input + mixSpec.output * ar.output;
        if (!positive(anchorBlend)) fail(`non-positive anchor blend: ${e.id}`);
        worth = (anchor.monthly_tokens / 1e6) * anchorBlend * c.planRatio;
        const monthlyMt = worth / blend;
        tokens = monthlyMt * 1e6; price = e.monthlyUsd / monthlyMt;
        en = `Conservative pool-derived quota estimate (not directly measured for this model or guaranteed). Anchored to ${c.anchorPointId} (${(anchor.monthly_tokens/1e8).toFixed(2)}×10⁸ tokens/mo × $${anchorBlend.toFixed(5)}/MTok × plan ratio ${c.planRatio} = $${worth.toFixed(2)}/mo API worth) divided by $${blend.toFixed(5)}/MTok under the ${mixEn}. ${e.note.en}`;
        zh = `保守合池折算估算额度（非本模型直接实测，亦非官方保证）。以 ${c.anchorPointId} 为锚点（月 ${(anchor.monthly_tokens/1e8).toFixed(2)} 亿 tokens × $${anchorBlend.toFixed(5)}/MTok × 套餐倍率 ${c.planRatio} = 月 $${worth.toFixed(2)} API 价值），按 ${mixZh}除以本模型参考价 $${blend.toFixed(5)}/MTok 折算。${e.note.zh}`;
      } else {
        tokens = anchor.monthly_tokens * c.planRatio;
        const monthlyMt = tokens / 1e6;
        worth = monthlyMt * blend;
        price = e.monthlyUsd / monthlyMt;
        const carryMixEn = workloadMix === 'lowCache' ? '85% cache reads, 14.5% fresh input, 0.5% output' : `97% cache reads, 2.5% ${usesWrite ? '30m cache writes' : 'fresh input'}, 0.5% output`;
        const carryMixZh = workloadMix === 'lowCache' ? '85% 缓存读、14.5% 新输入、0.5% 输出' : `97% 缓存读、2.5% ${usesWrite ? '30 分钟缓存写' : '新输入'}、0.5% 输出`;
        en = `Conservative token-carry quota estimate (not directly measured for this model or guaranteed). Carries over ${c.anchorPointId} (${(anchor.monthly_tokens/1e8).toFixed(2)}×10⁸ tokens/mo × plan ratio ${c.planRatio}) without assuming any extra allowance from API price cuts. Reference mix: ${carryMixEn} ($${blend.toFixed(5)}/MTok). ${e.note.en}`;
        zh = `保守沿用 token 量估算额度（非本模型直接实测，亦非官方保证）。沿用同系列锚点 ${c.anchorPointId}（月 ${(anchor.monthly_tokens/1e8).toFixed(2)} 亿 tokens × 套餐倍率 ${c.planRatio}），不额外计入降价红利。参考负载：${carryMixZh}（$${blend.toFixed(5)}/MTok）。${e.note.zh}`;
      }
      workload = workloadMix === 'lowCache' ? 'lowCache' : (usesWrite ? 'cacheWrite' : 'standard');
    } else if (c?.meter === 'direct-weekly') {
      if (!positive(c.weeklyWorthUsd) || c.monthWeeks !== 4 || !['standard','lowCache'].includes(c.workloadMix)) fail(`invalid calibration: ${e.id}`);
      if (Object.keys(c).some(k=>!['meter','weeklyWorthUsd','monthWeeks','workloadMix'].includes(k))) fail(`unreviewed calibration field: ${e.id}`);
      if (e.freshInputBilling !== undefined) fail(`invalid freshInputBilling: ${e.id}`);
      if (!rates || !nonNeg(rates.cache) || !nonNeg(rates.input) || !nonNeg(rates.output) || Object.keys(rates).some(k=>!['cache','input','output'].includes(k))) fail(`rates need review: ${e.id}`);
      const std = data.conventions?.standardTokenMix, low = data.conventions?.lowCacheTokenMix;
      if (c.workloadMix === 'lowCache' ? (low?.cache !== .85 || low.input !== .145 || low.output !== .005) : (std?.cache !== .97 || std.input !== .025 || std.output !== .005)) fail('normalization conventions changed');
      const mixSpec = c.workloadMix === 'lowCache' ? low : std;
      blend = mixSpec.cache * rates.cache + mixSpec.input * rates.input + mixSpec.output * rates.output;
      if (!positive(blend)) fail(`non-positive target blend: ${e.id}`);
      worth = c.weeklyWorthUsd * c.monthWeeks;
      const monthlyMt = worth / blend;
      tokens = monthlyMt * 1e6; price = e.monthlyUsd / monthlyMt; workload = c.workloadMix;
      const mixEn = c.workloadMix === 'lowCache' ? '85%/14.5%/0.5% low-cache mix' : '97%/2.5%/0.5% standard mix';
      const mixZh = c.workloadMix === 'lowCache' ? '85%/14.5%/0.5% 低缓存负载' : '97%/2.5%/0.5% 标准负载';
      en = `Sample-based weekly quota estimate, not an official or guaranteed allowance. Monthly normalized tokens = weekly API worth $${c.weeklyWorthUsd} × ${c.monthWeeks} weeks / $${blend.toFixed(5)}/MTok × 1,000,000 under the ${mixEn}. ${e.note.en}`;
      zh = `基于周度实测样本的推算额度，不是官方或保证额度。月标准 token = 周 API 等价 $${c.weeklyWorthUsd} × ${c.monthWeeks} 周 ÷ $${blend.toFixed(5)}/MTok × 1,000,000（${mixZh}）。${e.note.zh}`;
    } else {
      fail(`invalid calibration: ${e.id}`);
    }

    if (![worth,tokens,price].every(positive)) fail(`non-finite derived value: ${e.id}`);
    added.push({id:e.id,plan_id:e.planId,plan:e.name,plan_en:e.name,model:e.model,model_display:model.name,
      vendor:model.maker,channel:e.channel??model.maker,label:`${model.name} · ${e.name}`,billing:'subscription',
      price_origin:'maintained-estimate',quota_is_estimated:true,confidence:e.confidence,tier:'main',
      price_usd:e.monthlyUsd,original_price:e.monthlyUsd,currency:'USD',monthly_tokens:tokens,monthly_yi:tokens/1e8,
      real_usd_per_mtok:price,list_blended_usd_per_mtok:blend,list_price:{cached:rates.cache,input:rates.input,output:rates.output,currency:'USD'},
      workload,d:e.monthlyUsd/worth,unmetered:false,promo_until:e.promoUntil??null,
      data_date:e.sampleDate,data_date_kind:'derived',data_date_from:e.sampleFrom,
      source:e.sources[0].url,source_en:e.sources[0].url,note:zh,note_en:en,decision_note:zh,decision_note_en:en,
      evidence:[...e.sources.map(s=>({...s})),...manifest.evidenceFiles.map(f=>({label:f,url:`/data/evidence/subscription-estimates-${f}`}))]});
  }
  return {...data,points:[...data.points.filter(p=>!archiveIds.has(p.id)),...added],
    mappings:data.mappings.filter(m=>!archiveIds.has(m.point_id)),
    supersededPoints:[...(data.supersededPoints ?? []),...archives],
    subscriptionEstimatesUpdatedAt:manifest.checkedAt,
    subscriptionEstimateArchiveReviews:manifest.archivedPointIds.map(a=>({...a,reason:{...a.reason}}))};
}
