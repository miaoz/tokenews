import test from 'node:test';
import assert from 'node:assert/strict';
import { flightText, parseAuditSource, compareAudit, resolveModel } from './leaderboard-audit.mjs';
const flight = value => `<script>self.__next_f.push(${JSON.stringify([1,value])})</script>`;
const aa = {initialModels:[{slug:'example-high',name:'Example (High)',deprecated:false,intelligenceIndex:42,scores:{'terminalbench-4-0':0.5}}],
  modelsAndReleases:{models:[{slug:'example-high',releaseSlug:'example'}],releases:[{slug:'example',name:'Example',releaseDate:'2026-10-20',creator:{name:'Maker'}}]},
  title:'Artificial Analysis Intelligence Index v5.0.1'};
const html = flight('1:'+JSON.stringify(aa));
test('reads JSON split between flight chunks without executing source scripts', () => {
  assert.equal(flightText(flight('1:{"ok":')+flight('true}')), '1:{"ok":true}');
  assert.throws(()=>flightText('<script>throw new Error("not JSON")</script>'));
});
test('AA audit uses release identity rather than reasoning configuration as a new model', () => {
  const parsed=parseAuditSource('aa-models',html);
  assert.equal(parsed.version,'5.0.1');
  assert.equal(parsed.rows[0].identity,'Example');
  assert.equal(parsed.rows[0].score,42);
  assert.equal(parseAuditSource('aa-terminal',html).rows[0].score,50);
  const upgraded=structuredClone(aa);upgraded.initialModels[0].scores['terminalbench-5-0']=0.4;
  const next=parseAuditSource('aa-terminal',flight('1:'+JSON.stringify(upgraded)));
  assert.equal(next.version,'5.0');assert.equal(next.rows[0].score,40);
  const noScore=structuredClone(aa);noScore.initialModels[0].intelligenceIndex=null;
  assert.throws(()=>parseAuditSource('aa-models',flight('1:'+JSON.stringify(noScore))));
});
test('empty or changed source shapes cannot be treated as unchanged', () => {
  for(const adapter of ['aa-models','aa-agents','terminal','design','arena']) assert.throws(()=>parseAuditSource(adapter,'<h1>Unavailable</h1>'));
  assert.throws(()=>parseAuditSource('deepswe','{"rows":[]}'));
});
test('strict identity matching keeps dated releases and preview variants separate', () => {
  const models=[{id:'deepseek-v4.1-flash',name:'DeepSeek V4.1 Flash'},{id:'minimax-m3.1-flash-preview',name:'MiniMax M3.1 Flash Preview'}];
  assert.equal(resolveModel('deepseek-v4-1-flash',models),'deepseek-v4.1-flash');
  assert.equal(resolveModel('DeepSeek V4.1 Flash 1017',models),null);
  assert.equal(resolveModel('MiniMax M3.1 Flash',models),null);
});
test('methodology changes suppress score comparisons; routers remain distinct', () => {
  const source={board:'aa',url:'https://example.com',baselineVersion:'4.3'};
  const parsed={version:'5.0.1',rows:[{identity:'Example',label:'Example',sourceId:'ex',score:30},{identity:'Example',label:'Router',router:true,sourceId:'router',score:50}]};
  const r=compareAudit(source,parsed,[{id:'example',name:'Example'}],[{board:'aa',model:'example',score:99,raw_record:{secondary:{slug:'ex'}}}]);
  assert.equal(r.versionChanged,true);
  assert.deepEqual(r.scoreDifferences,[]);
  assert.equal(r.rows[1].status,'router-review');
});
test('same-version scores and task costs are compared independently using exact source IDs', () => {
  const result=compareAudit({board:'deep',baselineVersion:'1.1'},{version:'1.1',rows:[{identity:'Example',label:'Example',sourceId:'ex',score:70,meanCost:4.4}]},[{id:'example',name:'Example'}],
    [{board:'deep',model:'example',score:70,mean_cost_usd_per_task:6.5,raw_record:{secondary:{config:'ex'}}}]);
  assert.equal(result.newConfigurations.length,0);
  assert.equal(result.scoreDifferences.length,0);
  assert.equal(result.costDifferences.length,1);
});
test('OpenDesign reads raw quality scores rather than weighted recommendation scores', () => {
  const parsed=parseAuditSource('design','<script type="application/json" id="model-rankings-weighted">[{"name":"Example","score":20}]</script><script type="application/json" id="model-rankings-data">[{"name":"Example","maker":"Maker","score":91}]</script>');
  assert.equal(parsed.version,null);
  assert.equal(parsed.rows[0].score,91);
});

