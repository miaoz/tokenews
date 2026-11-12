import test from 'node:test';
import assert from 'node:assert/strict';
import {observePage,observePost,discoverPostIds,reconcileWatch,validateSources} from './coding-plan-watch.mjs';
const source={id:'plans',channel:'Channel',kind:'tables',url:'https://example.com/plans',required:['Model','Credits'],minRecords:1};
const config={version:1,sources:[source]};
const empty={version:1,sources:{},events:[]};
const manifest={entries:[],plans:[]};
const now='2026-11-04T12:00:00Z';
const html=(n=20,name='Model One')=>`<main><h2>Plans</h2><table><tr><th>Model</th><th>Credits</th></tr><tr><td>${name}</td><td>$${n}</td></tr></table><p>Monthly credits reset.</p></main>`;
const result=body=>[{id:'plans',observation:observePage(source,body,now),retrieval:'http'}];
const reconcile=(prev,rs,reviews=[],m=manifest,date=now)=>reconcileWatch(config,prev,rs,reviews,m,date);
test('Stable normalization ignores scripts, whitespace and navigation while detecting changed rates',()=>{
  const a=observePage(source,html(),now);
  const b=observePage(source,html().replace('$20','\n $20  ')+ '<script>random 42</script><nav>Model ignored</nav>',now);
  assert.equal(a.hash,b.hash);
  const initial=reconcile(empty,result(html()));assert.equal(initial.report.pending.length,0);
  const changed=reconcile(initial.state,result(html(40)));
  assert.equal(changed.report.pending.length,1);assert.equal(changed.report.pending[0].kind,'terms-changed');
  assert.deepEqual(changed.report.pending[0].before.cells,['Model One','$20']);
  assert.deepEqual(changed.report.pending[0].after.cells,['Model One','$40']);
});
test('New and removed endpoints remain pending across unchanged checks, failures and acknowledgements',()=>{
  const a=reconcile(empty,result(html()));const b=reconcile(a.state,result(html(20,'Model Two')));
  assert.deepEqual(b.report.pending.map(e=>e.kind).sort(),['model-or-plan-added','model-or-plan-removed']);
  const c=reconcile(b.state,result(html(20,'Model Two')));assert.equal(c.report.newEvents,0);assert.equal(c.report.pending.length,2);
  const failed=reconcile(c.state,[{id:'plans',error:'HTTP 403'}]);
  assert.equal(failed.report.pending.length,2);assert.deepEqual(failed.state.sources.plans.snapshot,c.state.sources.plans.snapshot);
  assert.equal(failed.state.sources.plans.lastSuccessAt,now);assert.equal(failed.report.failedSources,1);
  const ack={id:b.report.pending[0].id,status:'accepted',reason:'Updated reviewed mapping',reviewedAt:now};
  const reviewed=reconcile(failed.state,result(html(20,'Model Two')),[ack]);assert.equal(reviewed.report.pending.length,1);
  assert.throws(()=>reconcile(empty,result(html()),[{...ack,reason:''}]),/resolution/);
});
test('Same endpoint with a new version announcement is detected independently of table IDs',()=>{
  const s={...source,kind:'document',required:['Release']};const cfg={version:1,sources:[s]};
  const page=checkpoint=>`<h1>Release</h1><p>DeepSeek Flash updated to ${checkpoint}; no endpoint changes needed.</p>`;
  const r=text=>[{id:'plans',observation:observePage(s,text,now)}];
  const a=reconcileWatch(cfg,empty,r(page('1001')),[],manifest,now);
  const b=reconcileWatch(cfg,a.state,r(page('1017')),[],manifest,now);
  assert.equal(b.report.pending.length,1);assert.equal(b.report.pending[0].kind,'announcement');
  assert.ok(b.report.pending[0].after.signals.includes('version'));
});
test('HTTP-200 bot pages, empty tables and catastrophic coverage loss cannot erase a good snapshot',()=>{
  assert.throws(()=>observePage(source,'<p>Model Credits Verify you are human</p>',now),/guard/);
  assert.throws(()=>observePage(source,'<p>Model Credits</p>',now),/structure/);
  const body=n=>'<table><tr><th>Model</th><th>Credits</th></tr>'+Array.from({length:n},(_,i)=>`<tr><td>M${i}</td><td>$1</td></tr>`).join('')+'</table>';
  const a=reconcile(empty,result(body(10)));const b=reconcile(a.state,result(body(2)));
  assert.equal(b.report.failedSources,1);assert.equal(b.report.pending.length,0);
  assert.equal(b.state.sources.plans.snapshot.records.length,10);
});
test('Official post verification rejects forged authors/URLs and discovers only the configured account',()=>{
  const s={...source,kind:'social',account:'official'};const id='2112220734768779441';
  const post={url:`https://x.com/official/status/${id}`,author_url:'https://x.com/official',html:'<p>Model X upgraded to 1017.</p>'};
  assert.ok(observePost(s,JSON.stringify(post),id).signals.includes('version'));
  assert.throws(()=>observePost(s,JSON.stringify({...post,author_url:'https://x.com/imposter'}),id),/author/);
  assert.throws(()=>observePost(s,JSON.stringify({...post,url:`https://evil.com/official/status/${id}`}),id),/URL/);
  assert.deepEqual(discoverPostIds(`official/status/${id} other/status/2112220734768779442`,'official'),[id]);
});
test('Promotion expiry is queued independently of provider edits, and is not duplicated on repeated runs',()=>{
  const m={plans:[{id:'p',channel:'Channel'}],entries:[{id:'p::model',plan:'p',model:'model',source:source.url,promoUntil:'2026-11-10'}]};
  const a=reconcile(empty,result(html()),[],m);assert.equal(a.report.pending[0].kind,'promotion-expiring');
  const b=reconcile(a.state,result(html()),[],m);assert.equal(b.report.newEvents,0);
  const c=reconcile(b.state,result(html()),[],m,'2026-11-11T00:00:00Z');assert.ok(c.report.pending.some(e=>e.kind==='promotion-expired'));
});
test('Markdown tables, multipliers and rolling-limit prose are monitored together',()=>{
  const s={...source,url:'https://example.com/plans.md'};
  const o=observePage(s,'# Plans\n| Model | Credits |\n|---|---|\n| New 1017 | 0.12× |\n\nUsage: rolling weekly limits.\n',now);
  assert.equal(o.records.filter(r=>r.type==='table-row').length,1);
  assert.ok(o.records.some(r=>r.signals.includes('pricing')));
});
test('Nested document containers preserve tables and div-based release announcements',()=>{
  const nested=`<article><div><section>${html()}</section></div></article>`;
  assert.equal(observePage(source,nested,now).records.filter(r=>r.type==='table-row').length,1);
  const doc={...source,kind:'document',required:['Release']};
  const observation=observePage(doc,'<article><div><h1>Release</h1><div><span>DeepSeek upgraded to 1017.</span></div></div></article>',now);
  assert.ok(observation.records.some(r=>r.signals.includes('version')));
});
test('Model-only release headings and standalone subscription prices are observed',()=>{
  const doc={...source,kind:'document',required:['Gemini']};
  const a=observePage(doc,'<h2>Gemini 4</h2><div>$20</div>',now);
  const b=observePage(doc,'<h2>Gemini 4</h2><div>$40</div>',now);
  assert.equal(a.records.length,2);
  assert.notEqual(a.hash,b.hash);
});
test('A recurring price change cannot inherit the resolution of an earlier occurrence',()=>{
  const a=reconcile(empty,result(html(20)));
  const b=reconcile(a.state,result(html(40)));
  const review={id:b.report.pending[0].id,status:'accepted',reason:'Verified first rate increase',reviewedAt:now};
  const c=reconcile(b.state,result(html(20)),[review],manifest,'2026-11-05T12:00:00Z');
  const d=reconcile(c.state,result(html(40)),[review],manifest,'2026-11-06T12:00:00Z');
  assert.equal(d.report.newEvents,1);
  assert.equal(d.report.pending.length,2);
  assert.notEqual(d.report.pending.at(-1).id,review.id);
});

