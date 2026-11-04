import type {SiteData, Lang} from './types';
import {modelPagePath} from './pageLinks';

export default function LeaderboardCoverage({data, board, lang}: {data:SiteData;board:string;lang:Lang}) {
  const coverage=data.leaderboardCoverage?.[board];
  if(!coverage)return null;
  const zh=lang==='zh';
  const refresh=data.leaderboardRefresh?.[board];
  const reasons:Record<string,string>={
    'no-price-evidence':zh?'尚无该型号的价格／额度证据':'No price or quota evidence for this model',
    'router':zh?'路由代理，不能对应单一模型价格':'Router; no single-model price',
    'multi-model-fallback':zh?'包含回退模型，不能对应单一模型价格':'Uses model fallback; no single-model price',
    'ambiguous-configuration':zh?'来源同名配置尚不能区分':'Source configurations share an ambiguous label',
    'unverified-score':zh?'分数尚未核实':'Score not verified',
  };
  const rows=[...coverage.unpriced,...coverage.excluded];
  return <div className="chart-foot">
    {refresh&&refresh.status!=='updated'&&<p role="status">{zh
      ?`最近一次更新（${refresh.attemptedAt}）未成功；当前显示 ${refresh.checkedAt} 核实的数据。`
      :`The latest refresh (${refresh.attemptedAt}) did not succeed; showing data verified on ${refresh.checkedAt}.`}</p>}
    <details className="unscored">
      <summary>{zh?`榜单覆盖：${coverage.observed} 个配置，${coverage.matchedConfigurations} 个可对应价格`:`Source coverage: ${coverage.observed} configurations, ${coverage.matchedConfigurations} with price references`}</summary>
      <p>{zh?'仅按相同模型版本关联价格；评测代理、推理强度与订阅额度并未视为一致。价格仍保留各自采样日期。':'Prices reference the same model version. Agent harness, reasoning effort and subscription quota are not assumed equivalent. Prices retain their own sampling dates.'}</p>
      <p>{zh?'核对日期：':'Checked: '}{coverage.checkedAt}{coverage.sourceUpdatedAt?` · ${zh?'来源更新':'Source updated'}: ${coverage.sourceUpdatedAt.slice(0,10)}`:''}
        {coverage.retrievalMethod==='browser-public-source'?(zh?' · 浏览器读取公开结构化数据。':' · Public structured data retrieved through a browser.'):''}
      </p>
      {rows.length>0&&<table>
        <thead><tr><th>{zh?'未绘制的配置':'Configurations not plotted'}</th><th>{zh?'成绩':'Score'}</th><th>{zh?'原因':'Reason'}</th></tr></thead>
        <tbody>{rows.map((r,i)=><tr key={`${r.label}:${i}`}>
          <td>{r.model?<a href={modelPagePath(r.model,lang)}>{r.label}</a>:r.label}{r.preliminary?<small>{zh?' · 初步成绩':' · Preliminary'}</small>:null}</td>
          <td>{r.score===null?'—':r.score.toLocaleString(zh?'zh-CN':'en-US',{maximumFractionDigits:2})}</td>
          <td>{reasons[r.reason]??r.reason}</td>
        </tr>)}</tbody>
      </table>}
      <p><a href="/data/current-leaderboards.json">{zh?'下载完整来源快照':'Download complete source snapshots'}</a>{' · '}
        <a href="/data/leaderboard-refresh.json">{zh?'查看更新状态':'View refresh status'}</a></p>
    </details>
  </div>;
}
