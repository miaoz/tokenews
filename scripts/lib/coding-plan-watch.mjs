import {createHash} from 'node:crypto';
import {parse} from 'parse5';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const tidy = s => s.replace(/\s+/g,' ').trim();
const skip = new Set(['script','style','noscript','nav','footer','svg']);
const text = n => skip.has(n.tagName) ? '' : n.nodeName === '#text' ? n.value : (n.childNodes??[]).map(text).join(' ');
const descendants = (n, tag) => (n.childNodes??[]).flatMap(c=>[...(c.tagName===tag?[c]:[]),...descendants(c,tag)]);
const attr = (n,key) => n?.attrs?.find(a=>a.name===key)?.value;
const blockTags = new Set(['p','li','article','ul','ol','table','div','section','blockquote','pre']);
const hasBlockChild = n => (n.childNodes??[]).some(c=>blockTags.has(c.tagName)||hasBlockChild(c));
const terms = /model|pricing|credits?|quota|allowance|usage|tokens?|subscription|available|launch|introduc|released|updated|plan\b|free\b|discount|upgrad|checkpoint|权重|模型|额度|套餐|限额|价格|上线|优惠|计费/i;
const families = /(?:DeepSeek|Gemini|Kimi|MiniMax|GPT|Claude|GLM|Qwen|MiMo|Muse|Nemotron|Beam|Ling|Ornith|Crouton|Grok|Step|Mistral|SWE|Jev|Clef|Laguna|Glyph)[\w .:/-]{0,65}/gi;
export function signals(s) {
  const out=[];
  if(/upgrad|checkpoint|weights?|alias|101\d|版本|升级|权重/i.test(s))out.push('version');
  if(/\$|USD|CNY|credits?|quota|allowance|price|pricing|limit|off.peak|peak|额度|限额|价格|计费/i.test(s))out.push('pricing');
  if(/free|promo|discount|expires?|until|免费|优惠|到期/i.test(s))out.push('promotion');
  if(/model|available|launch|introduc|release|support|模型|上线/i.test(s))out.push('availability');
  return out;
}
export function validateSources(config) {
  if(config.version!==1||!config.sources?.length)throw Error('Invalid watch configuration');
  const ids=new Set();
  for(const s of config.sources){
    if(!/^[a-z0-9-]+$/.test(s.id)||ids.has(s.id)||!s.channel||!['tables','document','social'].includes(s.kind)||new URL(s.url).protocol!=='https:')throw Error(`Invalid watch source ${s.id}`);
    if(s.kind==='social'&&!/^[A-Za-z0-9_]+$/.test(s.account))throw Error('Invalid official account');
    if(s.kind!=='social'&&(!s.required?.length||!s.minRecords))throw Error('Missing source structure guard');
    ids.add(s.id);
  }
  return config;
}
// Normalize meaningful rows, not raw HTML: tracking IDs, script bundles and whitespace
// must not create changes. Unknown structures fail rather than becoming empty snapshots.
export function observePage(source, body, checkedAt) {
  if(typeof body!=='string'||body.length>12_000_000)throw Error('Invalid source response size');
  const markdown=source.url.endsWith('.md');
  const doc=markdown?null:parse(body);
  const plain=tidy(markdown?body:text(doc));
  if(/just a moment|verify you are human|access denied|cf-chl-|captcha/i.test(plain.slice(0,500))||source.required.some(s=>!plain.toLowerCase().includes(s.toLowerCase())))throw Error('Source content/structure guard failed');
  const records=[];let heading='';let tableNumber=0;
  const addBlock=(value,link)=>{
    const clean=tidy(value);if(!clean||(!terms.test(clean)&&!clean.match(families)&&!/[\$¥€£]\s*\d/.test(clean)))return;
    // Persist digests, detected signals and short model mentions, not article copies.
    const hash=digest(clean);records.push({key:`text:${hash}`,hash,type:'announcement',signals:signals(clean),models:[...new Set(clean.match(families)??[])].slice(0,8),url:link??source.url});
  };
  const addTable=rows=>{
    if(rows.length<2)return;
    const header=rows[0]; const section=`${tableNumber++}:${digest(header).slice(0,12)}`;
    const counts=new Map();
    for(const cells of rows.slice(1)){
      if(!cells.some(Boolean))continue;
      const first=cells[0]||'(unnamed)';const occurrence=counts.get(first)??0;counts.set(first,occurrence+1);
      const key=`row:${section}:${first}:${occurrence}`;
      records.push({key,type:'table-row',label:first,heading:heading.slice(0,150),columns:header,cells,hash:digest(cells),signals:signals(cells.join(' ')),url:source.url});
    }
  };
  if(markdown){
    const lines=body.split('\n');let rows=[];
    for(const line of [...lines,'']){
      if(/^\s*\|/.test(line)) {const cells=line.trim().replace(/^\||\|$/g,'').split('|').map(tidy);if(!cells.every(c=>/^[-: ]+$/.test(c)))rows.push(cells);continue;}
      if(rows.length){addTable(rows);rows=[];}
      if(/^#+ /.test(line))heading=line.replace(/^#+ /,'');
      addBlock(line);
    }
  }else{
    const walk=n=>{
      if(skip.has(n.tagName))return;
      if(/^h[1-6]$/.test(n.tagName??'')){heading=tidy(text(n));addBlock(heading);return;}
      if(n.tagName==='table') {addTable(descendants(n,'tr').map(r=>(r.childNodes??[]).filter(c=>['td','th'].includes(c.tagName)).map(c=>tidy(text(c)))));return;}
      if(['p','li','article','div'].includes(n.tagName)){
        if(!hasBlockChild(n)){const a=descendants(n,'a')[0];let link;try{const href=attr(a,'href');if(href)link=new URL(href,source.url).href;}catch{} addBlock(text(n),link);return;}
      }
      // Blog index entries often put the whole card inside an anchor.
      if(n.tagName==='a'&&source.kind==='document'&&/blog/.test(source.url)&&terms.test(text(n))){let link;try{link=new URL(attr(n,'href'),source.url).href;}catch{}addBlock(text(n),link);return;}
      for(const c of n.childNodes??[])walk(c);
    };walk(doc);
  }
  const unique=[...new Map(records.map(r=>[r.key,r])).values()];
  const count=source.kind==='tables'?unique.filter(r=>r.type==='table-row').length:unique.length;
  if(count<source.minRecords)throw Error(`Source structure changed: ${count} records, expected at least ${source.minRecords}`);
  return {checkedAt,bodySha256:digest(body),records:unique,hash:digest(unique.map(r=>[r.key,r.hash]).sort())};
}
export function observePost(source, raw, id) {
  const data=JSON.parse(raw);
  const author=new URL(data.author_url);
  if(!['x.com','twitter.com'].includes(author.hostname)||author.pathname.toLowerCase()!==`/${source.account.toLowerCase()}`)throw Error('Unverified announcement author');
  const post=new URL(data.url);
  if(!['x.com','twitter.com'].includes(post.hostname)||post.pathname.toLowerCase()!==`/${source.account.toLowerCase()}/status/${id}`)throw Error('Unverified announcement URL');
  const clean=tidy(text(parse(data.html)));
  return {key:`post:${id}`,type:'announcement',hash:digest(clean),signals:signals(clean),models:[...new Set(clean.match(families)??[])].slice(0,8),url:`https://x.com/${source.account}/status/${id}`,relevant:terms.test(clean)||Boolean(clean.match(families))};
}
export function discoverPostIds(body, account) {
  const re=new RegExp(`${account}/status/(\\d{15,25})`,'gi');
  return [...new Set([...body.matchAll(re)].map(m=>m[1]))].sort((a,b)=>BigInt(a)>BigInt(b)?-1:1).slice(0,12);
}
export function reconcileWatch(config, previous, results, resolutions, manifest, now) {
  validateSources(config);
  if(previous.version!==1||!previous.sources||!Array.isArray(previous.events)||!Array.isArray(resolutions))throw Error('Invalid watch state/reviews');
  const state=structuredClone(previous);state.checkedAt=now;
  const events=new Map(state.events.map(e=>[e.id,e]));
  const review=new Map(resolutions.map(r=>{
    if(!r.id||!['accepted','dismissed'].includes(r.status)||!r.reason?.trim()||!r.reviewedAt||!Number.isFinite(Date.parse(r.reviewedAt)))throw Error('Invalid watch resolution');
    return [r.id,r];
  }));
  if(results.length!==config.sources.length||new Set(results.map(r=>r.id)).size!==results.length)throw Error('Incomplete watch run');
  let newCount=0;
  const add=(source,kind,key,before,after)=>{
    const id=digest([source.id,kind,key,after?.hash??'removed',before?.hash??null]);
    if(!events.has(id)){events.set(id,{id,sourceId:source.id,channel:source.channel,kind,detectedAt:now,url:after?.url??source.url,before:before??null,after:after??null,status:'pending'});newCount++;}
  };
  for(const source of config.sources){
    const result=results.find(r=>r.id===source.id);if(!result)throw Error('Missing watch result');
    const old=state.sources[source.id];
    if(result.error){state.sources[source.id]={...old,id:source.id,channel:source.channel,url:source.url,kind:source.kind,attemptedAt:now,status:'failed',error:result.error.slice(0,500),consecutiveFailures:(old?.consecutiveFailures??0)+1};continue;}
    const obs=result.observation;
    if(!obs?.records?.length||!obs.hash)throw Error('Empty successful observation');
    if(old?.snapshot){
      const a=new Map(old.snapshot.records.map(r=>[r.key,r]));const b=new Map(obs.records.map(r=>[r.key,r]));
      // Large table loss usually means a bot page or partial render. Preserve last good data.
      const oldRows=[...a.values()].filter(r=>r.type==='table-row').length;
      const newRows=[...b.values()].filter(r=>r.type==='table-row').length;
      if(oldRows>5&&newRows<oldRows*.6){state.sources[source.id]={...old,attemptedAt:now,status:'failed',error:'Table coverage dropped by more than 40%; retaining last successful snapshot',consecutiveFailures:(old.consecutiveFailures??0)+1};continue;}
      for(const [key,row] of b){const prior=a.get(key);if(prior?.hash===row.hash)continue;
        if(row.type==='announcement'&&row.relevant===false)continue;
        add(source,row.type==='announcement'?'announcement':prior?'terms-changed':'model-or-plan-added',key,prior,row);
      }
      for(const [key,row] of a)if(!b.has(key)&&row.type==='table-row')add(source,'model-or-plan-removed',key,row,null);
    }
    state.sources[source.id]={id:source.id,channel:source.channel,url:source.url,kind:source.kind,attemptedAt:now,lastSuccessAt:now,status:old?.snapshot?'checked':'baseline',consecutiveFailures:0,retrieval:result.retrieval,snapshot:obs};
  }
  // Expiry itself is an event even if the provider never edits its page.
  for(const e of manifest.entries){if(!e.promoUntil)continue;const days=(Date.parse(e.promoUntil+'T23:59:59Z')-Date.parse(now))/86400000;
    if(days<=7){const source={id:'promotion-calendar',channel:manifest.plans.find(p=>p.id===e.plan).channel,url:e.source};const kind=days<0?'promotion-expired':'promotion-expiring';add(source,kind,e.id??`${e.plan}::${e.model}`,null,{hash:digest([e.id,e.promoUntil,kind]),label:e.model,expiresAt:e.promoUntil,url:e.source});}
  }
  state.events=[...events.values()].map(e=>review.has(e.id)?{...e,status:review.get(e.id).status,resolution:review.get(e.id)}:e);
  const statuses=config.sources.map(s=>state.sources[s.id]);
  const report={version:1,checkedAt:now,intervalHours:6,newEvents:newCount,pending:state.events.filter(e=>e.status==='pending'),resolvedCount:state.events.filter(e=>e.status!=='pending').length,sources:statuses.map(({snapshot,...s})=>({...s,recordCount:snapshot?.records.length??0})),failedSources:statuses.filter(s=>s.status==='failed').length};
  return {state,report};
}
