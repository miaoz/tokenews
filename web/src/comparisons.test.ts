import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildComparisons, compareTokenCosts } from "./comparisons";
import { comparePagePath } from "./pageLinks";
import type { Point, SiteData } from "./types";

const data: SiteData = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
const point = (overrides: Partial<Point> = {}): Point => ({
  ...data.points[0], id: "plan::a", plan_id: "plan", channel: "Provider", model: "a",
  billing: "subscription", price_usd: 20, real_usd_per_mtok: 1, monthly_tokens: 20_000_000,
  workload: "standard", unmetered: false, ...overrides,
});
const benchmarks = (model: string) => ["board-1", "board-2", "board-3"].map((board, i) => ({
  board, best: { ...data.configurations[0], board, model, score: model === "a" ? 10 + i : 12 - i },
}));
const models = (aa = [point()], bb = [point({ id: "plan::b", model: "b", real_usd_per_mtok: 2 })]) => new Map([
  ["a", { id: "a", points: aa, benchmarks: benchmarks("a") }],
  ["b", { id: "b", points: bb, benchmarks: benchmarks("b") }],
]);
const pair: readonly (readonly [string, string])[] = [["a", "b"]];

test("Comparison URLs are stable for both naming orders and both languages", () => {
  for (const lang of ["en", "zh"] as const) {
    const path = comparePagePath("gpt-6-astra", "claude-opus-5.5", lang);
    assert.equal(path, comparePagePath("claude-opus-5.5", "gpt-6-astra", lang));
    assert.equal(path, `${lang === "zh" ? "/zh" : ""}/compare/claude-opus-5-5-vs-gpt-6-astra/`);
  }
});

test("Matching normalized workloads yield symmetric price ratios and real ties", () => {
  const a = point();
  const b = point({ real_usd_per_mtok: 2 });
  assert.deepEqual(compareTokenCosts(a, b), { side: "a", ratio: 2, reason: "comparable" });
  assert.deepEqual(compareTokenCosts(b, a), { side: "b", ratio: 2, reason: "comparable" });
  assert.deepEqual(compareTokenCosts(a, a), { side: null, ratio: 1, reason: "comparable" });
  assert.equal(compareTokenCosts(a, point({ real_usd_per_mtok: 1.001 })).side, "a", "a small real difference must not be called equal");
});

test("Raw totals and mismatched normalized workloads never produce cost winners", () => {
  for (const workload of ["measured", "", undefined, "future-workload"]) {
    assert.deepEqual(compareTokenCosts(point({ workload }), point({ workload, real_usd_per_mtok: 2 })),
      { side: null, ratio: null, reason: "raw" });
  }
  assert.deepEqual(compareTokenCosts(point({ workload: "anthropic" }), point()),
    { side: null, ratio: null, reason: "workload" });
});

test("Unmetered and invalid prices do not become free or infinite-ratio wins", () => {
  const unlimited = point({ unmetered: true, real_usd_per_mtok: 0, monthly_tokens: null });
  assert.deepEqual(compareTokenCosts(unlimited, point()), { side: null, ratio: null, reason: "unmetered" });
  assert.equal(compareTokenCosts(unlimited, unlimited).side, null);
  for (const cost of [0, -1, NaN, Infinity]) {
    assert.deepEqual(compareTokenCosts(point({ real_usd_per_mtok: cost }), point()),
      { side: null, ratio: null, reason: "invalid" });
  }
});

test("Shared raw records stay visible but cannot inflate the lower-cost count or denominator", () => {
  const aa = [point(), point({ id: "raw::a", plan_id: "raw", workload: "measured", real_usd_per_mtok: 0.01 })];
  const bb = [point({ id: "plan::b", model: "b", real_usd_per_mtok: 2 }),
    point({ id: "raw::b", plan_id: "raw", model: "b", workload: "measured", real_usd_per_mtok: 3 })];
  const [c] = buildComparisons(models(aa, bb), pair);
  assert.equal(c.plans.length, 2);
  assert.equal(c.comparablePlans.length, 1);
  assert.deepEqual(c.plansWon, { a: 1, b: 0 });
  assert.deepEqual(c.boardsWon, { a: 1, b: 1 });
  assert.equal(c.boards[1].win.side, null, "a tied board is not a win for either model");
});

test("Metered APIs do not masquerade as monthly shared subscriptions", () => {
  const aa = [point(), point({ id: "api::a", plan_id: "api", billing: "metered", price_usd: null })];
  const bb = [point({ id: "plan::b", model: "b" }), point({ id: "api::b", model: "b", plan_id: "api", billing: "metered", price_usd: null })];
  assert.equal(buildComparisons(models(aa, bb), pair)[0].plans.length, 1);
  assert.throws(() => buildComparisons(models([aa[1]], [bb[1]]), pair), /1 comparable subscription/);
});

test("Unsupported pairs, duplicate orders and inconsistent plan fees stop publication", () => {
  assert.throws(() => buildComparisons(models(), [["a", "missing"]]), /not in the dataset/);
  assert.throws(() => buildComparisons(models(), [["a", "a"]]), /self comparison/);
  assert.throws(() => buildComparisons(models(), [["a", "b"], ["b", "a"]]), /Duplicate/);
  const sparse = models();
  sparse.get("b")!.benchmarks.pop();
  assert.throws(() => buildComparisons(sparse, pair), /3 common leaderboards/);
  assert.throws(() => buildComparisons(models([point({ workload: "measured" })]), pair), /1 comparable subscription/);
  assert.throws(() => buildComparisons(models(undefined, [point({ model: "b", price_usd: 40 })]), pair), /inconsistent provider or monthly fees/);
});
