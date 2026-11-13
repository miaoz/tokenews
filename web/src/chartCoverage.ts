import type { Lang, Row, SiteData, State } from "./types";
import { groups } from "./domain";

export interface UnplottedRow {
  model: string | null;
  label: string;
  score: number | null;
  reason: string;
  preliminary: boolean;
}

export function missingReason(reason: string, lang: Lang): string {
  const labels: Record<string, [string, string]> = {
    "no-price-evidence": ["No reviewed price or quota matching this version", "尚无已核实、可匹配此版本的价格或额度"],
    "no-score-evidence": ["No verified score for this model on this leaderboard", "此榜单尚无该模型的已核实成绩"],
    "no-price-or-score-evidence": ["Catalog only: price and leaderboard score are not yet matched", "仅有型号资料，价格与榜单成绩尚未匹配"],
    "filtered-out": ["Outside the current model, plan or configuration filters", "不在当前模型、套餐或评测配置筛选范围内"],
    "identity-review-required": ["Source model identity needs review; other verified rows still update", "来源型号身份待审核，其他已核实记录仍正常更新"],
    "fallback-enabled": ["Cross-model fallback enabled; actual use unverified, so no single-model price match", "评测启用跨型号回退，实际是否触发未核实，暂不关联单模型价格"],
    "multi-model-fallback": ["Run used fallback models; no single-model price match", "运行使用了回退模型，不能对应单一模型价格"],
    router: ["Router; no single-model price", "路由代理，不能对应单一模型价格"],
    "ambiguous-configuration": ["Source configurations share an ambiguous label", "来源同名配置尚不能区分"],
    "unranked-autoeval": ["Day-1 AutoEval has no human-vote rank; not comparable to the ranked leaderboard", "Day-1 AutoEval 没有人工投票排名，不与正式排名混用"],
    "unverified-score": ["Score not verified", "分数尚未核实"],
  };
  return labels[reason]?.[lang === "zh" ? 1 : 0] ?? reason;
}

/** Global evidence gaps for this board, independent of the user's filters. */
export function unplottedRows(data: SiteData, board: string): UnplottedRow[] {
  const coverage = data.leaderboardCoverage?.[board];
  const rows: UnplottedRow[] = coverage ? [...coverage.unpriced, ...coverage.excluded] : [];
  for (const row of coverage?.excludedSourceRows ?? []) rows.push({model:null,label:row.label,score:null,reason:row.reason,preliminary:true});
  const explained = new Set(rows.flatMap(r => r.model ? [r.model] : []));
  const priced = new Set(data.points.map(p => p.model));
  // A dated reference can expire after the static coverage report was built.
  for (const config of data.configurations) {
    if (config.board !== board || priced.has(config.model) || explained.has(config.model)) continue;
    rows.push({ model: config.model, label: config.variant, score: config.score,
      reason: config.price_mapping_exclusion ?? "no-price-evidence", preliminary: !!config.score_is_preliminary });
    explained.add(config.model);
  }
  const mapped = new Set(data.mappings.filter(m => m.board === board).map(m => m.point_id));
  const scoredModels = new Set(data.points.filter(p => mapped.has(p.id)).map(p => p.model));
  for (const point of data.points) {
    if (explained.has(point.model) || scoredModels.has(point.model)) continue;
    rows.push({ model: point.model, label: data.models?.find(m => m.id === point.model)?.name ?? point.model_display,
      score: null, reason: "no-score-evidence", preliminary: false });
    explained.add(point.model);
  }
  return rows;
}

/** Search explains absent models too, not just the coordinates we can draw. */
export function unplottedSearch(data: SiteData, state: State, rows: Row[]): UnplottedRow[] {
  const tokens = state.find.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const matches = (r: UnplottedRow) => tokens.every(t => `${r.label} ${r.model ?? ""}`.toLocaleLowerCase().includes(t));
  const plotted = new Set(groups(rows).flatMap(g => g.rows.map(r => r.point.model)));
  const missing = unplottedRows(data, state.board).filter(r => !r.model || !plotted.has(r.model));
  const explained = new Set(missing.flatMap(r => r.model ? [r.model] : []));
  const priced = new Set(data.points.map(p => p.model));
  for (const model of data.models ?? []) {
    if (plotted.has(model.id) || explained.has(model.id)) continue;
    missing.push({ model: model.id, label: model.name, score: null, preliminary: false,
      reason: priced.has(model.id) ? "filtered-out" : "no-price-or-score-evidence" });
  }
  const unique = new Map<string, UnplottedRow>();
  for (const row of missing.filter(matches)) {
    const key = `${row.model ?? row.label}:${row.reason}`;
    const name = row.model && data.models?.find(m => m.id === row.model)?.name;
    if (!unique.has(key)) unique.set(key, { ...row, label: name || row.label });
  }
  return [...unique.values()];
}