test('Document pagination can remove incidental tables without freezing new releases',()=>{
  const s={...source,kind:'document',required:['Release']};const cfg={version:1,sources:[s]};
  const table='<table><tr><th>Surface</th><th>Before</th></tr>'+Array.from({length:7},(_,i)=>`<tr><td>SDK ${i}</td><td>old</td></tr>`).join('')+'</table>';
  const a=reconcileWatch(cfg,empty,[{id:s.id,observation:observePage(s,`<h1>Release</h1>${table}`,now)}],[],manifest,now);
  const body='<h1>Release</h1><p>Copilot Auto model routing is now available.</p>';
  const b=reconcileWatch(cfg,a.state,[{id:s.id,observation:observePage(s,body,now)}],[],manifest,now);
  assert.equal(b.report.failedSources,0);
  assert.ok(b.report.pending.some(e=>e.kind==='announcement'&&e.after.signals.includes('availability')));
  assert.throws(()=>observePage({...s,minRecords:5},'<h1>Release</h1>',now),/structure/);
});

test('Core table guards allow removed promotions but reject partial pricing pages',()=>{
  const s={...source,minRecords:2,requiredTables:[{heading:'Plans',columns:['Model','Credits'],minRecords:1}]};
  const promo=id=>`<article id="${id}"><h3>Details</h3><table><tr><th>Token type</th><th>Price</th></tr><tr><td>Input</td><td>$0</td></tr></table></article>`;
  const page=html()+promo('glyph-free')+promo('beam-free')+promo('crouton-free');
  const cfg={version:1,sources:[s]},r=body=>[{id:s.id,observation:observePage(s,body,now)}];
  const a=reconcileWatch(cfg,empty,r(page),[],manifest,now);
  const b=reconcileWatch(cfg,a.state,r(html()+promo('glyph-free')),[],manifest,now);
  assert.equal(b.report.failedSources,0);
  assert.equal(b.report.pending.filter(e=>e.kind==='model-or-plan-removed').length,2);
  assert.throws(()=>observePage(s,'<p>Model Credits</p>'+promo('a')+promo('b'),now),/Required table/);
  assert.throws(()=>validateSources({version:1,sources:[{...s,requiredTables:[{heading:'Plans',columns:['Model'],minRecords:0}]}]}),/required table/);
});