test('AA enabled fallback is evidence distinct from observed fallback usage',()=>{
 const payload=structuredClone(aa);payload.initialModels[0].name='Example (High, Default Fallback)';
 const row=parseAuditSource('aa-models',flight('1:'+JSON.stringify(payload))).rows[0];
 assert.equal(row.fallbackEnabled,true);assert.equal(row.fallback,undefined);
 assert.match(row.label,/Default Fallback/);
});
test('AA agents accepts new shortName and legacy name without parsing harness labels as models',()=>{
 const variants=[{id:'new',model:{release:{shortName:'Example'},effort:{slug:'high'}},displayLabel:'Harness - Example (High, Default Fallback)',safety:{fallbackAttemptCount:0}},
 {id:'old',model:{release:{name:'Legacy'}},displayLabel:'Harness - Legacy',safety:{fallbackAttemptCount:2}},
 {id:'unknown',model:{release:{name:'Unknown usage'}},displayLabel:'Harness - Unknown usage (Default Fallback)'}];
 const body='<h1>Coding Agent Index v2.0</h1>'+flight('1:'+JSON.stringify(variants.map(r=>({...r,indexScore:.42,agentName:'Harness'}))));
 const rows=parseAuditSource('aa-agents',body).rows;
 assert.equal(rows[0].identity,'Example');assert.equal(rows[0].fallbackEnabled,true);assert.equal(rows[0].fallback,false);
 assert.equal(rows[1].identity,'Legacy');assert.equal(rows[1].fallback,true);
 assert.equal(rows[2].fallback,null);
});

test('TB 4.1 preserves official row metadata and states unknown regrade provenance',()=>{
 const row={id:'uuid',created_at:'2026-11-13T01:22:52Z',updated_at:'2026-11-13T02:00:00Z',rank:1,
 metadata:{date:'2026-11-09',model_display:{label:'Fable 5.2',url:'https://example.com/model'},agent_display:{label:'Claude Code'},reasoning_effort:'max'},
 metrics:{accuracy:65.76,accuracy_ci95_half_width:2.85,n_trials:330,successes:217}};
 const body=flight('1:'+JSON.stringify({state:{queries:[{state:{data:{leaderboard:{title:'Terminal-Bench 4.1',updated_at:'2026-11-13'},rows:[row]}}}]}}));
 const parsed=parseAuditSource('terminal',body);const r=parsed.rows[0];
 assert.equal(parsed.version,'4.1');assert.equal(r.sourceId,'uuid');assert.equal(r.modelReleaseDate,'2026-11-09');
 assert.equal(r.sourceCreatedAt,row.created_at);assert.equal(r.sourceUpdatedAt,row.updated_at);assert.equal(r.nTrials,330);assert.equal(r.nSuccesses,217);
 assert.equal(r.scoreProvenance,'not-disclosed-per-row');assert.match(r.recordNote.en,/not evidence of a fresh/);assert.match(r.recordNote.zh,/逐行来源未披露/);
 assert.deepEqual(parsed.recordNote,r.recordNote);assert.match(parsed.coverage,/retained 4.0/);assert.equal(r.regraded,undefined);assert.equal(r.runDate,undefined);
 const legacy=parseAuditSource('terminal',body.replace('Terminal-Bench 4.1','Terminal-Bench 4.0'));
 assert.equal(legacy.rows[0].scoreProvenance,undefined);
});

test('explicit source identity maps never infer same-label runs or unknown catalog IDs',()=>{
 const models=[{id:'reviewed',name:'Same name'},{id:'other',name:'Other'}];
 const source={board:'arena',url:'https://arena.ai',baselineVersion:null,identityBySourceId:{a:'reviewed',b:'other',invalid:'absent',router:'reviewed'}};
 const rows=['a','b','missing','invalid','router'].map(sourceId=>({sourceId,identity:'Same name',label:'Same name (High)',score:42,...(sourceId==='router'?{router:true}:{})}));
 const excludedSourceRows=[{sourceId:'autoeval',reason:'not-human-votes'}];
 const result=compareAudit(source,{version:null,rows,excludedSourceRows},models,[]);
 assert.deepEqual(result.rows.map(r=>r.model),['reviewed','other',null,null,null]);
 assert.equal(result.rows.at(-1).status,'router-review');
 assert.deepEqual(result.excludedSourceRows,excludedSourceRows);
 assert.equal(result.observedConfigurations,5);
 const empty=compareAudit({...source,identityBySourceId:{}},{version:null,rows:[rows[0]]},models,[]);
 assert.equal(empty.rows[0].model,null);
 const {identityBySourceId,...legacy}=source;
 assert.equal(compareAudit(legacy,{version:null,rows:[rows[0]]},models,[]).rows[0].model,'reviewed');
});
