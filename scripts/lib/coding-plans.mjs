// Reviewed subscription credits are independent of upstream quota samples.
// Preserve superseded samples for audit; never copy a quota to a new model.
export function mergeCodingPlans(data, manifest) {
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw Error('Invalid coding plan manifest');
  if (!manifest.evidenceFiles?.length || manifest.evidenceFiles.some(f=>!/^evidence-[0-9-]+\.json$/.test(f))) throw Error('Invalid plan evidence archive');
  const models = new Map(data.models.map(m => [m.id, m]));
  const plans = new Map(manifest.plans.map(p => [p.id, p]));
  if (plans.size !== manifest.plans.length) throw Error('Duplicate coding plan');
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
  const https = s => { try { return new URL(s).protocol === 'https:'; } catch { return false; } };
  const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const mix = data.conventions.standardTokenMix;
  if (mix.cache !== .97 || mix.input !== .025 || mix.output !== .005) throw Error('Coding plan workload needs review');
  for (const p of plans.values()) if (!p.note?.en || !p.note?.zh || !p.name || !p.channel) throw Error('Incomplete plan metadata');
  for (const r of manifest.reviews ?? []) if (!validDate(r.checkedAt) || !https(r.source) || !r.note?.en || !r.note?.zh || !r.models?.length || [...r.models, ...(r.relatedModels ?? [])].some(id=>!models.has(id))) throw Error('Invalid plan availability review');
  const replacements = new Set(), generated = [], ids = new Set();
  for (const e of manifest.entries) {
    const plan = plans.get(e.plan), model = models.get(e.model);
    if (!plan || !model || !positive(plan.monthlyUsd) || !validDate(e.checkedAt) ||
        !https(e.source) || !https(e.identitySource) || !e.endpoint || !e.identityNote?.en || !e.identityNote?.zh)
      throw Error(`Invalid coding plan provenance: ${e.model}`);
    if (!positive(e.monthlyCreditsUsd) || !['model', 'shared'].includes(plan.pool)) throw Error('Invalid credit pool');
    if (plan.sharedCreditsUsd != null && !positive(plan.sharedCreditsUsd)) throw Error('Invalid shared cap');
    if (plan.pool === 'shared' && !positive(plan.sharedCreditsUsd)) throw Error('Missing shared cap');
    for (const key of ['cache', 'input', 'output']) if (!(typeof e.rates[key] === 'number' && Number.isFinite(e.rates[key]) && e.rates[key] >= 0)) throw Error('Incomplete token rates');
    if (e.rates.cacheWrite != null && e.rates.cacheWrite !== e.rates.input) throw Error('Cache write billing needs review');
    const cost = mix.cache * e.rates.cache + mix.input * e.rates.input + mix.output * e.rates.output;
    if (!positive(cost)) throw Error('Free or unknown quota must not create a finite credit point');
    const credits = Math.min(e.monthlyCreditsUsd, plan.sharedCreditsUsd ?? Infinity);
    const tokens = credits / cost * 1e6;
    const id = e.id ?? `${plan.id}::${model.id}`;
    if (ids.has(id)) throw Error(`Duplicate coding plan point: ${id}`);
    ids.add(id);
    for (const oldId of e.replaces ?? []) {
      const old = data.points.find(p => p.id === oldId);
      if (!old || replacements.has(oldId)) throw Error(`Invalid superseded point: ${oldId}`);
      if (old.data_date > e.checkedAt) throw Error(`Newer upstream quota needs review: ${oldId}`);
      replacements.add(oldId);
    }
    const scope = e.scope ?? { en: '', zh: '' };
    const note = {
      zh: `套餐月费 $${plan.monthlyUsd}；模型月信用额度 $${e.monthlyCreditsUsd}${plan.sharedCreditsUsd ? `，套餐共享月池上限 $${plan.sharedCreditsUsd}` : ''}。本行按全部有效额度 $${credits} 用于该模型计算：月 token = 额度 ÷ 加权费率 × 1,000,000；真实单价 = 月费 ÷ 月 token × 1,000,000。97% 缓存读、2.5% 非缓存输入、0.5% 输出。同套餐各模型及各计费时段不可相加。${plan.note.zh} ${scope.zh} ${e.identityNote.zh}`,
      en: `Monthly fee $${plan.monthlyUsd}; model credits $${e.monthlyCreditsUsd}${plan.sharedCreditsUsd ? `, capped by the $${plan.sharedCreditsUsd} shared monthly pool` : ''}. Assumes all $${credits} of effective credits go to this model. Monthly tokens = credits / weighted rate * 1,000,000; real price = fee / tokens * 1,000,000. Mix: 97% cache reads, 2.5% fresh input, 0.5% output. Models and time bands within one plan are alternatives, not additive. ${plan.note.en} ${scope.en} ${e.identityNote.en}`,
    };
    if (e.rates.cacheWrite != null) {
      note.zh += ' 缓存写入与普通输入同价，互斥计费，不重复相加。';
      note.en += ' Cache writes and fresh input have equal rates and are mutually exclusive, not additive.';
    }
    const label = scope.en ? `${plan.name} · ${scope.en}` : plan.name;
    generated.push({ id, plan_id:plan.id, plan:label, plan_en:label, model:model.id, model_display:model.name,
      vendor:model.maker, channel:plan.channel, label:`${model.name} · ${label}`, billing:'subscription',
      price_origin:'maintained-plan', plan_gen:plan.generation ?? '', price_usd:plan.monthlyUsd,
      original_price:plan.monthlyUsd, currency:'USD', monthly_tokens:tokens, monthly_yi:tokens / 1e8,
      real_usd_per_mtok:plan.monthlyUsd / tokens * 1e6, list_blended_usd_per_mtok:cost,
      list_price:{cached:e.rates.cache,input:e.rates.input,output:e.rates.output,currency:'USD'},
      workload:'standard', d:plan.monthlyUsd / credits, confidence:'medium', tier:'main', unmetered:false,
      promo_until:e.promoUntil ?? null, data_date:e.checkedAt, data_date_kind:'official', source:e.source, source_en:e.source,
      note:note.zh, note_en:note.en, decision_note:note.zh, decision_note_en:note.en,
      evidence:[{label:'Plan pricing and limits',url:e.source},{label:'Served model identity',url:e.identitySource},
        {label:'Reviewed coding plan records',url:'/data/coding-plans.json'},
        ...manifest.evidenceFiles.map(f=>({label:'Archived official observations',url:`/data/evidence/coding-plans-${f}`}))] });
  }
  const supersededPoints = data.points.filter(p => replacements.has(p.id));
  const points = data.points.filter(p => !replacements.has(p.id));
  if (points.some(p => ids.has(p.id))) throw Error('Coding plan point would overwrite an unreviewed record');
  // Old Ollama session/weekly samples remain available, explicitly distinguished
  // from the current monthly-credit plans. The originals remain in the archive.
  const legacyIds = new Set(manifest.legacyPlanIds ?? []);
  const active = points.map(p => {
    if (!legacyIds.has(p.plan_id)) return p;
    supersededPoints.push(p);
    return {...p,plan:`${p.plan} (Legacy)`,plan_en:`${p.plan_en ?? p.plan} (Legacy)`,plan_gen:'legacy'};
  });
  return {...data,points:[...active,...generated],supersededPoints,
    codingPlanUpdatedAt:manifest.entries.map(e=>e.checkedAt).sort().at(-1),codingPlanReviews:manifest.reviews ?? []};
}
