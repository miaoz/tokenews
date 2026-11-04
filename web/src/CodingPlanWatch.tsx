import type {SiteData,Lang} from './types';

export default function CodingPlanWatch({data,lang,channel}:{data:SiteData;lang:Lang;channel?:string}) {
  const watch=data.codingPlanWatch;if(!watch)return null;
  const zh=lang==='zh';
  const sources=watch.sources.filter(s=>!channel||s.channel===channel);
  if(!sources.length)return null;
  const failed=sources.filter(s=>s.status==='failed');
  const pending=watch.pending.filter(e=>!channel||e.channel===channel);
  const staleHours=watch.intervalHours*3;
  const stale=Date.now()-Date.parse(watch.checkedAt)>staleHours*3600_000;
  const kinds:Record<string,string>=zh?{'terms-changed':'价格／额度表变化','model-or-plan-added':'新增型号／套餐条目','model-or-plan-removed':'型号／套餐条目移除','announcement':'公告／条款变化','promotion-expiring':'优惠即将到期','promotion-expired':'优惠已到期'}:{};
  return <div className="chart-foot">
    <details className="unscored">
      <summary>{zh?`公告与套餐定期核查：${pending.length} 项待核实，${failed.length} 个来源读取失败`:`Announcement & plan watch: ${pending.length} pending, ${failed.length} sources failed`}</summary>
      <p>{zh?`每 ${watch.intervalHours} 小时检查一次；最近检查：`:`Checks every ${watch.intervalHours} hours; last run: `}{watch.checkedAt.replace('T',' ').replace(/\.\d+Z$/,' UTC')}.</p>
      {stale&&<p role="status">{zh?`检查状态已超过 ${staleHours} 小时，定时任务可能延迟或失败。`:`Watch status is over ${staleHours} hours old; the scheduled job may be delayed or failing.`}</p>}
      <p>{zh?'自动发现新型号、别名升级、费率、额度及优惠变化；价格和评测映射仍采用已核实记录。待核查项会持续保留，直到附带理由确认处理；首次采集仅建立对比基线。':'Detects new models, alias upgrades, rates, quotas and promotions. Prices and benchmark mappings retain reviewed values. Pending changes persist until resolved with a reason; first collection only establishes a baseline.'}</p>
      {failed.length>0&&<ul>{failed.map(s=><li key={s.id}><a href={s.url}>{s.channel} · {s.id}</a> — {zh?'读取失败；上次成功：':'failed; last success: '}{s.lastSuccessAt??(zh?'尚无':'never')}</li>)}</ul>}
      {pending.length>0&&<table><thead><tr><th>{zh?'渠道':'Channel'}</th><th>{zh?'变化':'Change'}</th><th>{zh?'发现时间':'Detected'}</th></tr></thead><tbody>{pending.slice(0,15).map(e=><tr key={e.id}><td>{e.channel}</td><td><a href={e.url}>{kinds[e.kind]??e.kind}</a>{e.after?.label?` · ${e.after.label}`:''}</td><td>{e.detectedAt.slice(0,10)}</td></tr>)}</tbody></table>}
      <p><a href="/data/coding-plan-watch.json">{zh?'完整变更队列与来源状态':'Full change queue and source status'}</a>{' · '}<a href="https://github.com/miaoz/tokenews/actions/workflows/watch-coding-plans.yml">{zh?'定期任务运行记录':'Scheduled workflow runs'}</a></p>
    </details>
  </div>;
}
