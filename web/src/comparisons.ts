import type { Configuration, Point } from "./types";

// Curated comparisons only. A data sync must still leave each pair with a
// comparable subscription and three shared leaderboard snapshots.
export const COMPARISON_PAIRS: readonly (readonly [string, string])[] = [
  ["claude-opus-5.5", "gpt-6-astra"],
  ["claude-opus-5.5", "claude-sonnet-5.5"],
  ["claude-opus-5.5", "claude-opus-5"],
  ["gpt-6-astra", "gpt-5.6-sol"],
  ["gpt-6-astra", "grok-4.7"],
  ["grok-4.7", "grok-4.6"],
  ["claude-sonnet-5.5", "glm-5.3"],
  ["kimi-k3", "glm-5.3"],
  ["kimi-k3", "deepseek-v4.1-flash"],
  ["glm-5.3", "deepseek-v4.1-flash"],
  ["glm-5.3", "minimax-m3"],
  ["deepseek-v4-pro", "qwen3.8-max"],
  ["glm-5.3", "glm-5.3-flash"],
  ["kimi-k3", "kimi-k2.7-code"],
];

type Side = "a" | "b";
export type PriceComparison = {
  side: Side | null;
  /** Higher price divided by lower price, independent of naming order. */
  ratio: number | null;
  reason: "comparable" | "unmetered" | "workload" | "raw" | "invalid";
};
const NORMALIZED_WORKLOADS = new Set(["standard", "anthropic", "lowCache"]);

/** Compare recorded token costs only when both use the same known workload.
 * Two `measured` records may describe different token mixes, even on one plan.
 * Unmetered access has no token denominator, so never yields a price ratio.
 */
export function compareTokenCosts(a: Point, b: Point): PriceComparison {
  const skip = (reason: PriceComparison["reason"]): PriceComparison => ({ side: null, ratio: null, reason });
  if (a.unmetered || b.unmetered) return skip("unmetered");
  if (![a.real_usd_per_mtok, b.real_usd_per_mtok].every((p) => Number.isFinite(p) && p > 0))
    return skip("invalid");
  if (!NORMALIZED_WORKLOADS.has(a.workload ?? "") || !NORMALIZED_WORKLOADS.has(b.workload ?? ""))
    return skip("raw");
  if (a.workload !== b.workload) return skip("workload");
  const ratio = a.real_usd_per_mtok / b.real_usd_per_mtok;
  // Ignore only floating-point noise from the source's rounded calculations.
  if (Math.abs(ratio - 1) <= 1e-6) return { side: null, ratio: 1, reason: "comparable" };
  return { side: ratio > 1 ? "b" : "a", ratio: ratio > 1 ? ratio : 1 / ratio, reason: "comparable" };
}

interface ComparisonModel {
  id: string;
  points: Point[];
  benchmarks: { board: string; best: Configuration }[];
}

/** Works with the static generator's model aggregates without copying data or
 * mixing leaderboard versions. Throws before publication if a pair gets thin.
 */
export function buildComparisons<T extends ComparisonModel>(
  models: ReadonlyMap<string, T>,
  pairs: readonly (readonly [string, string])[] = COMPARISON_PAIRS,
) {
  const seen = new Set<string>();
  return pairs.map(([ida, idb]) => {
    const key = [ida, idb].sort().join(" ");
    if (ida === idb || seen.has(key)) throw new Error(`Duplicate or self comparison: ${ida} vs ${idb}`);
    seen.add(key);
    const a = models.get(ida);
    const b = models.get(idb);
    if (!a || !b) throw new Error(`Comparison names a model not in the dataset: ${!a ? ida : idb}`);

    const subscriptions = (m: T) => m.points.filter((p) => p.billing === "subscription");
    const aa = subscriptions(a);
    const bb = subscriptions(b);
    const cheapest = (ps: Point[]) => ps.slice().sort((x, y) => x.real_usd_per_mtok - y.real_usd_per_mtok || x.id.localeCompare(y.id))[0];
    const plans = [...new Set(aa.map((p) => p.plan_id))]
      .filter((id) => bb.some((p) => p.plan_id === id))
      .map((id) => {
        const pa = cheapest(aa.filter((p) => p.plan_id === id));
        const pb = cheapest(bb.filter((p) => p.plan_id === id));
        if (pa.channel !== pb.channel || pa.price_usd == null || pb.price_usd == null ||
          !Number.isFinite(pa.price_usd) || pa.price_usd < 0 || pa.price_usd !== pb.price_usd)
          throw new Error(`Shared plan ${id} has inconsistent provider or monthly fees`);
        return { a: pa, b: pb, win: compareTokenCosts(pa, pb) };
      })
      .sort((x, y) => x.a.price_usd! - y.a.price_usd! || x.a.plan_id.localeCompare(y.a.plan_id));
    const boards = a.benchmarks.flatMap((x) => {
      const y = b.benchmarks.find((z) => z.board === x.board);
      if (!y) return [];
      if (![x.best.score, y.best.score].every(Number.isFinite)) throw new Error(`Invalid score on ${x.board}`);
      return [{
        board: x.board, a: x, b: y,
        win: { side: x.best.score === y.best.score ? null : x.best.score > y.best.score ? "a" as const : "b" as const, diff: Math.abs(x.best.score - y.best.score) },
      }];
    });
    const comparablePlans = plans.filter((p) => p.win.reason === "comparable");
    if (comparablePlans.length < 1 || boards.length < 3)
      throw new Error(`Comparison ${ida} vs ${idb} needs at least 1 comparable subscription and 3 common leaderboards; found ${comparablePlans.length} and ${boards.length}`);
    const count = (rows: { win: { side: Side | null } }[], side: Side) => rows.filter((r) => r.win.side === side).length;
    return {
      a, b, plans, boards, comparablePlans,
      plansWon: { a: count(comparablePlans, "a"), b: count(comparablePlans, "b") },
      boardsWon: { a: count(boards, "a"), b: count(boards, "b") },
    };
  });
}