test('Metadata column changes and column reordering do not hide real price changes',()=>{
  const s={...source,ignoredColumns:['Intelligence']},cfg={version:1,sources:[s]};
  const table=(score,price=20,reorder=false)=>`<h2>Plans</h2><table><tr><th>Model ↕</th>${score?'<th>Intelligence ↕</th>':''}${reorder?'<th>Context</th><th>Credits</th>':'<th>Credits</th><th>Context</th>'}</tr><tr><td>Kimi K3.1 Pro</td>${score?'<td>42.7</td>':''}${reorder?`<td>1M</td><td>$${price}</td>`:`<td>$${price}</td><td>1M</td>`}</tr></table>`;
  const r=body=>[{id:s.id,observation:observePage(s,body,now)}];
  const a=reconcileWatch(cfg,empty,r(table(true)),[],manifest,now);
  const b=reconcileWatch(cfg,a.state,r(table(false,20,true)),[],manifest,now);
  assert.equal(b.report.newEvents,0);
  const c=reconcileWatch(cfg,b.state,r(table(false,40,true)),[],manifest,now);
  assert.equal(c.report.newEvents,1);assert.equal(c.report.pending[0].kind,'terms-changed');
});

test('Anchored table identities survive inserted promotions and separate context bands',()=>{
  const band=(name,price)=>`<table><tr><th>${name}</th><th>Price</th></tr><tr><td>Input</td><td>$${price}</td></tr></table>`;
  const promo=(id,price)=>`<article id="${id}"><h3>Details</h3>${band('Tokens ≤512K',price)}${band('Tokens >512K',price*2)}</article>`;
  const page='<h1>Model Credits</h1>'+promo('old',1),next='<h1>Model Credits</h1>'+promo('new',3)+promo('old',1);
  const a=reconcile(empty,result(page)),b=reconcile(a.state,result(next));
  assert.equal(b.report.newEvents,2);assert.ok(b.report.pending.every(e=>e.kind==='model-or-plan-added'&&e.url.endsWith('#new')));
  const c=reconcile(b.state,result(next.replace('$2','$4')));
  assert.equal(c.report.newEvents,1);assert.equal(c.report.pending.at(-1).kind,'terms-changed');
});

test('Legacy keys migrate without replaying unchanged rows or dropping genuine pending events',()=>{
  const s={...source,ignoredColumns:['Intelligence']},cfg={version:1,sources:[s]};
  const old={...observePage(s,html(),now)};old.records=old.records.map((r,i)=>r.type==='table-row'?{...r,key:`row:0:old-header:${r.label}:0`,hash:'legacy-hash'}:r);
  const a=reconcileWatch(cfg,empty,[{id:s.id,observation:old}],[],manifest,now);
  a.state.events=[{id:'real-pending',status:'pending',sourceId:s.id,kind:'announcement'}];
  const b=reconcileWatch(cfg,a.state,result(html()),[],manifest,now);
  assert.equal(b.report.newEvents,0);assert.equal(b.report.pending[0].id,'real-pending');
  const c=reconcileWatch(cfg,a.state,result(html(40)),[],manifest,now);
  assert.equal(c.report.newEvents,1);assert.equal(c.report.pending.at(-1).kind,'terms-changed');
  assert.equal(c.report.pending[0].id,'real-pending');
});

test('Model names require word boundaries, including official social posts',()=>{
  const s={...source,kind:'document',required:['Notes']};
  const body='<h1>Notes</h1><p>Answered promptly instead of waiting.</p><p>A failing hook keeps the others.</p><p>Installing the app works.</p><p>Ling 3.1 Flash</p><p>SWE-1.5</p><h2>Qwen3.8-Max</h2>';
  const o=observePage(s,body,now);
  assert.equal(o.records.length,3);assert.ok(o.records.every(r=>r.models.length));
  assert.ok(o.records.some(r=>r.models.includes('Qwen3.8-Max')));
  const social={...s,kind:'social',account:'official'},id='2112220734768779441';
  const post={url:`https://x.com/official/status/${id}`,author_url:'https://x.com/official',html:'<p>A failing hook is answered promptly.</p>'};
  const p=observePost(social,JSON.stringify(post),id);assert.deepEqual(p.models,[]);assert.equal(p.relevant,false);
});
