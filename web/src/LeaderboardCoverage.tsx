import type {SiteData, Lang} from './types';
import {modelPagePath} from './pageLinks';
import {useState} from 'react';
import {missingReason, unplottedRows} from './chartCoverage';

export default function LeaderboardCoverage({data, board, lang}: {data:SiteData;board:string;lang:Lang}) {
  const [query,setQuery]=useState('');
  const coverage=data.leaderboardCoverage?.[board];
  if(!coverage)return null;
  const zh=lang==='zh';
  const refresh=data.leaderboardRefresh?.[board];
  const allRows=unplottedRows(data,board);
  const tokens=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows=allRows.filter(r=>tokens.every(t=>`${r.label} ${r.model??''}`.toLowerCase().includes(t)));
  const reviewCount=coverage.excluded.filter(r=>r.reason==='identity-review-required').length;
  return <div className="chart-foot">
    {refresh&&refresh.status!=='updated'&&<p role="status">{zh
      ?`最近一次更新（${refresh.attemptedAt}）未成功；当前显示 ${refresh.checkedAt} 核实的数据。`
      :`The latest refresh (${refresh.attemptedAt}) did not succeed; showing data verified on ${refresh.checkedAt}.`}
      {refresh.error&&<span> {zh?'原因：':'Reason: '}{refresh.error}</span>}</p>}
    {reviewCount>0&&<p role="status">{zh?`${reviewCount} 个新配置的型号身份待审核，已核实配置已更新。`:`${reviewCount} new configurations need identity review; verified configurations have updated.`}</p>}
    <details className="unscored">
      <summary>{zh?`榜单覆盖与缺失原因：${coverage.observed} 个配置，${coverage.matchedConfigurations} 个可对应价格`:`Source coverage & missing models: ${coverage.observed} configurations, ${coverage.matchedConfigurations} with price references`}</summary>
      <p>{zh?'非前沿点仍会绘制，默认仅标注前沿名称。缺少价格、成绩或可比配置的模型不会强行补点。以下为整个榜单的证据缺口，不随个人筛选改变。':'Non-frontier points are still drawn; only frontier names are labeled by default. Missing prices, scores or comparable configurations are never inferred. The gaps below cover the whole leaderboard, independent of your filters.'}</p>
      <p>{zh?'仅按相同模型版本关联价格；评测代理、推理强度与订阅额度并未视为一致。价格仍保留各自采样日期。':'Prices reference the same model version. Agent harness, reasoning effort and subscription quota are not assumed equivalent. Prices retain their own sampling dates.'}</p>
      <p>{zh?'核对日期：':'Checked: '}{coverage.checkedAt}{coverage.sourceUpdatedAt?` · ${zh?'来源更新':'Source updated'}: ${coverage.sourceUpdatedAt.slice(0,10)}`:''}
        {coverage.retrievalMethod==='browser-public-source'?(zh?' · 浏览器读取公开结构化数据。':' · Public structured data retrieved through a browser.'):''}
      </p>
      <label className="coverage-search">{zh?'查找未绘制的模型':'Find a missing model'}<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={zh?'例如 Fable 5.2':'e.g. Fable 5.2'} /></label>
      {rows.length>0?<table>
        <thead><tr><th>{zh?'未绘制的配置':'Configurations not plotted'}</th><th>{zh?'成绩':'Score'}</th><th>{zh?'原因':'Reason'}</th></tr></thead>
        <tbody>{rows.slice(0,60).map((r,i)=><tr key={`${r.label}:${i}`}>
          <td>{r.model?<a href={modelPagePath(r.model,lang)}>{r.label}</a>:r.label}{r.preliminary?<small>{zh?' · 初步成绩':' · Preliminary'}</small>:null}</td>
          <td>{r.score===null?'—':r.score.toLocaleString(zh?'zh-CN':'en-US',{maximumFractionDigits:2})}</td>
          <td>{missingReason(r.reason,lang)}</td>
        </tr>)}</tbody>
      </table>:<p>{zh?'没有匹配的未绘制记录。模型也可能已绘制，可使用图表搜索定位。':'No matching missing record. The model may already be plotted; use chart search to locate it.'}</p>}
      {rows.length>60&&<p>{zh?`显示前 60 条，共 ${rows.length} 条；输入名称可缩小范围。`:`Showing 60 of ${rows.length}; search by name to narrow the list.`}</p>}
      <p><a href="/data/current-leaderboards.json">{zh?'下载完整来源快照':'Download complete source snapshots'}</a>{' · '}
        <a href="/data/leaderboard-refresh.json">{zh?'查看更新状态':'View refresh status'}</a></p>
    </details>
  </div>;
}
