// Static, crawlable pages for every model maker (厂商), every provider (供应商)
// with its plan tiers, and every model, in English and Chinese, plus the
// sitemap, llms.txt and the homepage structured data. Runs after `vite build`
// and writes into dist/. It reads the same validated public/data/site.json the
// explorer loads and formats it with the explorer's own helpers, so the pages
// never disagree with the "Behind the number" dialog.
import { readFile, readdir, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import {
  compareIndexPath,
  comparePagePath,
  explorerPath,
  makerPagePath,
  methodologyPath,
  modelPagePath,
  pageMaker,
  pageSlug as slug,
  planAnchor,
  planPagePath,
  providerPagePath,
} from "../src/pageLinks.ts";
import { BootSkeleton } from "../src/BootSkeleton.tsx";
import { REPO, SITE_NAME, SiteFooter, SiteHeader, TAGLINE } from "../src/SiteChrome.tsx";
import Method from "../src/Method.tsx";
import CodingPlanWatch from "../src/CodingPlanWatch.tsx";
import { ApiPriceDetails } from "../src/ApiPriceDetails.tsx";
import { apiPriceReference, apiPriceScope, formatApiAmount } from "../src/apiPrices.ts";
import { loadNews } from "./news.mjs";
import { buildComparisons } from "../src/comparisons.ts";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import {
  dataDateLine,
  displayPlan,
  effortLabel,
  firstUrl,
  listPriceLine,
  manufacturer,
  mappingNoteLabel,
  number,
  price,
  priceExact,
  referenceTags,
  safeUrl,
  unmeteredNote,
  variantLabel,
  workloadLine,
} from "../src/domain.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
// The data snapshot synced from upstream (scripts/sync-upstream.mjs); only the OG images are read from it here.
const repo = path.resolve(root, "../upstream");
const dist = path.join(root, "dist");
// The primary domain, used in canonical URLs, hreflang, Open Graph, the
// sitemap and llms.txt. Set SITE_URL to deploy a copy under another domain.
const DEFAULT_SITE = "https://tokenews.xyz";
const SITE = (process.env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, "");
if (!/^https:\/\/[^/]+$/.test(SITE)) throw new Error(`SITE_URL must be an https origin, got: ${SITE}`);
// One brand name in both languages, as for makers and providers.
const NAME = { en: SITE_NAME, zh: SITE_NAME };
const OG = {
  en: { path: "/og/pareto-en.png", src: "charts/en/pareto/pareto-aa-intelligence.png" },
  zh: { path: "/og/pareto-zh.png", src: "charts/zh/pareto/帕累托_AA智力榜.png" },
};

const data = JSON.parse(
  await readFile(path.join(root, "public/data/site.json"), "utf8"),
);
const updated = data.conventions.updatedAt || data.generatedAt;
const pageUpdates = new Map();
const pageFingerprints = new Map();
const hashFingerprint = (obj) => createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 12);
const latest = (...dates) => dates.filter(Boolean).sort().at(-1) ?? updated;
const isoDay = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const configDate = (c) =>
  isoDay(c.source_updated_at) ??
  isoDay(c.source_created_at) ??
  (data.boards[c.board]?.current
    ? (data.boards[c.board]?.snapshot !== data.boards[c.board]?.checkedAt ? isoDay(data.boards[c.board]?.snapshot) : null)
    : isoDay(c.checked_at));
// The explorer's hashed stylesheet carries the tokens, fonts, header and
// footer; the static pages load it first so all pages share one design.
const appCss = (await readFile(path.join(dist, "index.html"), "utf8")).match(
  /<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"/,
)?.[1];
if (!appCss) throw new Error("Explorer stylesheet not found in dist/index.html");
// Preload the Latin DM Sans file the stylesheet references, so text renders in
// the right font on first paint instead of swapping in later.
const latinFont = (await readdir(path.join(dist, "assets"))).find((f) =>
  /^dm-sans-latin-wght-normal-[\w-]+\.woff2$/.test(f),
);
if (!latinFont) throw new Error("DM Sans Latin font not found in dist/assets");
const FONT_PRELOAD = `<link rel="preload" href="/assets/${latinFont}" as="font" type="font/woff2" crossorigin />`;
// Static pages have no React. One inline script drives the shared theme
// toggle, opens a collapsed evidence block when a link targets it, and marks
// the section in view in an article's contents list.
const PAGE_SCRIPT = `<script>document.querySelector(".theme-toggle").addEventListener("click",function(){var d=document.documentElement,t=d.dataset.theme==="dark"?"light":"dark";d.dataset.theme=t;try{localStorage.setItem("pricing-theme",t)}catch(e){}});function openTarget(){var e=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1)));if(e&&e.tagName==="DETAILS"){e.open=true;e.scrollIntoView()}}addEventListener("hashchange",openTarget);openTarget();var toc=document.querySelectorAll(".toc a");if(toc.length){var hs=[].map.call(toc,function(a){return document.getElementById(a.hash.slice(1))}),spy=function(){var c=null;hs.forEach(function(h){if(h&&h.getBoundingClientRect().top<innerHeight*0.3)c=h});toc.forEach(function(a,i){a.setAttribute("aria-current",hs[i]===c)})};addEventListener("scroll",spy,{passive:true});spy()}</script>`;
const configById = new Map(data.configurations.map((c) => [c.configuration_id, c]));

// ---------------------------------------------------------------------------
// Makers and providers. Each is labelled by one name everywhere (the
// dataset's, as in the explorer). A maker's `zhName` is the Chinese company
// name, shown only on its own Chinese page and in metadata — never as a tag.
// ---------------------------------------------------------------------------
const MAKERS = {
  OpenAI: { url: "https://openai.com" },
  Anthropic: { url: "https://www.anthropic.com", alt: ["Claude"] },
  Google: { zhName: "谷歌", url: "https://ai.google.dev", alt: ["Gemini", "Google DeepMind"] },
  SpaceXAI: { url: "https://x.ai", alt: ["xAI", "Grok"] },
  Meta: { url: "https://ai.meta.com", alt: ["Muse"] },
  Alibaba: { zhName: "阿里巴巴", url: "https://qwen.ai", alt: ["Qwen", "通义千问", "Alibaba Cloud", "阿里云百炼"] },
  DeepSeek: { zhName: "深度求索", url: "https://www.deepseek.com" },
  Kimi: { zhName: "月之暗面", url: "https://www.kimi.com", alt: ["Moonshot AI"] },
  Zhipu: { zhName: "智谱", url: "https://z.ai", alt: ["Z.ai", "GLM"] },
  MiniMax: { zhName: "稀宇科技", url: "https://www.minimax.io" },
  Xiaomi: { zhName: "小米", url: "https://mimo.xiaomi.com", alt: ["MiMo"] },
  Tencent: { zhName: "腾讯", url: "https://hy.tencent.ai", alt: ["Hunyuan", "混元"] },
  StepFun: { zhName: "阶跃星辰", url: "https://www.stepfun.com" },
  Meituan: { zhName: "美团", url: "https://longcat.chat", alt: ["LongCat"] },
  LongCat: { url: "https://longcat.chat" },
  Mistral: { url: "https://mistral.ai", alt: ["Mistral AI"] },
  Cursor: { url: "https://cursor.com", alt: ["Anysphere"] },
  Cognition: { url: "https://cognition.ai", alt: ["Devin"] },
  NVIDIA: { zhName: "英伟达", url: "https://www.nvidia.com", alt: ["Nemotron"] },
  "Thinking Machines": { url: "https://thinkingmachines.ai" },
  "Thinking Machines Lab": { url: "https://thinkingmachines.ai" },
  inclusionAI: { url: "https://developer.ant-ling.com" },
  Other: {},
};
// Providers that are not also makers; the rest reuse the maker's site.
const PROVIDER_URLS = {
  OpenCode: "https://opencode.ai",
  "Command Code": "https://commandcode.ai",
  Ollama: "https://ollama.com",
  Factory: "https://factory.ai",
  Devin: "https://devin.ai",
  Cursor: "https://cursor.com",
  Baseten: "https://www.baseten.co",
  "Thinking Machines": "https://thinkingmachines.ai",
};

// ---------------------------------------------------------------------------
// Formatting. Numbers and dialog wording come from src/domain.ts; these add
// the page-only pieces.
// ---------------------------------------------------------------------------
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const fmt = (n, lang, digits = 3) => (n == null ? "—" : number(n, lang, digits));
const usd = (n) => (n == null ? "—" : price(n));
const tokens = (p, lang) =>
  p.monthly_yi == null
    ? "—"
    : lang === "zh"
      ? `${fmt(p.monthly_yi, lang)} 亿`
      : `${fmt(p.monthly_yi / 10, lang)}B`;
const fee = (p) =>
  p.price_usd == null ? null : usd(p.price_usd) + (p.local_price ? ` (${p.local_price})` : "");
const feeRange = (ps) => {
  const fees = [...new Set(ps.map((p) => p.price_usd).filter((x) => x != null))].sort((a, b) => a - b);
  if (!fees.length) return null;
  return fees.length === 1 ? usd(fees[0]) : `${usd(fees[0])}–${usd(fees.at(-1))}`;
};
// Search snippets show ~160 characters; cut cleanly without splitting words.
const clip = (s, lang) => {
  const max = 160;
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  if (lang === "zh") {
    if (/[A-Za-z0-9.$]/.test(s[max - 1]) && /[A-Za-z0-9.$]/.test(cut.at(-1) ?? ""))
      cut = cut.replace(/[A-Za-z0-9.$]+$/, "");
  } else {
    const space = cut.lastIndexOf(" ");
    if (space > 0) cut = cut.slice(0, space);
  }
  return cut.replace(/[\s,;:.，；。：（(、—–-]+$/, "") + "…";
};
const plural = (n, word, words = word + "s") => `${n} ${n === 1 ? word : words}`;
const unmetered = (p) => p.unmetered || p.real_usd_per_mtok === 0;
const planName = (p, lang) => {
  let plan = p.plan;
  if (plan.startsWith("GLM "))
    plan = plan.replaceAll("老客", "v2").replaceAll("新客", "v3");
  if (lang === "zh") return displayPlan(plan, lang);
  if (p.plan_en) return p.plan_en;
  const words = {
    "Kimi 会员 49": "Kimi Andante (CN)",
    "Kimi 会员 ": "Kimi CN CNY ",
    阿里云百炼: "Alibaba Cloud CN",
    新客: "New",
    老客: "Existing",
    闲时: "Off-peak",
    中间值: "Midpoint",
    忙时: "Peak",
    " 日间": " (Day)",
    " 夜间0.8×": " (Night 0.8x)",
    "促销至 ": "promo until ",
    "导入价至 ": "introductory price until ",
  };
  return Object.entries(words).reduce((s, [a, b]) => s.replaceAll(a, b), plan);
};
const familyName = (p) => {
  const tag = p.plan_gen ? ` (${p.plan_gen})` : "";
  return tag && p.model_display.endsWith(tag)
    ? p.model_display.slice(0, -tag.length)
    : p.model_display;
};
const listPrice = (lp) => {
  if (!lp) return null;
  const f = (n) => formatApiAmount(n, lp.currency);
  return { cached: f(lp.cached), input: f(lp.input), output: f(lp.output) };
};
const CONF = { high: ["High", "高"], medium: ["Medium", "中"], low: ["Low", "低"] };
const conf = (c, lang) => CONF[c]?.[lang === "zh" ? 1 : 0] ?? c;
const BOARD_ZH = {
  aa_intelligence_index: "AA 智力指数榜",
  terminal_bench_4: "Terminal-Bench 4.0 终端榜",
  aa_terminal_bench_4: "Terminal-Bench 4.0（AA）",
  arena_code: "Code Arena 网页开发榜",
  arena_agent_mode: "Agent Arena 榜",
  aa_coding_agent_index: "AA 编程 Agent 指数榜",
  open_design_arena: "OpenDesign 设计榜",
  deepswe_1_1: "DeepSWE v1.1",
};
const METRIC_ZH = {
  "Intelligence Index": "智力指数",
  "Resolution Rate %": "解决率 %",
  "Arena Score": "Arena 分数",
  "Net Improvement %": "净提升 %",
  "Coding Agent Index": "编程 Agent 指数",
  "Average task score": "平均任务分",
  "Pass@1 %": "Pass@1 %",
};
const boardName = (b, lang) =>
  lang === "zh" && BOARD_ZH[b] ? BOARD_ZH[b] + (data.boards[b].current === false ? `（历史快照 ${data.boards[b].snapshot}）` : "") : data.boards[b].name;
const metricName = (b, lang) => {
  const m = data.boards[b].metric;
  return lang === "zh" ? METRIC_ZH[m] ?? m : m;
};
const BOARD_ORDER = Object.keys(data.boards);
const evidenceId = (p) => `ev-${slug(p.id)}`;
/** First-party when the provider is the maker itself (domain.ts isThirdParty). */
const firstParty = (p) => p.channel === manufacturer(p.vendor);

// ---------------------------------------------------------------------------
// Aggregate models, makers and providers.
// ---------------------------------------------------------------------------
const mappingsByPoint = new Map();
for (const m of data.mappings) {
  if (!mappingsByPoint.has(m.point_id)) mappingsByPoint.set(m.point_id, []);
  // site.json packs mappings: fields equal to the configuration are omitted.
  mappingsByPoint.get(m.point_id).push({ ...configById.get(m.configuration_id), ...m });
}
const byPrice = (a, b) =>
  a.real_usd_per_mtok - b.real_usd_per_mtok || (a.price_usd ?? 0) - (b.price_usd ?? 0);

const models = new Map(data.models.map(m => [m.id, { ...m, slug: slug(m.id), points: [], configs: new Map() }]));
for (const p of data.points) {
  let m = models.get(p.model);
  if (!m) {
    m = { id: p.model, slug: slug(p.model), name: familyName(p), maker: pageMaker(p), points: [], configs: new Map() };
    models.set(p.model, m);
  }
  // Names and maker identity come from the independent model catalog.
  m.points.push(p);
  for (const map of mappingsByPoint.get(p.id) ?? [])
    m.configs.set(map.configuration_id, configById.get(map.configuration_id));
}
for (const c of data.configurations)
  if (models.has(c.model)) models.get(c.model).configs.set(c.configuration_id, c);

// Board ranks among every model the board archives (not just priced ones).
const boardBest = new Map();
for (const c of data.configurations) {
  const best = boardBest.get(c.board) ?? new Map();
  if (!best.has(c.model) || best.get(c.model) < c.score) best.set(c.model, c.score);
  boardBest.set(c.board, best);
}

for (const m of models.values()) {
  m.points.sort(byPrice);
  m.priced = m.points.filter((p) => !unmetered(p));
  m.free = m.points.filter(unmetered);
  m.cheapest = m.priced[0] ?? null;
  m.api = m.points.filter((p) => p.billing === "metered").sort(byPrice);
  m.subs = m.points.filter((p) => p.billing !== "metered");
  m.listPoint = m.api.find((p) => p.list_price) ?? m.points.find((p) => p.list_price) ?? null;
  m.apiReference = apiPriceReference(data, m.id);
  m.listBlended = m.apiReference?.blended ?? null;
  m.mostTokens = [...m.subs].filter((p) => p.monthly_yi != null).sort((a, b) => b.monthly_yi - a.monthly_yi)[0] ?? null;
  m.channels = [...new Set(m.points.map((p) => p.channel))].sort();
  m.benchmarks = BOARD_ORDER.flatMap((board) => {
    const configs = [...m.configs.values()].filter((c) => c.board === board).sort((a, b) => b.score - a.score);
    if (!configs.length) return [];
    const best = configs[0];
    const ranking = [...boardBest.get(board).entries()].sort((a, b) => b[1] - a[1]);
    const rank = ranking.findIndex(([, s]) => s <= best.score) + 1;
    return [{ board, best, configs, rank: best.source_rank ?? rank, of: best.source_total ?? ranking.length, sourceRank: best.source_rank != null }];
  });
  m.mappingNotes = [...new Set(m.points.flatMap((p) => (mappingsByPoint.get(p.id) ?? []).map((x) => x.mapping_note)))];
}

const renderDatePart = (s) => (/^\d{4}-\d{2}(?:-\d{2})?$/.test(s) ? `<time datetime="${esc(s)}">${esc(s)}</time>` : esc(s));
const renderDate = (s) => {
  if (!s) return "—";
  const str = String(s).trim();
  if (!str) return "—";
  return str.includes("~") ? str.split("~").map((part) => renderDatePart(part.trim())).join("~") : renderDatePart(str);
};
const temporalCoverage = (...rawDates) => {
  const iso = rawDates
    .flatMap((d) => (typeof d === "string" ? d.split("~") : []))
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}(?:-\d{2})?$/.test(s))
    .sort();
  if (!iso.length) return null;
  const first = iso[0];
  const last = iso.at(-1);
  return first === last ? first : `${first}/${last}`;
};
const tierIdRank = (id) =>
  !id.includes("_estimate") && !id.startsWith("official-api:")
    ? 0
    : !id.includes("_estimate")
      ? 1
      : !id.startsWith("official-api:")
        ? 2
        : 3;
const comparePlanIds = (a, b) => tierIdRank(a) - tierIdRank(b) || a.length - b.length || a.localeCompare(b);
const planGroupKey = (p) => `${p.billing}::${planName(p, "en")}::${p.price_usd ?? ""}`;
const makerPlanKey = (p) => `${p.channel}::${planGroupKey(p)}`;

const makers = new Map();
for (const m of models.values()) {
  if (!makers.has(m.maker))
    makers.set(m.maker, { name: m.maker, models: [], ...MAKERS[m.maker] });
  makers.get(m.maker).models.push(m);
}
for (const v of makers.values()) {
  v.models.sort((a, b) => (a.cheapest?.real_usd_per_mtok ?? Infinity) - (b.cheapest?.real_usd_per_mtok ?? Infinity) || a.name.localeCompare(b.name));
  v.points = v.models.flatMap((m) => m.points);
  const planGroups = new Map();
  for (const p of v.points) {
    const k = makerPlanKey(p);
    if (!planGroups.has(k)) planGroups.set(k, []);
    planGroups.get(k).push(p);
  }
  v.plans = [...planGroups.values()].map((pts) =>
    pts.slice().sort((a, b) => comparePlanIds(a.plan_id, b.plan_id))[0],
  );
  v.channels = [...new Set(v.points.map((p) => p.channel))].sort();
}

// A provider sells access; its plan tiers (deduplicated by billing, name and
// fee, keeping alias anchors for merged _estimate / split plan_ids) serve models.
const providers = new Map();
for (const p of data.points) {
  let pr = providers.get(p.channel);
  if (!pr) {
    pr = { name: p.channel, url: PROVIDER_URLS[p.channel] ?? MAKERS[p.channel]?.url, points: [], tiers: new Map() };
    providers.set(p.channel, pr);
  }
  pr.points.push(p);
  const k = planGroupKey(p);
  if (!pr.tiers.has(k)) pr.tiers.set(k, { id: p.plan_id, aliasIds: [], points: [] });
  pr.tiers.get(k).points.push(p);
}
for (const pr of providers.values()) {
  for (const tier of pr.tiers.values()) {
    const planIds = [...new Set(tier.points.map((p) => p.plan_id))].sort(comparePlanIds);
    tier.id = planIds[0];
    tier.aliasIds = planIds.slice(1);
    tier.points.sort(byPrice);
    tier.billing = tier.points[0].billing;
    tier.feePoint = tier.points[0];
    tier.cheapest = tier.points.find((p) => !unmetered(p)) ?? null;
    // A tier can carry several pools ("Cursor Ultra (Standard)"); its name is
    // the shortest, and each row shows its own pool name when it differs.
    tier.name = (lang) =>
      tier.points.map((p) => planName(p, lang)).sort((a, b) => a.length - b.length)[0];
  }
  pr.tierList = [...pr.tiers.values()].sort(
    (a, b) => (a.billing === "metered") - (b.billing === "metered") || (a.feePoint.price_usd ?? 0) - (b.feePoint.price_usd ?? 0) || a.name("en").localeCompare(b.name("en")),
  );
  pr.models = [...new Set(pr.points.map((p) => p.model))].map((id) => models.get(id));
  pr.makers = [...new Set(pr.models.map((m) => m.maker))].sort().map((n) => makers.get(n));
  pr.cheapest = [...pr.points].filter((p) => !unmetered(p)).sort(byPrice)[0] ?? null;
  const own = pr.points.filter(firstParty).length;
  pr.kind = own === pr.points.length ? "official" : own === 0 ? "reseller" : "mixed";
}

for (const [kind, names] of [
  ["model", [...models.values()].map((m) => m.slug)],
  ["maker", [...makers.keys()].map(slug)],
  ["provider", [...providers.keys()].map(slug)],
]) {
  const seen = new Set();
  for (const s of names) {
    if (seen.has(s)) throw new Error(`Duplicate ${kind} page slug: ${s}`);
    seen.add(s);
  }
}

const makerList = [...makers.values()].sort(
  (a, b) => (a.name === "Other") - (b.name === "Other") || b.points.length - a.points.length || a.name.localeCompare(b.name),
);
const providerList = [...providers.values()].sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));
const modelList = [...models.values()].sort((a, b) => a.maker.localeCompare(b.maker) || a.name.localeCompare(b.name));
const makerLabel = (v, lang) => (v.name !== "Other" ? v.name : lang === "zh" ? "其他厂商" : "Other makers");

const comparisons = buildComparisons(models);
const comparisonsOf = (m) => comparisons.filter((c) => c.a === m || c.b === m);

// News (content/news/*.md, English only). NEWS_DRAFTS=1 includes drafts for a local preview.
const news = await loadNews({
  dir: path.resolve(root, "../content/news"),
  models,
  makers,
  providers,
  drafts: process.env.NEWS_DRAFTS === "1",
});
const newsFor = {
  model: (m) => news.filter((a) => a.models.includes(m.id)),
  // A maker's news includes articles about any of its models.
  maker: (v) => news.filter((a) => a.makers.includes(v.name) || a.models.some((id) => models.get(id).maker === v.name)),
  provider: (pr) => news.filter((a) => a.providers.includes(pr.name)),
};
for (const m of models.values()) {
  m.modified = latest(
    isoDay(m.checkedAt),
    isoDay(m.apiReference?.checkedAt),
    ...m.points.map((p) => isoDay(p.data_date)),
    ...[...m.configs.values()].map(configDate),
    ...newsFor.model(m).map((a) => isoDay(a.updated)),
  );
}
const siteUpdated = latest(
  updated,
  data.apiPrices?.updatedAt,
  data.catalogUpdatedAt,
  data.codingPlanUpdatedAt,
  data.subscriptionEstimatesUpdatedAt,
  news[0]?.updated,
  ...modelList.map((m) => m.modified),
);
const kindLabel = (pr, lang) =>
  ({
    official: ["Official (own models only)", "官方（仅自家模型）"],
    reseller: ["Third-party (other makers' models)", "第三方（其他厂商的模型）"],
    mixed: ["Own and other makers' models", "自家与其他厂商的模型"],
  })[pr.kind][lang === "zh" ? 1 : 0];

// ---------------------------------------------------------------------------
// URLs.
// ---------------------------------------------------------------------------
const prefix = (lang) => (lang === "zh" ? "/zh" : "");
const U = {
  home: (lang) => explorerPath(lang),
  makers: (lang) => `${prefix(lang)}/makers/`,
  maker: (v, lang) => makerPagePath(v.name, lang),
  providers: (lang) => `${prefix(lang)}/providers/`,
  provider: (pr, lang) => providerPagePath(pr.name, lang),
  plan: (p, lang) => planPagePath(p.channel, p.plan_id, lang),
  models: (lang) => `${prefix(lang)}/models/`,
  model: (m, lang) => modelPagePath(m.id, lang),
  evidence: (p, lang) => `${modelPagePath(p.model, lang)}#${evidenceId(p)}`,
  compares: (lang) => compareIndexPath(lang),
  compare: (c, lang) => comparePagePath(c.a.id, c.b.id, lang),
  news: () => "/news/",
  article: (a) => `/news/${a.slug}/`,
  feed: () => "/news/feed.xml",
  explorer: (lang, extra = "") => explorerPath(lang, extra.replace(/^&/, "")),
  method: (lang) => methodologyPath(lang),
};
const abs = (p) => SITE + p;
const link = (href, text, ariaLabel) => `<a href="${href}"${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ""}>${esc(text)}</a>`;
const ext = (href, text, ariaLabel) => `<a href="${esc(href)}" rel="nofollow noopener" target="_blank"${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ""}>${esc(text)}</a>`;
// "See all" links that close a section: a quiet pill with a moving arrow.
const moreLink = (href, text) => `<p class="more"><a class="more-link" href="${href}">${esc(text)}<span class="arrow" aria-hidden="true">→</span></a></p>`;
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const makerLink = (v, lang) => link(U.maker(v, lang), makerLabel(v, lang));
const providerLink = (name, lang) => link(providerPagePath(name, lang), name);
const modelLink = (m, lang) => link(U.model(m, lang), m.name);
const compareName = (c) => `${c.a.name} vs ${c.b.name}`;
const compareLink = (c, lang) => link(U.compare(c, lang), compareName(c));
const join = (items, lang) => items.join(lang === "zh" ? "、" : ", ");

// ---------------------------------------------------------------------------
// Page shell: full metadata on every page.
// ---------------------------------------------------------------------------
const jsonLd = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj).replaceAll("<", "\\u003c")}</script>`;
const PUBLISHER = {
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: SITE_NAME,
  description: TAGLINE.en,
  url: `${SITE}/`,
  logo: { "@type": "ImageObject", url: `${SITE}/og/logo.png`, width: 512, height: 512 },
  sameAs: [REPO, "https://github.com/miaoz/tokenews"],
};
const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE}/#website`,
  name: SITE_NAME,
  description: TAGLINE.en,
  url: `${SITE}/`,
  inLanguage: ["en", "zh-CN"],
  publisher: { "@id": `${SITE}/#organization` },
};
const breadcrumbs = (items) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, url], i) => ({
    "@type": "ListItem",
    position: i + 1,
    name,
    item: abs(url),
  })),
});
// `alt` is the same page in the other language, or null for English-only
// pages (news). `byline` replaces the data-updated line under the lead;
// `published` and `tags` add article metadata; `image` ({url, width, height,
// type, alt}) replaces the default Pareto chart as the social image.
// `bare` pages render their own heading block after the breadcrumb.
function page({ lang, section, path: urlPath, alt, title, description, keywords, h1, kicker, lead, body, crumbs, graph, ogType = "website", byline, published, tags = [], image, bare = false, fingerprint }) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const url = abs(urlPath);
  pageUpdates.set(urlPath, graph.modified ?? updated);
  if (fingerprint !== undefined) pageFingerprints.set(urlPath, hashFingerprint(fingerprint));
  const og = image ?? {
    url: abs(OG[lang].path),
    width: 2880,
    height: 1928,
    type: "image/png",
    alt: t("Price–capability Pareto chart of AI subscriptions", "AI 订阅价格–能力帕累托图"),
  };
  const fullTitle = `${title} | ${NAME[lang]}`;
  const dedupedKeywords = [...new Set(keywords.filter(Boolean))];
  const speakableSelectors = [
    "h1",
    ...(!bare ? [".lead"] : []),
    ...(body.includes('class="answer"') ? [".answer"] : []),
  ];
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      PUBLISHER,
      WEBSITE,
      {
        "@type": ogType === "article" ? "WebPage" : "CollectionPage",
        "@id": `${url}#webpage`,
        url,
        name: title,
        headline: h1,
        description,
        inLanguage: zh ? "zh-CN" : "en",
        isPartOf: { "@id": `${SITE}/#website` },
        publisher: { "@id": `${SITE}/#organization` },
        dateModified: graph.modified ?? updated,
        primaryImageOfPage: { "@type": "ImageObject", url: og.url, ...(og.width ? { width: og.width, height: og.height } : {}) },
        breadcrumb: { "@id": `${url}#breadcrumb` },
        speakable: { "@type": "SpeakableSpecification", cssSelector: speakableSelectors },
        ...(graph.about ? { about: graph.about } : {}),
        ...(graph.mainEntity ? { mainEntity: graph.mainEntity } : {}),
      },
      { "@id": `${url}#breadcrumb`, ...breadcrumbs(crumbs) },
      ...(graph.extra ?? []),
    ],
  };
  return `<!doctype html>
<html lang="${zh ? "zh-CN" : "en"}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="keywords" content="${esc(dedupedKeywords.join(", "))}" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<meta name="author" content="${NAME[lang]}" />
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" content="#f5f3ed" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0f1113" media="(prefers-color-scheme: dark)" />
<link rel="canonical" href="${url}" />
<link rel="alternate" type="text/markdown" href="${urlPath}index.md" title="Markdown" />
${
  alt
    ? `<link rel="alternate" hreflang="${zh ? "zh-CN" : "en"}" href="${url}" />
<link rel="alternate" hreflang="${zh ? "en" : "zh-CN"}" href="${abs(alt)}" />
<link rel="alternate" hreflang="x-default" href="${abs(zh ? alt : urlPath)}" />`
    : `<link rel="alternate" hreflang="${zh ? "zh-CN" : "en"}" href="${url}" />
<link rel="alternate" hreflang="x-default" href="${url}" />`
}
${news.length ? `<link rel="alternate" type="application/rss+xml" title="${SITE_NAME} news" href="${abs(U.feed())}" />\n` : ""}
<link rel="alternate" type="text/plain" title="llms.txt" href="${SITE}/llms.txt" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
${FONT_PRELOAD}
<link rel="stylesheet" href="${appCss}" />
<link rel="stylesheet" href="/pages.css" />
<meta property="og:type" content="${ogType}" />
<meta property="og:site_name" content="${NAME[lang]}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:locale" content="${zh ? "zh_CN" : "en_US"}" />
${alt ? `<meta property="og:locale:alternate" content="${zh ? "en_US" : "zh_CN"}" />\n` : ""}
<meta property="og:image" content="${esc(og.url)}" />
${og.type ? `<meta property="og:image:type" content="${og.type}" />\n` : ""}${og.width ? `<meta property="og:image:width" content="${og.width}" />\n<meta property="og:image:height" content="${og.height}" />\n` : ""}<meta property="og:image:alt" content="${esc(og.alt)}" />
${published ? `<meta property="article:published_time" content="${published}" />\n` : ""}${ogType === "article" ? `<meta property="article:modified_time" content="${graph.modified ?? updated}" />\n` : ""}${tags.map((x) => `<meta property="article:tag" content="${esc(x)}" />\n`).join("")}<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(og.url)}" />
<meta name="twitter:image:alt" content="${esc(og.alt)}" />
<script>try{var t=localStorage.getItem("pricing-theme");if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}</script>
${jsonLd(ld)}
</head>
<body>
<a class="skip-link" href="#main">${t("Skip to content", "跳到正文")}</a>
${renderToStaticMarkup(createElement(SiteHeader, { lang, current: section, languageHref: alt ?? U.home(zh ? "en" : "zh") }))}
<main id="main" class="page static-page" data-section="${esc(section ?? "")}">
<nav class="crumbs" aria-label="${t("Breadcrumb", "面包屑")}"><ol>${crumbs
    .map(([n, h], i) => (i === crumbs.length - 1 ? `<li aria-current="page">${esc(n)}</li>` : `<li><a href="${h}">${esc(n)}</a></li>`))
    .join("")}</ol></nav>
${
    bare
      ? ""
      : `${kicker ? `<p class="kicker">${kicker}</p>\n` : ""}<h1>${esc(h1)}</h1>
<p class="lead">${lead}</p>
<p class="updated">${byline ?? `${t("Plan & benchmark data snapshot", "套餐与榜单数据快照")} <time datetime="${updated}">${updated}</time> · <a href="${U.method(lang)}">${t("How real prices are computed", "真实单价的计算方法")}</a>`}</p>
`
  }${body}
</main>
${renderToStaticMarkup(createElement(SiteFooter, { lang }))}
${PAGE_SCRIPT}${body.includes("data-sortable") ? '\n<script src="/table-sort.js" defer></script>' : ""}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Shared fragments.
// ---------------------------------------------------------------------------
// A column whose cells are all bare figures ($0.0012, 31.5B, 13.3×, #1 / 60,
// $20/mo, —) is right-aligned so the numbers line up.
const FIGURE = /^(?:—|(?:≈|#)?[$¥€]?\d[\d.,]*(?:\s*[%×KMBT亿万])?(?:\/\S+)?(?:\s*\/\s*\d+)?)$/;
const isFigure = (cell) => FIGURE.test(String(cell).replace(/<[^>]+>/g, "").trim());
const table = (caption, head, rows, sorting) => {
  const num = head.map((_, i) => i > 0 && rows.length > 0 && rows.every((r) => isFigure(r[i])) && rows.some((r) => String(r[i]).replace(/<[^>]+>/g, "").trim() !== "—"));
  const cls = (i) => (num[i] ? ' class="num"' : "");
  const activeSort = sorting && rows.length > 1 ? sorting : null;
  return `<div class="table-wrap"><table${activeSort ? ' data-sortable' : ""}><caption>${caption}</caption><thead><tr>${head
    .map((h, i) => {
      const sortType = activeSort?.types[i];
      if (!sortType) return `<th scope="col"${cls(i)}>${h}</th>`;
      const defDir = activeSort.defaultDirections?.[i] ?? (sortType === "date" ? "descending" : "ascending");
      const dir = i === activeSort.column ? activeSort.direction : "none";
      const icon = i === activeSort.column ? (activeSort.direction === "ascending" ? "↑" : "↓") : "↕";
      return `<th scope="col"${cls(i)} aria-sort="${dir}"><button type="button" data-sort-type="${sortType}" data-default-direction="${defDir}">${h}<span class="sort-indicator" aria-hidden="true">${icon}</span></button></th>`;
    })
    .join("")}</tr></thead><tbody>${rows
    .map((r, row) => `<tr>${r.map((c, i) => {
      const value = activeSort?.types[i] ? ` data-sort-value="${esc(activeSort.values[row][i] ?? "")}"` : "";
      return i === 0 ? `<th scope="row"${value}>${c}</th>` : `<td${cls(i)}${value}>${c}</td>`;
    }).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
};
// Page overview: a fixed row of four headline numbers (always four, "—" when
// missing, so the row never breaks unevenly) above a key/value list for the
// details whose count varies by page.
const overview = (label, stats, meta) => {
  if (stats.length !== 4) throw new Error("overview needs exactly four stats");
  return `<section class="overview" aria-label="${label}"><dl class="stats">${stats
    .map(([k, v, note]) => `<div><dt>${k}</dt><dd>${v ?? "—"}${v != null && note ? `<small>${note}</small>` : ""}</dd></div>`)
    .join("")}</dl><dl class="meta">${meta
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("")}</dl></section>`;
};
const kv = (rows) =>
  `<dl class="kv">${rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("")}</dl>`;
const estimateNote = (p, lang) => referenceTags([{point:p,mapping:null}],lang).join(" · ");
const realCell = (p, lang) =>
  unmetered(p)
    ? `≈$0 <small>${esc(unmeteredNote(p, lang))}</small>`
    : `<strong>${usd(p.real_usd_per_mtok)}</strong>${estimateNote(p,lang) ? `<small class="block">${esc(estimateNote(p,lang))}</small>` : ""}`;
const CONF_RANK = { high: 3, medium: 2, low: 1 };
const vsListRatio = (p) =>
  !unmetered(p) && p.list_blended_usd_per_mtok && p.billing !== "metered"
    ? p.list_blended_usd_per_mtok / p.real_usd_per_mtok
    : null;
const vsList = (p) => {
  const ratio = vsListRatio(p);
  return ratio == null ? "—" : `${fmt(ratio, "en", 1)}×`;
};
const billingLabel = (p, lang) =>
  p.billing === "metered" ? (lang === "zh" ? "按量 API" : "Metered API") : lang === "zh" ? "订阅" : "Subscription";
const feeCell = (p, lang) =>
  fee(p) ? `<span class="nw">${esc(fee(p))}${lang === "zh" ? "/月" : "/mo"}</span>` : "—";
const lockLink = (m, lang) => U.explorer(lang, `&lock=${encodeURIComponent(`model:${m.id}`)}`);
const planLink = (p, lang) => link(U.plan(p, lang), planName(p, lang));

// The dialog's real-price formula, word for word.
function formula(p, lang) {
  const t = (en, cn) => (lang === "zh" ? cn : en);
  if (p.billing === "metered")
    return p.workload === "anthropic"
      ? t(
          "Metered API · public token prices weighted by the Anthropic workload (input share at the 5-minute cache-write rate).",
          "按量 API · 三段公开标价按 Anthropic 统一负载加权（普通输入份额按 5 分钟缓存写价计）。",
        )
      : t("Metered API · public token prices weighted by the stated comparison workload.", "按量 API · 公开标价按注明的比较负载加权。");
  if (unmetered(p))
    return `${price(p.price_usd)} ${t("/ month", "/ 月")} ÷ ${t("unbounded usage", "无界可用量")} → ≈$0 / MTok · ${unmeteredNote(p, lang)} · ${t("promotional price, not a permanent allowance", "促销价，非永久口径")}`;
  return `${price(p.price_usd)} ${t("/ month", "/ 月")}${p.currency === "CNY" ? ` (¥${p.original_price})` : ""} ÷ ${number(p.monthly_tokens, lang, 0)} tokens × 1,000,000 ≈ ${priceExact(p.real_usd_per_mtok)} / MTok`;
}

// Everything the "Behind the number" dialog shows for one plan × model point.
function evidenceBlock(p, lang) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const basis =
    p.billing === "subscription" && !unmetered(p)
      ? [
          p.workload ? workloadLine(p, data.conventions, lang) : "",
          p.list_price
            ? listPriceLine(p, lang) +
              (p.list_blended_usd_per_mtok != null
                ? t(` · comparison-load blended ≈ ${price(p.list_blended_usd_per_mtok)}/MTok`, `；比较负载加权 ≈ ${price(p.list_blended_usd_per_mtok)}/MTok`)
                : "")
            : "",
        ]
          .filter(Boolean)
          .map((x) => `<p>${esc(x)}</p>`)
          .join("")
      : "";
  const maps = (mappingsByPoint.get(p.id) ?? []).sort((a, b) => BOARD_ORDER.indexOf(a.board) - BOARD_ORDER.indexOf(b.board));
  const qualifications = referenceTags(maps.length ? maps.map(mapping=>({point:p,mapping})) : [{point:p,mapping:null}], lang);
  const texts = [
    zh ? p.source : p.source_en ?? p.source,
    p.decision_note ? (zh ? p.decision_note : p.decision_note_en ?? p.decision_note) : "",
    p.note && p.note !== p.decision_note ? (zh ? p.note : p.note_en ?? p.note) : "",
  ].filter(Boolean);
  const links = [
    ...p.evidence.map((e) => (safeUrl(e.url) ? ext(e.url, e.label) : "")).filter(Boolean),
    ext(
      `${REPO}/tree/main/data/research`,
      t("Browse the public evidence archive", "浏览公开证据存档"),
      t(`Browse public evidence archive for ${planName(p, lang)} on ${models.get(p.model).name}`, `浏览 ${models.get(p.model).name}（${planName(p, lang)}）的公开证据存档`),
    ),
  ];
  return `<details class="evidence" id="${evidenceId(p)}"><summary><span class="ev-plan">${esc(planName(p, lang))}</span><span class="ev-channel">${esc(p.channel)}</span><span class="ev-price">${unmetered(p) ? "≈$0" : priceExact(p.real_usd_per_mtok)}<small>/MTok</small></span></summary>
<div class="ev-body">
${qualifications.length ? `<p class="note">${qualifications.map(esc).join(' · ')}</p>` : ''}
${kv([
  [t("Plan", "套餐"), `${planLink(p, lang)} · ${providerLink(p.channel, lang)}`],
  [t("Data date", "数据日期"), esc(dataDateLine(p, lang)) || null],
  [t("Real price / MTok", "真实单价 / MTok"), unmetered(p) ? "≈$0" : priceExact(p.real_usd_per_mtok)],
  [t("Monthly tokens", "月 token"), p.monthly_tokens == null ? null : `${number(p.monthly_tokens, lang, 0)} <small>(${tokens(p, lang)})</small>`],
  [t("Quota confidence", "额度置信度"), conf(p.confidence, lang)],
  [t("Calculation", "计算"), `<span class="formula-inline">${esc(formula(p, lang))}</span>`],
  [t("Quota basis", "额度口径"), basis || null],
  [
    t("Benchmark mapping", "评测映射"),
    maps.length
      ? // One line per board: a point maps to every archived configuration of its model.
        BOARD_ORDER.filter((b) => maps.some((x) => x.board === b))
          .map((b) => {
            const own = maps.filter((x) => x.board === b);
            const levels = [...new Set(own.map((x) => conf(x.mapping_confidence, lang)))].join(" / ");
            return `${esc(boardName(b, lang))}: ${levels} <small>(${zh ? `${own.length} 个配置` : plural(own.length, "configuration")})</small>`;
          })
          .join("<br />") + `<small class="block">${t("Mapping confidence: how directly each score refers to the model served here.", "映射置信度：分数与此处所服务模型的对应程度。")}</small>`
      : null,
  ],
])}
<h3>${t("Adoption evidence · source and rationale", "采用依据 · 原始来源文字")}${zh ? "" : ` <small>(${t("translated from the Chinese record", "")})</small>`}</h3>
${texts.map((x) => `<p class="original-text">${esc(x)}</p>`).join("")}
<p class="source-links">${links.join(" · ")}</p>
</div></details>`;
}

// One leaderboard's archived configurations for a model, as the dialog shows them.
const currentScoreFlags = (c, lang) =>
  (c.score_is_preliminary ? `<small>${lang === 'zh' ? '初步成绩' : 'Preliminary'}</small>` : '');
function configTable(b, lang) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const bName = boardName(b.board, lang);
  const rows = b.configs.map((c) => {
    const median = c.median_cost_usd_per_task ?? c.median_cost_per_task_usd ?? null;
    const src = firstUrl(zh ? c.source : c.source_en ?? c.source) ?? firstUrl(c.source);
    const note = zh ? c.record_note_zh : c.record_note_en;
    const vLabel = variantLabel(c.variant, lang);
    return [
      `${esc(vLabel)}${c.board_label && c.board_label !== c.variant ? `<small>${esc(c.board_label)}</small>` : ""}${note ? `<small class="original-text">${esc(note)}</small>` : ""}`,
      `<strong>${fmt(c.score, lang, 4)}</strong>${c.score_is_estimated ? ` <small>${t("AA estimate", "AA 估计值")}</small>` : ""}${c.score_is_self_reported ? ` <small>${t("vendor self-report", "厂商自报")}</small>` : ""}${currentScoreFlags(c, lang)}`,
      c.score_low == null && c.score_high == null ? "—" : `${fmt(c.score_low, lang)} – ${fmt(c.score_high, lang)}`,
      `${esc(c.agent_harness ?? "—")} / ${esc(effortLabel(c.reasoning_effort, lang) ?? "—")} / ${esc(c.service_mode ?? "—")}`,
      `${c.mean_cost_usd_per_task == null ? "—" : price(c.mean_cost_usd_per_task)} / ${median == null ? "—" : price(median)}`,
      esc(c.checked_at ?? "—"),
      [
        src && safeUrl(src) ? ext(src, t("Source", "来源"), t(`${bName} source for ${vLabel}`, `${vLabel} 在 ${bName} 的来源`)) : "",
        c.archive_url ? ext(c.archive_url, t("Archive", "存档"), t(`${bName} archive for ${vLabel}`, `${vLabel} 在 ${bName} 的存档`)) : "",
      ].filter(Boolean).join(" · ") || "—",
    ];
  });
  return `<details class="configs"><summary>${esc(boardName(b.board, lang))} <small>${zh ? `${b.configs.length} 个配置` : plural(b.configs.length, "configuration")}</small></summary>
${table(
  t(`${boardName(b.board, lang)}: every archived configuration (${data.boards[b.board].metric})`, `${boardName(b.board, lang)}：全部存档配置（${metricName(b.board, lang)}）`),
  [t("Configuration", "配置"), t("Score", "分数"), t("Score interval", "分数区间"), t("Harness / effort / mode", "框架 / 强度 / 模式"), t("Source task cost (mean / median)", "来源任务成本（均值 / 中位数）"), t("Checked", "核对日期"), t("Links", "链接")],
  rows,
)}</details>`;
}

// News lists: the newest articles first, with date, title and summary.
const formatDay = (d, lang) =>
  new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const newsItems = (articles, lang) =>
  `<ul class="news-list">${articles
    .map(
      (a) =>
        `<li><time datetime="${a.date}">${formatDay(a.date, lang)}</time><div><a class="news-title" href="${U.article(a)}" hreflang="en" lang="en">${esc(a.title)}</a><p lang="en">${esc(a.summary)}</p></div></li>`,
    )
    .join("")}</ul>`;
const relatedNews = (articles, lang) =>
  articles.length
    ? `<section aria-labelledby="news"><h2 id="news">${lang === "zh" ? "相关资讯" : "Related news"}</h2>${lang === "zh" ? '<p class="note">资讯目前只有英文版。</p>' : ""}${newsItems(articles.slice(0, 8), lang)}${
        articles.length > 8 ? moreLink(U.news(), lang === "zh" ? "全部资讯" : "All news") : ""
      }</section>`
    : "";

function codingPlanReviews(reviews, lang) {
  if (!reviews.length) return "";
  const zh = lang === "zh";
  return `<section aria-labelledby="coding-plan-reviews"><h2 id="coding-plan-reviews">${zh ? "渠道可用性与待核实项" : "Channel availability and pending verification"}</h2><p>${zh ? "已确认的型号、费率和额度会进入上方价格表；以下记录说明其他可用渠道及暂未计算价格的原因。" : "Verified model, rate and quota combinations appear in the price tables above. These records explain other channels and why a price has not been calculated."}</p>${table(zh ? "第三方套餐核实记录" : "Third-party plan review", [zh ? "供应商" : "Provider", zh ? "模型" : "Models", zh ? "核实日期" : "Checked", zh ? "状态与依据" : "Status and evidence"], reviews.map(r => [providerLink(r.channel, lang), join(r.models.map(id=>modelLink(models.get(id), lang)), lang), esc(r.checkedAt), `${esc(r.note[lang])} ${(r.relatedModels ?? []).map(id=>modelLink(models.get(id), lang)).join(" · ")} ${ext(r.source, zh ? "官方来源" : "Official source")}`]))}</section>`;
}

// ---------------------------------------------------------------------------
// Model page.
// ---------------------------------------------------------------------------
function modelPage(m, lang) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const v = makers.get(m.maker);
  const vName = makerLabel(v, lang);
  const lp = listPrice(m.apiReference?.prices);
  const c = m.cheapest;
  const priceUpdated = latest(updated, ...m.points.map(p => p.data_date));
  const nPlans = m.subs.length;
  const currentBenchmarks = m.benchmarks.filter(b=>data.boards[b.board].current !== false);
  const topBench = (currentBenchmarks.length ? currentBenchmarks : m.benchmarks).slice().sort((a, b) => a.rank / a.of - b.rank / b.of)[0];
  // The strongest leaderboard placement, as one citable sentence in the answer.
  const benchSentence = topBench
    ? zh
      ? `${m.name} 收录了 ${m.benchmarks.length} 个榜单快照的成绩，最好的一项是 ${boardName(topBench.board, lang)} 上的 ${fmt(topBench.best.score, lang, 2)}（${metricName(topBench.board, lang)}），在${topBench.best.source_rank_scope === "comparison-group" ? "来源对比组" : topBench.sourceRank ? "来源榜单" : "本站收录"}的 ${topBench.of} 个${topBench.sourceRank ? "条目" : "模型"}中排第 ${topBench.rank}。`
      : `On independent leaderboards, ${m.name}'s strongest placement is ${fmt(topBench.best.score, lang, 2)} (${metricName(topBench.board, lang)}) on ${boardName(topBench.board, lang)}, #${topBench.rank} of ${topBench.of} ${topBench.sourceRank ? "entries" : "models"} ${topBench.best.source_rank_scope === "comparison-group" ? "in the source comparison group" : topBench.sourceRank ? "on the source leaderboard" : "tracked"}.`
    : "";

  const answer = !m.points.length
    ? t(`As of ${m.modified}, ${m.name} is listed in our model directory. Subscription allowances and real token costs have not yet been recorded.`, `截至 ${m.modified}，${m.name} 已收录到模型目录；订阅额度与真实 token 成本尚未收录。`)
    : c
    ? zh
      ? `截至 ${priceUpdated}，使用 ${m.name} 最便宜的方式是「${planName(c, lang)}」，${estimateNote(c,lang) ? "估算" : "真实"}单价约 ${usd(c.real_usd_per_mtok)} / 百万 token${c.price_usd != null ? `（月费 ${fee(c)}，每月约 ${tokens(c, lang)} token）` : ""}。本站共收录 ${m.points.length} 个可使用 ${m.name} 的套餐或 API 渠道。`
      : `As of ${priceUpdated}, the cheapest way to use ${m.name} is ${planName(c, lang)} at ${estimateNote(c,lang) ? "an estimated" : "a real"} cost of about ${usd(c.real_usd_per_mtok)} per million tokens${c.price_usd != null ? ` (${fee(c)}/month for roughly ${tokens(c, lang)} tokens a month)` : ""}. We track ${plural(m.points.length, "plan")} and API channels that serve ${m.name}.`
    : zh
      ? `截至 ${priceUpdated}，${m.name} 在本站收录的渠道中不计额度（真实单价 ≈$0）。`
      : `As of ${priceUpdated}, ${m.name} is unmetered on every channel we track (real cost ≈$0).`;
  const listSentence = lp
    ? zh
      ? `官方 API 标价（每百万 token）：缓存读 ${lp.cached} / 输入 ${lp.input} / 输出 ${lp.output}${m.listBlended != null ? `；按参考负载折合约 ${usd(m.listBlended)} / 百万 token` : ""}。${m.apiReference.checkedAt ? `适用：${apiPriceScope(m.apiReference.variant, lang)}；价格核实于 ${m.apiReference.checkedAt}。` : ""}`
      : `Official API list price per million tokens: ${lp.cached} cached input, ${lp.input} input, ${lp.output} output${m.listBlended != null ? ` — about ${usd(m.listBlended)} per million tokens on a comparison workload mix` : ""}.${m.apiReference.checkedAt ? ` ${apiPriceScope(m.apiReference.variant, lang)}; prices checked ${m.apiReference.checkedAt}.` : ""}`
    : "";

  const title = !m.points.length
    ? t(`${m.name}: Benchmarks & Info`, `${m.name} 榜单与资料`)
    : zh
      ? `${m.name} 价格与额度（${vName}）`
      : `${m.name} Pricing & Token Cost`;
  const description = clip(
    c
      ? zh
        ? `${m.name}（${vName}）${estimateNote(c, lang) ? "估算" : "真实"}单价低至 ${usd(c.real_usd_per_mtok)}/百万 token（${planName(c, lang)}）。对比 ${m.channels.length} 家供应商、${m.points.length} 个订阅套餐与按量 API 的月费、实际可用 token 额度、官方 API 标价${m.listBlended != null ? `（参考负载 ${usd(m.listBlended)}/百万 token）` : ""}${topBench ? `及 ${boardName(topBench.board, lang)}（${fmt(topBench.best.score, lang, 2)}）等 ${m.benchmarks.length} 个独立榜单成绩` : "与独立榜单成绩"}，所有数据均附计算公式、置信度分级、采样日期与可追溯原始来源。`
        : `${m.name} (${vName}) ${estimateNote(c, lang) ? "estimated" : "real"} cost from ${usd(c.real_usd_per_mtok)}/MTok via ${planName(c, lang)}. Compare ${plural(m.points.length, "plan")} across ${plural(m.channels.length, "provider")}: monthly fees, usable token limits, official API list prices${topBench ? `, and ${boardName(topBench.board, lang)} scores` : ", and independent benchmarks"}, with sources.`
      : m.free.length
        ? zh
          ? `${m.name}（${vName}）在本站收录的 ${m.free.length} 个渠道中不计额度（真实单价约 $0/百万 token）。在 Tokenews 查看对应套餐使用条件、官方 API 标价${m.listBlended != null ? `（参考负载 ${usd(m.listBlended)}/百万 token）` : ""}${topBench ? `以及 ${boardName(topBench.board, lang)}（${fmt(topBench.best.score, lang, 2)}）等 ${m.benchmarks.length} 个独立榜单成绩` : "与独立榜单成绩"}，所有记录均附采样日期、置信度说明与可追溯原始来源。`
          : `${m.name} by ${vName} is unmetered (≈$0/MTok) across ${plural(m.free.length, "tracked channel")}. Inspect plan terms, official API list prices${topBench ? `, ${boardName(topBench.board, lang)} scores (${fmt(topBench.best.score, lang, 2)})` : ", and independent benchmark scores"}, sample dates, and traceable sources on Tokenews.`
        : topBench
          ? zh
            ? `${m.name}（${vName}）AI 模型资料与独立榜单成绩：已收录 ${m.benchmarks.length} 个独立榜单快照，代表成绩为 ${boardName(topBench.board, lang)} ${fmt(topBench.best.score, lang, 2)}（第 ${topBench.rank}/${topBench.of} 名）${m.listBlended != null ? `，官方 API 参考标价 ${usd(m.listBlended)}/百万 token` : "，订阅真实单价暂未收录"}；在 Tokenews 查看全部存档评测配置、推理强度、核对日期与可追溯原始来源。`
            : `${m.name} by ${vName}: ${fmt(topBench.best.score, lang, 2)} on ${boardName(topBench.board, lang)} (#${topBench.rank} of ${topBench.of}) across ${plural(m.benchmarks.length, "independent leaderboard")}${m.listBlended != null ? `, official API list ${usd(m.listBlended)}/MTok` : ""}. View archived benchmark configurations, release metadata and traceable sources on Tokenews.`
          : zh
            ? `${m.name}（${vName}）AI 模型目录与价格追踪详情页：归属 ${vName} 模型家族${m.releaseDate ? `（发布日期 ${m.releaseDate}）` : ""}${m.listBlended != null ? `，官方 API 参考标价约 ${usd(m.listBlended)}/百万 token` : "，当前暂未收录订阅套餐额度与独立榜单成绩"}。欢迎在 Tokenews 查看完整模型 ID、官方资料来源、数据核对日期，以及同厂商其他模型的真实每百万 token 单价与评测对比。`
            : `${m.name} by ${vName} in the Tokenews AI model directory${m.releaseDate ? ` (released ${m.releaseDate})` : ""}${m.listBlended != null ? `, with official API list pricing around ${usd(m.listBlended)}/MTok` : ""}. Check model metadata, official source links, sibling ${vName} model prices, and future benchmark or subscription updates.`,
    lang,
  );

  const planRows = m.points.map((p) => [
    planLink(p, lang),
    providerLink(p.channel, lang),
    billingLabel(p, lang),
    feeCell(p, lang),
    tokens(p, lang),
    realCell(p, lang),
    vsList(p),
    conf(p.confidence, lang),
    renderDate(p.data_date),
    `<a href="#${evidenceId(p)}" aria-label="${esc(t(`Evidence for ${planName(p, lang)} on ${m.name}`, `${m.name} 在 ${planName(p, lang)} 的依据`))}">${t("Evidence", "依据")} ↓</a>`,
  ]);
  const benchRows = m.benchmarks.map(({ board, best, configs, rank, of, sourceRank }) => [
    ext(data.boards[board].url, boardName(board, lang)),
    esc(metricName(board, lang)),
    `<strong>${fmt(best.score, lang, 2)}</strong>${best.score_is_self_reported ? ` <small>${t("self-reported", "厂商自报")}</small>` : ""}${best.score_is_estimated ? ` <small>${t("estimate", "估计值")}</small>` : ""}${currentScoreFlags(best, lang)}`,
    `#${rank} / ${of} <small>${best.source_rank_scope === "comparison-group" ? t("source group", "来源对比组") : sourceRank ? t("source", "来源榜单") : t("tracked", "本站收录")}</small>`,
    esc(variantLabel(best.board_label ?? best.variant, lang)),
    esc(effortLabel(best.reasoning_effort, lang) ?? "—"),
    esc(best.agent_harness ?? "—"),
    String(configs.length),
    esc(best.checked_at ?? data.boards[board].snapshot),
  ]);
  const siblings = v.models.filter((x) => x !== m);

  const subPoints = m.points.filter((p) => p.price_usd != null);
  const apiPoints = m.points.filter((p) => p.price_usd == null && !unmetered(p) && p.real_usd_per_mtok != null);
  const subOffers = subPoints.map((p) => ({
    "@type": "Offer",
    name: planName(p, lang),
    url: abs(U.plan(p, lang)),
    price: p.price_usd,
    priceCurrency: "USD",
    seller: { "@id": `${abs(providerPagePath(p.channel, "en"))}#org` },
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: p.price_usd,
      priceCurrency: "USD",
      unitText: "MONTH",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
    },
  }));
  const apiOffers = apiPoints.map((p) => ({
    "@type": "Offer",
    name: planName(p, lang),
    url: abs(U.plan(p, lang)),
    price: p.real_usd_per_mtok,
    priceCurrency: "USD",
    seller: { "@id": `${abs(providerPagePath(p.channel, "en"))}#org` },
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: p.real_usd_per_mtok,
      priceCurrency: "USD",
      unitText: "MTok",
    },
  }));
  const subAggregate = subOffers.length
    ? {
        "@type": "AggregateOffer",
        priceCurrency: "USD",
        lowPrice: Math.min(...subPoints.map((p) => p.price_usd)),
        highPrice: Math.max(...subPoints.map((p) => p.price_usd)),
        offerCount: subOffers.length,
        offers: subOffers,
      }
    : null;
  const offersProp = subAggregate && apiOffers.length
    ? [subAggregate, ...apiOffers]
    : subAggregate
      ? subAggregate
      : apiOffers.length === 1
        ? apiOffers[0]
        : apiOffers.length > 1
          ? apiOffers
          : null;
  const modelCoverage = temporalCoverage(
    m.releaseDate,
    m.apiReference?.checkedAt,
    ...m.points.map((p) => p.data_date),
    ...[...m.configs.values()].map(configDate),
  );
  const product = {
    "@type": "SoftwareApplication",
    "@id": `${abs(U.model(m, "en"))}#model`,
    name: m.name,
    alternateName: m.id,
    description,
    applicationCategory: "Large language model",
    operatingSystem: "Cloud API",
    url: abs(U.model(m, lang)),
    ...(m.releaseDate ? { datePublished: m.releaseDate } : {}),
    creator: { "@id": `${abs(U.maker(v, "en"))}#org` },
    ...(offersProp ? { offers: offersProp } : {}),
    additionalProperty: [
      ...(c ? [{ "@type": "PropertyValue", name: "Lowest real price (USD per million tokens)", value: c.real_usd_per_mtok, unitText: "USD/MTok" }] : []),
      ...(m.listBlended != null ? [{ "@type": "PropertyValue", name: "API list price, standard mix (USD per million tokens)", value: m.listBlended, unitText: "USD/MTok" }] : []),
      ...m.benchmarks.map(({ board, best }) => ({ "@type": "PropertyValue", name: `${data.boards[board].name} — ${data.boards[board].metric}`, value: +best.score.toFixed(3) })),
    ],
  };
  const dataset = {
    "@type": "Dataset",
    "@id": `${abs(U.model(m, lang))}#dataset`,
    name: zh ? `${m.name} 模型与评测数据` : `${m.name} model and benchmark data`,
    // Google requires 50–5000 characters for a Dataset description; the meta
    // description alone can be shorter (short Chinese names), so add the answer.
    description: [description, answer, listSentence, benchSentence].filter(Boolean).join(" "),
    license: "https://opensource.org/licenses/MIT",
    creator: { "@id": `${SITE}/#organization` },
    dateModified: m.modified,
    ...(modelCoverage ? { temporalCoverage: modelCoverage } : {}),
    measurementTechnique: t(
      "Monthly subscription fee divided by measured or estimated usable monthly tokens under normalized workloads; independent leaderboard scores retain original evaluation configurations.",
      "按月费除以归一化负载下实测或估算的每月可用 token 数计算真实单价；独立榜单分数保留原始评测配置语境。",
    ),
    isAccessibleForFree: true,
    url: abs(U.model(m, lang)),
    variableMeasured: [...(m.points.length ? ["monthly fee (USD)", "monthly tokens", "real USD per million tokens"] : []), ...(m.benchmarks.length ? ["leaderboard score"] : [])],
    distribution: [
      ...(m.points.length ? [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/data/points.csv` }] : []),
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/data/site.json` },
    ],
  };

  const body = `
<p class="answer">${esc(answer)}${listSentence ? " " + esc(listSentence) : ""}${benchSentence ? " " + esc(benchSentence) : ""}</p>
${overview(
  t("Overview", "概览"),
  !m.points.length ? [
    [t("Benchmark score", "榜单成绩"), topBench ? fmt(topBench.best.score, lang, 2) : null, topBench ? esc(boardName(topBench.board, lang)) : t("Not yet recorded", "尚未收录")],
    [t("Leaderboard rank", "榜单名次"), topBench ? `#${topBench.rank} / ${topBench.of}` : null, topBench?.best.source_rank_scope === "comparison-group" ? t("source comparison group", "来源对比组") : topBench?.sourceRank ? t("source leaderboard", "来源榜单") : t("tracked models", "本站收录模型")],
    [t("Leaderboards", "榜单数"), String(m.benchmarks.length), t("independent evaluations", "独立评测")],
    [t("API list price", "API 标价"), m.listBlended != null ? `${usd(m.listBlended)}<span class="unit">/MTok</span>` : null, m.listBlended != null ? t("comparison workload mix", "参考负载") : t("Not yet recorded", "尚未收录")],
  ] : [
    [t("Lowest real price", "最低真实单价"), c ? `${usd(c.real_usd_per_mtok)}<span class="unit">/MTok</span>` : m.free.length ? "≈$0" : null, c ? esc([planName(c, lang),estimateNote(c,lang)].filter(Boolean).join(" · ")) : m.free.length ? t("unmetered on every channel", "所有渠道均不计额度") : t("Not yet recorded", "尚未收录")],
    [t("API list price", "API 标价"), m.listBlended != null ? `${usd(m.listBlended)}<span class="unit">/MTok</span>` : null, t("comparison workload mix", "参考负载")],
    [t("Most monthly tokens", "最多月额度"), m.mostTokens ? tokens(m.mostTokens, lang) : null, m.mostTokens && esc([planName(m.mostTokens, lang),estimateNote(m.mostTokens,lang)].filter(Boolean).join(" · "))],
    [t("Plans & APIs", "套餐与 API"), String(m.points.length), zh ? `${nPlans} 个订阅 · ${m.api.length} 个按量 API` : `${plural(nPlans, "subscription")} · ${plural(m.api.length, "metered API")}`],
  ],
  [
    [t("Maker", "厂商"), makerLink(v, lang)],
    [t("Model ID", "模型 ID"), `<code>${esc(m.id)}</code>`],
    [t("Release date", "发布时间"), m.releaseDate ? `<time datetime="${esc(m.releaseDate)}">${esc(m.releaseDate)}</time>` : null],
    [t("Model source", "模型来源"), m.source ? ext(m.source, t("Source", "来源")) : null],
    [t("Providers", "供应商"), join(m.channels.map((ch) => providerLink(ch, lang)), lang)],
    [t("Leaderboards", "榜单"), m.benchmarks.length ? `<a href="#bench">${join(m.benchmarks.map((b) => esc(boardName(b.board, lang))), lang)}</a>` : null],
  ],
)}
${m.points.length ? `<p><a class="button" href="${lockLink(m, lang)}">${t(`Plot ${m.name} on the price–capability chart`, `在价格–能力图中查看 ${m.name}`)}<span class="arrow" aria-hidden="true">→</span></a></p>
<section aria-labelledby="plans"><h2 id="plans">${t(`${m.name} plans and real prices`, `${m.name} 套餐与真实单价`)}</h2>
<p>${t("Real price = monthly fee ÷ tokens you can actually use in a month. “vs API” shows how many times cheaper than the official API list price (comparison workload mix) the plan is. “Evidence” opens the full calculation and sources for that row.", "真实单价 = 月费 ÷ 每月实际可用 token。「对比 API」表示该套餐比官方 API 标价（参考负载）便宜多少倍。「依据」展开该行的完整计算与来源。")}</p>
${table(
  t(`Every tracked way to use ${m.name}, cheapest first`, `所有可使用 ${m.name} 的套餐，按真实单价从低到高`),
  [t("Plan", "套餐"), t("Provider", "供应商"), t("Billing", "计费"), t("Monthly fee", "月费"), t("Monthly tokens", "月额度"), t("Real $/MTok", "真实单价 $/MTok"), t("vs API", "对比 API"), t("Confidence", "置信度"), t("Data date", "数据日期"), t("Evidence", "依据")],
  planRows,
  {
    column: 5, direction: "ascending",
    types: ["text", "text", "text", "number", "number", "number", "number", "number", "date", null],
    defaultDirections: ["ascending", "ascending", "ascending", "ascending", "descending", "ascending", "descending", "descending", "descending", null],
    values: m.points.map((p) => [
      planName(p, lang),
      p.channel,
      billingLabel(p, lang),
      p.price_usd,
      p.monthly_tokens,
      unmetered(p) ? 0 : p.real_usd_per_mtok,
      vsListRatio(p),
      CONF_RANK[p.confidence] ?? null,
      p.data_date ?? null,
      null,
    ]),
  },
)}</section>
<section aria-labelledby="evidence"><h2 id="evidence">${t("Behind each number", "每个数字背后的依据")}</h2>
<p>${t("For every plan: the data date, the exact calculation, the quota basis, how leaderboard scores were mapped, and the original adoption evidence with its sources.", "每个套餐的数据日期、精确计算、额度口径、榜单分数的映射方式，以及原始采用依据与来源。")}</p>
${m.points.map((p) => evidenceBlock(p, lang)).join("\n")}
</section>` : `<p class="note">${t("Pricing has not yet been recorded. This model is not included in the price–capability chart.", "价格尚未收录，暂不参与价格–能力图比较。")}</p>`}
${
  m.benchmarks.length
    ? `<section aria-labelledby="bench"><h2 id="bench">${t(`${m.name} benchmark scores`, `${m.name} 榜单成绩`)}</h2>
<p>${t("Highest archived configuration per leaderboard; ranks marked “source” are reported by that leaderboard; “tracked” ranks cover models archived in this dataset. AA model-page ranks refer to its comparison group, not the global leaderboard. Scores are never mixed across boards.", "每个榜单取已归档的最高配置；标注「来源榜单」的是来源公布的排名；「本站收录」是本数据集所收录模型内的名次。AA 模型页名次属于其来源对比组，并非全榜排名。不同榜单的分数不混算。")}</p>
${table(
  t(`${m.name} on independent leaderboards`, `${m.name} 在独立榜单上的成绩`),
  [t("Leaderboard", "榜单"), t("Metric", "指标"), t("Score", "分数"), t("Rank", "排名"), t("Configuration", "配置"), t("Effort", "推理强度"), t("Harness", "框架"), t("Configs", "配置数"), t("Snapshot", "快照")],
  benchRows,
)}
<h3>${t("Every archived configuration", "全部存档配置")}</h3>
${m.benchmarks.map((b) => configTable(b, lang)).join("\n")}
<p class="note">${t(
  "These are reference mappings, not benchmarks of a subscription or API channel. Harness and quota-measurement effort alignment are unverified. Source task costs are not subscription task costs.",
  "这是参考映射，并非订阅或 API 渠道的评测。产品框架和额度实测推理强度的对应关系未经验证。来源任务成本不等于订阅任务成本。",
)}</p>
<ul class="note">${m.mappingNotes.map((n) => `<li>${esc(mappingNoteLabel(n, lang))}</li>`).join("")}</ul>
</section>`
    : ""
}
${
  lp
    ? `<section aria-labelledby="list"><h2 id="list">${t(`${m.name} official API pricing`, `${m.name} 官方 API 定价`)}</h2>
${renderToStaticMarkup(createElement(ApiPriceDetails, { reference: m.apiReference, lang }))}</section>`
    : ""
}
${
  comparisonsOf(m).length
    ? `<section aria-labelledby="compare"><h2 id="compare">${t(`${m.name} compared`, `${m.name} 对比`)}</h2>
${table(
  t(`${m.name} against other models, plan by plan and board by board`, `${m.name} 与其他模型逐个套餐、逐个榜单对比`),
  [t("Comparison", "对比"), t("Shared subscriptions", "共同订阅"), t("Matching workloads", "同口径套餐"), t(`${m.name}: lower token cost`, `${m.name}：单价较低`), t(`${m.name}: higher archived score`, `${m.name}：存档成绩较高`)],
  comparisonsOf(m).map((c) => {
    const own = c.a === m ? "a" : "b";
    return [
      compareLink(c, lang),
      String(c.plans.length),
      String(c.comparablePlans.length),
      `${c.plansWon[own]} / ${c.comparablePlans.length}`,
      `${c.boardsWon[own]} / ${c.boards.length}`,
    ];
  }),
)}</section>`
    : ""
}
${codingPlanReviews((data.codingPlanReviews ?? []).filter(r=>r.models.includes(m.id)), lang)}
${relatedNews(newsFor.model(m), lang)}
${
  siblings.length
    ? `<section aria-labelledby="more"><h2 id="more">${t(`More ${vName} models`, `${vName} 的其他模型`)}</h2>
${table(
  t(`Other ${vName} models by lowest real price`, `${vName} 的其他模型，按最低真实单价排序`),
  [t("Model", "模型"), t("Lowest real $/MTok", "最低真实单价 $/MTok"), t("Cheapest plan", "最便宜的套餐"), t("Plans", "套餐数")],
  siblings.map((s) => [
    modelLink(s, lang),
    s.cheapest ? `<strong>${usd(s.cheapest.real_usd_per_mtok)}</strong>` : s.free.length ? "≈$0" : "—",
    s.cheapest ? planLink(s.cheapest, lang) : "—",
    String(s.points.length),
  ]),
  {
    column: 1, direction: "ascending",
    types: ["text", "number", "text", "number"],
    defaultDirections: ["ascending", "ascending", "ascending", "descending"],
    values: siblings.map((s) => [
      s.name,
      s.cheapest ? s.cheapest.real_usd_per_mtok : (s.free.length ? 0 : null),
      s.cheapest ? planName(s.cheapest, lang) : null,
      s.points.length,
    ]),
  },
)}</section>`
    : ""
}`;
  const h1 = !m.points.length ? t(`${m.name}: benchmarks and model information`, `${m.name} 榜单成绩与模型资料`) : zh ? `${m.name} 真实价格与额度` : `${m.name} pricing: real cost per million tokens`;
  return page({
    section: "models",
    lang,
    path: U.model(m, lang),
    alt: U.model(m, zh ? "en" : "zh"),
    title,
    description,
    keywords: [m.name, m.id, `${m.name} ${t("pricing", "价格")}`, `${m.name} API ${t("price", "价格")}`, `${m.name} ${t("subscription", "订阅")}`, vName, ...m.channels, t("cost per million tokens", "每百万 token 价格"), t("AI coding plan", "AI 编程套餐")],
    kicker: `${t("Model", "模型")} · ${makerLink(v, lang)}`,
    h1,
    lead: esc(
      !m.points.length ? t(`${m.name} by ${vName}: independently sourced benchmark results and model information.`, `${vName} 的 ${m.name}：来自独立来源的榜单成绩与模型资料。`) : zh
        ? `${vName} 的 ${m.name} 在 ${m.channels.length} 个供应商、${m.points.length} 个套餐中的月费、实际可用额度与真实单价，并对照官方 API 标价和独立榜单成绩。`
        : `What ${vName}'s ${m.name} really costs across ${plural(m.points.length, "plan")} from ${plural(m.channels.length, "provider")}: monthly fees, usable allowances and real per-token prices, against the official API list price and independent leaderboards.`,
    ),
    body,
    ogType: "article",
    crumbs: [
      [NAME[lang], U.home(lang)],
      [t("Makers", "厂商"), U.makers(lang)],
      [vName, U.maker(v, lang)],
      [m.name, U.model(m, lang)],
    ],
    byline: `${t("Model data updated", "模型资料更新")} <time datetime="${m.modified}">${m.modified}</time>${m.points.length ? ` · ${t("Upstream plan snapshot", "上游套餐快照")} <time datetime="${updated}">${updated}</time>` : ""}`,
    graph: { modified: m.modified, about: { "@id": product["@id"] }, mainEntity: { "@id": product["@id"] }, extra: [product, dataset] },
    fingerprint: {
      title,
      description,
      h1,
      maker: m.maker,
      releaseDate: m.releaseDate ?? null,
      points: m.points.map((p) => [p.id, p.plan, p.price_usd, p.monthly_tokens, p.real_usd_per_mtok, p.confidence, p.data_date]),
      api: m.apiReference ? [m.apiReference.checkedAt, m.apiReference.blended, m.apiReference.prices] : null,
      benchmarks: m.benchmarks.map((b) => [b.board, b.rank, b.of, b.configs.map((cfg) => [cfg.configuration_id, cfg.score, cfg.score_low, cfg.score_high, cfg.variant, cfg.reasoning_effort, cfg.agent_harness])]),
      comparisons: comparisonsOf(m).map((cmp) => U.compare(cmp, lang)),
      reviews: (data.codingPlanReviews ?? []).filter((r) => r.models.includes(m.id)).map((r) => [r.channel, r.checkedAt, r.note[lang]]),
      news: newsFor.model(m).map((a) => [a.slug, a.updated]),
    },
  });
}

// ---------------------------------------------------------------------------
// Maker page.
// ---------------------------------------------------------------------------
function makerPage(v, lang) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const vName = makerLabel(v, lang);
  const best = v.models.find((m) => m.cheapest);
  const n = v.models.length;
  const isOther = v.name === "Other";
  const title = isOther
    ? n === 1
      ? t(`Other AI Model Pricing: ${v.models[0].name}`, `其他厂商 AI 模型价格（1 个）`)
      : t(`Other AI Models: Pricing (${n} Models)`, `其他厂商 AI 模型价格（${n} 个）`)
    : zh
      ? `${vName} AI 模型价格（${n} 个）`
      : n === 1
        ? `${v.name}${v.name.endsWith("AI") ? "" : " AI"} Model Pricing: ${v.models[0].name}`
        : `${v.name.endsWith("AI") ? v.name : `${v.name} AI`} Models: Pricing (${n} Models)`;
  const modelNames = v.models.map((m) => m.name);
  const names = (sep, more) => modelNames.slice(0, 3).join(sep) + (n > 3 ? more : "");
  const scored = v.models.filter((m) => m.benchmarks.length).length;
  const withApiRef = v.models.filter((m) => m.apiReference).length;
  const benchEntries = v.models.flatMap((m) => {
    const current = m.benchmarks.filter((b) => data.boards[b.board].current !== false);
    const pool = current.length ? current : m.benchmarks;
    return pool.map((b) => ({ m, b }));
  });
  const topBenchEntry = benchEntries.sort((a, b) => a.b.rank / a.b.of - b.b.rank / b.b.of || b.b.best.score - a.b.best.score)[0] ?? null;
  const makerComparisons = comparisons.filter((c) => c.a.maker === v.name || c.b.maker === v.name);
  const description = clip(
    v.points.length > 0
      ? zh
        ? `${vName}${v.zhName ? `（${v.zhName}）` : ""}全部 ${n} 个 AI 模型（${names("、", " 等")}）价格与榜单目录${best ? `，真实单价低至 ${usd(best.cheapest.real_usd_per_mtok)}/百万 token` : v.points.some(unmetered) ? "，收录渠道当前均不计额度（真实单价约 $0/百万 token）" : ""}。对比 ${v.channels.length} 家供应商、${v.plans.length} 个订阅套餐与按量 API 的月费、每月可用 token 额度、官方 API 标价及独立榜单成绩，附完整计算依据与原始来源。`
        : `${isOther ? "Other AI makers" : v.name} model lineup: ${plural(n, "tracked model")} (${names(", ", "…")})${best ? ` from ${usd(best.cheapest.real_usd_per_mtok)}/MTok real cost` : v.points.some(unmetered) ? " with unmetered access (≈$0/MTok)" : ""}. Compare ${plural(v.plans.length, "subscription and API plan", "subscriptions and APIs")} across ${plural(v.channels.length, "provider")} with fees, token limits, list prices and benchmarks.`
      : zh
        ? `${vName}${v.zhName ? `（${v.zhName}）` : ""}AI 模型目录与价格追踪详情页：共收录 ${n} 个模型（${names("、", " 等")}）${scored ? `，其中 ${scored} 个已有独立榜单成绩` : "，当前订阅套餐额度与真实单价暂未收录"}。欢迎在 Tokenews 查看 ${vName} 旗下各模型的独立评测分数、榜单排名、官方 API 参考标价、模型发布日期与可追溯原始来源，持续追踪后续每百万 token 单价更新。`
        : `${isOther ? "Other AI makers" : v.name} AI model directory on Tokenews: ${plural(n, "tracked model")} (${names(", ", "…")})${scored ? `, including ${scored} with independent leaderboard scores` : ""}. Browse model details, official API list prices, benchmark records and traceable sources as pricing coverage expands.`,
    lang,
  );
  const answer = best
    ? zh
      ? `截至 ${updated}，本站收录 ${vName} 的 ${n} 个模型、${v.points.length} 个套餐/渠道组合。真实单价最低的是 ${best.name}，通过「${planName(best.cheapest, lang)}」约 ${usd(best.cheapest.real_usd_per_mtok)} / 百万 token。`
      : `As of ${updated}, we track ${n} ${isOther ? "" : `${v.name} `}model${n === 1 ? "" : "s"} across ${plural(v.points.length, "plan/channel combination")}. The lowest real price is ${best.name} via ${planName(best.cheapest, lang)} at about ${usd(best.cheapest.real_usd_per_mtok)} per million tokens.`
    : zh
      ? `截至 ${updated}，本站收录 ${vName} 的 ${n} 个模型${scored ? `，其中 ${scored} 个有独立榜单成绩（代表成绩：${topBenchEntry.m.name} 在 ${boardName(topBenchEntry.b.board, lang)} 取得 ${fmt(topBenchEntry.b.best.score, lang, 2)}，第 ${topBenchEntry.b.rank}/${topBenchEntry.b.of} 名）` : ""}${withApiRef ? `，${withApiRef} 个模型收录了官方 API 参考标价` : ""}。${v.points.some(unmetered) ? "当前收录渠道均不计额度（≈$0/MTok）。" : "订阅额度与真实单价尚未收录。"}`
      : `As of ${updated}, we track ${plural(n, `${isOther ? "" : v.name + " "}model`)}${scored ? `, including ${scored} with independent leaderboard scores (strongest placement: ${topBenchEntry.m.name} at ${fmt(topBenchEntry.b.best.score, lang, 2)} on ${boardName(topBenchEntry.b.board, lang)}, #${topBenchEntry.b.rank} of ${topBenchEntry.b.of})` : ""}${withApiRef ? `; ${plural(withApiRef, "model")} ${withApiRef === 1 ? "has" : "have"} official API list price references` : ""}. ${v.points.some(unmetered) ? "Tracked channels are currently unmetered (≈$0/MTok)." : "Subscription allowances and real per-token prices have not yet been recorded."}`;
  const rows = v.models.map((m) => {
    const lp = listPrice(m.apiReference?.prices);
    const top = m.benchmarks.find((b) => b.board === "aa_intelligence_index_v5_0_1") ?? m.benchmarks[0];
    return [
      modelLink(m, lang),
      m.cheapest ? `<strong>${usd(m.cheapest.real_usd_per_mtok)}</strong>` : m.free.length ? "≈$0" : "—",
      m.cheapest ? planLink(m.cheapest, lang) : "—",
      m.listBlended != null ? usd(m.listBlended) : "—",
      lp ? `${lp.input} / ${lp.output}` : "—",
      m.mostTokens ? `${tokens(m.mostTokens, lang)}` : "—",
      String(m.points.length),
      top ? `${fmt(top.best.score, lang, 1)} <small>${esc(boardName(top.board, lang))}</small>` : "—",
    ];
  });
  const sortedPlans = v.plans
    .slice()
    .sort((a, b) => (a.price_usd ?? Infinity) - (b.price_usd ?? Infinity) || planName(a, lang).localeCompare(planName(b, lang)));
  const planRows = sortedPlans.map((p) => {
    const key = makerPlanKey(p);
    const ms = [...new Set(v.points.filter((x) => makerPlanKey(x) === key).map((x) => x.model))].map((id) => models.get(id));
    return [planLink(p, lang), providerLink(p.channel, lang), billingLabel(p, lang), feeCell(p, lang), join(ms.map((x) => modelLink(x, lang)), lang)];
  });
  const org = {
    "@type": "Organization",
    "@id": `${abs(U.maker(v, "en"))}#org`,
    name: isOther ? "Other model makers" : v.name,
    ...(v.alt || v.zhName ? { alternateName: [...(v.zhName ? [v.zhName] : []), ...(v.alt ?? [])] } : {}),
    ...(v.url ? { url: v.url, sameAs: [v.url] } : {}),
  };
  const list = {
    "@type": "ItemList",
    "@id": `${abs(U.maker(v, lang))}#models`,
    name: zh ? `${vName} 模型` : `${v.name} models`,
    numberOfItems: n,
    itemListElement: v.models.map((m, i) => ({ "@type": "ListItem", position: i + 1, url: abs(U.model(m, lang)), name: m.name })),
  };
  const subs = v.plans.filter((p) => p.billing !== "metered").length;
  const official = v.points.some(firstParty);
  const resellers = v.channels.length - (official ? 1 : 0);
  const channelNote = !v.points.length ? t("Not yet recorded", "尚未收录") : !resellers
    ? t("official only", "仅官方")
    : zh
      ? `${official ? "官方 + " : ""}${resellers} 个第三方`
      : `${official ? "official + " : ""}${plural(resellers, "reseller")}`;
  const body = `
${answer ? `<p class="answer">${esc(answer)}</p>` : ""}
${overview(
  t("Overview", "概览"),
  [
    [t("Lowest real price", "最低真实单价"), best ? `${usd(best.cheapest.real_usd_per_mtok)}<span class="unit">/MTok</span>` : v.points.some(unmetered) ? "≈$0" : null, best ? esc(best.name) : v.points.some(unmetered) ? t("unmetered", "不计额度") : t("Not yet recorded", "尚未收录")],
    [t("Models", "模型数"), String(n), zh ? `${scored} 个有榜单成绩` : `${scored} with leaderboard scores`],
    [t("Plans & APIs", "套餐与 API"), String(v.plans.length), zh ? `${subs} 个订阅 · ${v.plans.length - subs} 个按量 API` : `${plural(subs, "subscription")} · ${plural(v.plans.length - subs, "metered API")}`],
    [t("Providers", "供应商数"), String(v.channels.length), channelNote],
  ],
  [
    ...(zh && v.zhName ? [["中文名", esc(v.zhName)]] : []),
    [t("Website", "官网"), v.url ? ext(v.url, v.url.replace(/^https?:\/\//, "")) : null],
    [t("Providers", "供应商"), join(v.channels.map((ch) => providerLink(ch, lang)), lang)],
  ],
)}
<section aria-labelledby="models"><h2 id="models">${t(n === 1 ? `${isOther ? "The" : v.name} model` : `All ${isOther ? "" : v.name + " "}models`, n === 1 ? `${vName} 模型` : `${vName} 全部模型`)}</h2>
${table(
  t(
    n === 1 ? `${isOther ? "Model" : v.name + " model"} by lowest real price` : `${isOther ? "Models" : v.name + " models"} by lowest real price`,
    `${vName} 模型，按最低真实单价排序`,
  ),
  [t("Model", "模型"), t("Lowest real $/MTok", "最低真实单价 $/MTok"), t("Cheapest plan", "最便宜的套餐"), t("API list (reference mix)", "API 标价（参考负载）"), t("API in / out per MTok", "API 输入 / 输出（每 MTok）"), t("Most monthly tokens", "最多月额度"), t("Plans", "套餐数"), t("Score", "分数")],
  rows,
  {
    column: 1, direction: "ascending",
    types: ["text", "number", "text", "number", "number", "number", "number", null],
    defaultDirections: ["ascending", "ascending", "ascending", "ascending", "ascending", "descending", "descending", null],
    values: v.models.map((m) => [
      m.name,
      m.cheapest ? m.cheapest.real_usd_per_mtok : (m.free.length ? 0 : null),
      m.cheapest ? planName(m.cheapest, lang) : null,
      m.listBlended,
      m.apiReference?.variant.currency === "USD" ? m.apiReference.prices.input : null,
      m.mostTokens ? m.mostTokens.monthly_tokens : null,
      m.points.length,
      null,
    ]),
  },
)}
</section>
${v.points.length ? `<section aria-labelledby="plans"><h2 id="plans">${t(`Plans that include ${isOther ? (n === 1 ? "this model" : "these models") : `${v.name} ${n === 1 ? "model" : "models"}`}`, `包含 ${vName} 模型的套餐`)}</h2>
${table(
  t("Subscriptions and APIs, by monthly fee", "订阅与 API，按月费排序"),
  [t("Plan", "套餐"), t("Provider", "供应商"), t("Billing", "计费"), t("Monthly fee", "月费"), t("Models", "模型")],
  planRows,
  {
    column: 3, direction: "ascending",
    types: ["text", "text", "text", "number", null],
    defaultDirections: ["ascending", "ascending", "ascending", "ascending", null],
    values: sortedPlans.map((p) => [planName(p, lang), p.channel, billingLabel(p, lang), p.price_usd, null]),
  },
)}</section>` : `<p class="note">${t("Subscription pricing has not yet been recorded.", "订阅价格尚未收录。")}</p>`}
${makerComparisons.length ? `<section aria-labelledby="compare"><h2 id="compare">${t("Related comparisons", "相关对比")}</h2>${chips(makerComparisons.map((c) => compareLink(c, lang)))}${moreLink(U.compares(lang), t("All comparisons", "全部对比"))}</section>` : ""}
${relatedNews(newsFor.maker(v), lang)}
${v.points.length ? `<p><a class="button" href="${
  // The explorer filters by the raw vendor field, which lumps some makers under "other".
  v.models.length === 1 || new Set(v.points.map((p) => p.vendor)).has("other")
    ? lockLink(v.models[0], lang)
    : U.explorer(lang, `&vendors=${encodeURIComponent(v.points[0].vendor)}`)
}">${t("Open in the interactive explorer", "在交互式图表中查看")}<span class="arrow" aria-hidden="true">→</span></a></p>` : ""}`;
  const h1 = isOther
    ? t("Other model makers: models & real pricing", "其他厂商：模型与真实价格")
    : zh
      ? `${vName}：模型与真实价格`
      : `${v.name} ${n === 1 ? "model" : "models"} & real pricing`;
  const makerModified = latest(...v.models.map((m) => m.modified), ...newsFor.maker(v).map((a) => isoDay(a.updated)));
  return page({
    section: "makers",
    lang,
    path: U.maker(v, lang),
    alt: U.maker(v, zh ? "en" : "zh"),
    title,
    description,
    keywords: [vName, ...(v.zhName ? [v.zhName] : []), ...(v.alt ?? []), `${vName} ${t("pricing", "价格")}`, `${vName} API ${t("price", "价格")}`, ...modelNames, t("AI subscription", "AI 订阅"), t("cost per million tokens", "每百万 token 价格")],
    kicker: `${t("Maker", "厂商")} · ${zh ? `${n} 个模型` : plural(n, "model")}`,
    h1,
    lead: esc(
      n === 1
        ? zh
          ? `${vName}${v.zhName ? `（${v.zhName}）` : ""}的 ${v.models[0].name} 模型：在各订阅与 API 中的真实单价、月额度与官方标价。`
          : `The ${isOther ? "" : v.name + " "}model we track — ${v.models[0].name} — with its real per-token price across subscriptions and APIs, monthly allowance and official list price.`
        : zh
          ? `${vName}${v.zhName ? `（${v.zhName}）` : ""}的全部 ${n} 个模型：每个模型在各订阅与 API 中的真实单价、月额度与官方标价。`
          : `Every ${isOther ? "" : v.name + " "}model we track — ${n} in total — with its real per-token price across subscriptions and APIs, monthly allowance and official list price.`,
    ),
    body,
    crumbs: [
      [NAME[lang], U.home(lang)],
      [t("Makers", "厂商"), U.makers(lang)],
      [vName, U.maker(v, lang)],
    ],
    graph: { modified: makerModified, about: { "@id": org["@id"] }, mainEntity: { "@id": list["@id"] }, extra: [org, list] },
    fingerprint: {
      title,
      description,
      h1,
      models: v.models.map((m) => [m.id, m.cheapest?.real_usd_per_mtok ?? null, m.listBlended, m.points.length, m.benchmarks.length]),
      plans: v.plans.map((p) => [p.plan_id, p.price_usd]),
      comparisons: makerComparisons.map((c) => U.compare(c, lang)),
      news: newsFor.maker(v).map((a) => [a.slug, a.updated]),
    },
  });
}

// ---------------------------------------------------------------------------
// Provider page: every plan tier and the models it includes.
// ---------------------------------------------------------------------------
function providerPage(pr, lang) {
  const zh = lang === "zh";
  const priceUpdated = latest(...pr.points.map((p) => isoDay(p.data_date)));
  const providerModified = latest(
    priceUpdated,
    ...(data.codingPlanReviews ?? []).filter((r) => r.channel === pr.name).map((r) => isoDay(r.checkedAt)),
    ...newsFor.provider(pr).map((a) => isoDay(a.updated)),
  );
  const t = (en, cn) => (zh ? cn : en);
  const nTiers = pr.tierList.length;
  const nModels = pr.models.length;
  const subs = pr.tierList.filter((x) => x.billing !== "metered");
  const fees = feeRange(subs.map((x) => x.feePoint));
  const c = pr.cheapest;
  const answer = zh
    ? `截至 ${priceUpdated}，${pr.name} 共有 ${nTiers} 个套餐${fees ? `（月费 ${fees}）` : ""}，包含 ${pr.makers.length} 家厂商的 ${nModels} 个模型。${c ? `真实单价最低的是「${planName(c, lang)}」中的 ${models.get(c.model).name}，约 ${usd(c.real_usd_per_mtok)} / 百万 token。` : ""}`
    : `As of ${priceUpdated}, ${pr.name} offers ${plural(nTiers, "plan")}${fees ? ` (${fees} a month)` : ""} covering ${plural(nModels, "model")} from ${plural(pr.makers.length, "maker")}.${c ? ` The lowest real price is ${models.get(c.model).name} on ${planName(c, lang)} at about ${usd(c.real_usd_per_mtok)} per million tokens.` : ""}`;
  const title = zh
    ? `${pr.name} 套餐与真实单价`
    : `${pr.name} Plans & Real Cost per Token`;
  const providerComparisons = comparisons.filter((c) => c.plans.some((r) => r.a.channel === pr.name));
  const description = clip(
    zh
      ? `对比 ${pr.name} 全部 ${nTiers} 个套餐与 API 档位${fees ? `（月费 ${fees}）` : ""}，覆盖 ${pr.makers.length} 家厂商的 ${nModels} 个 AI 模型${c ? `，真实单价低至 ${usd(c.real_usd_per_mtok)}/百万 token` : ""}。在 Tokenews 逐档查看各套餐包含的模型、每月实际可用 token 额度、官方 API 标价对比、数据日期、置信度与可追溯原始计算依据。`
      : `Compare all ${plural(nTiers, "plan")} from ${pr.name}${fees ? ` (${fees}/mo)` : ""} covering ${plural(nModels, "AI model")} across ${plural(pr.makers.length, "maker")}${c ? `, with real costs from ${usd(c.real_usd_per_mtok)}/MTok` : ""}. Inspect included models, monthly token limits, official API price ratios, data dates and sources.`,
    lang,
  );
  const overviewRows = pr.tierList.map((tier) => {
    const best = tier.cheapest;
    return [
      `<a href="#${planAnchor(tier.id)}">${esc(tier.name(lang))}</a>`,
      billingLabel(tier.feePoint, lang),
      feeCell(tier.feePoint, lang),
      String(new Set(tier.points.map((p) => p.model)).size),
      best ? `<strong>${usd(best.real_usd_per_mtok)}</strong> <small>${esc(models.get(best.model).name)}</small>` : realCell(tier.points[0], lang),
    ];
  });
  const tierSections = pr.tierList
    .map((tier) => {
      const name = tier.name(lang);
      const rows = tier.points.map((p) => {
        const m = models.get(p.model);
        const pool = planName(p, lang);
        return [
          `${modelLink(m, lang)}${pool !== name ? `<small>${esc(pool)}</small>` : ""}`,
          makerLink(makers.get(m.maker), lang),
          tokens(p, lang),
          realCell(p, lang),
          vsList(p),
          conf(p.confidence, lang),
          renderDate(p.data_date),
          `<a class="action" href="${U.evidence(p, lang)}" aria-label="${esc(t(`Evidence for ${m.name} on ${name}`, `${m.name} 在 ${name} 的依据`))}">${t("Evidence", "依据")}<span class="arrow" aria-hidden="true">→</span></a>`,
        ];
      });
      const aliasSpans = tier.aliasIds.map((aid) => `<span id="${planAnchor(aid)}"></span>`).join("");
      return `<section class="plan" id="${planAnchor(tier.id)}" aria-labelledby="${planAnchor(tier.id)}-h">${aliasSpans}<h3 id="${planAnchor(tier.id)}-h">${esc(name)} <span class="plan-fee">${tier.feePoint.price_usd != null ? `${esc(fee(tier.feePoint))}${t("/mo", "/月")}` : billingLabel(tier.feePoint, lang)}</span></h3>
${table(
  t(`Models included in ${name}, cheapest first`, `「${name}」包含的模型，按真实单价从低到高`),
  [t("Model", "模型"), t("Maker", "厂商"), t("Monthly tokens", "月额度"), t("Real $/MTok", "真实单价 $/MTok"), t("vs API", "对比 API"), t("Confidence", "置信度"), t("Data date", "数据日期"), t("Evidence", "依据")],
  rows,
  {
    column: 3, direction: "ascending",
    types: ["text", "text", "number", "number", "number", "number", "date", null],
    defaultDirections: ["ascending", "ascending", "descending", "ascending", "descending", "descending", "descending", null],
    values: tier.points.map((p) => {
      const m = models.get(p.model);
      return [
        m.name,
        makerLabel(makers.get(m.maker), lang),
        p.monthly_tokens,
        unmetered(p) ? 0 : p.real_usd_per_mtok,
        vsListRatio(p),
        CONF_RANK[p.confidence] ?? null,
        p.data_date ?? null,
        null,
      ];
    }),
  },
)}</section>`;
    })
    .join("\n");
  const org = {
    "@type": "Organization",
    "@id": `${abs(U.provider(pr, "en"))}#org`,
    name: pr.name,
    ...(pr.url ? { url: pr.url, sameAs: [pr.url] } : {}),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: zh ? `${pr.name} 套餐` : `${pr.name} plans`,
      itemListElement: pr.tierList.map((tier) => ({
        "@type": "Offer",
        name: tier.name(lang),
        url: abs(`${U.provider(pr, lang)}#${planAnchor(tier.id)}`),
        ...(tier.feePoint.price_usd != null ? { price: tier.feePoint.price_usd, priceCurrency: "USD" } : {}),
        itemOffered: [...new Set(tier.points.map((p) => p.model))].map((id) => ({ "@id": `${abs(U.model(models.get(id), "en"))}#model` })),
      })),
    },
  };
  const body = `
<p class="answer">${esc(answer)}</p>
${overview(
  t("Overview", "概览"),
  [
    [t("Plans", "套餐数"), String(nTiers), zh ? `${subs.length} 个订阅 · ${nTiers - subs.length} 个按量 API` : `${plural(subs.length, "subscription")} · ${plural(nTiers - subs.length, "metered API")}`],
    [t("Models", "模型数"), String(nModels), zh ? `来自 ${pr.makers.length} 家厂商` : `from ${plural(pr.makers.length, "maker")}`],
    [t("Monthly fee", "月费"), fees, subs.length ? t("subscriptions", "订阅") : null],
    [t("Lowest real price", "最低真实单价"), c ? `${usd(c.real_usd_per_mtok)}<span class="unit">/MTok</span>` : pr.points.some(unmetered) ? "≈$0" : null, c ? esc(models.get(c.model).name) : t("unmetered", "不计额度")],
  ],
  [
    [t("Type", "类型"), kindLabel(pr, lang)],
    [t("Makers", "厂商"), join(pr.makers.map((v) => makerLink(v, lang)), lang)],
    [t("Website", "官网"), pr.url ? ext(pr.url, pr.url.replace(/^https?:\/\//, "")) : null],
  ],
)}
<section aria-labelledby="tiers"><h2 id="tiers">${t(`${pr.name} plans at a glance`, `${pr.name} 套餐一览`)}</h2>
${table(
  t("Plans by monthly fee", "套餐，按月费排序"),
  [t("Plan", "套餐"), t("Billing", "计费"), t("Monthly fee", "月费"), t("Models", "模型数"), t("Lowest real $/MTok", "最低真实单价 $/MTok")],
  overviewRows,
  {
    column: null, direction: "ascending",
    types: ["text", "text", "number", "number", "number"],
    defaultDirections: ["ascending", "ascending", "ascending", "descending", "ascending"],
    values: pr.tierList.map((tier) => [
      tier.name(lang),
      billingLabel(tier.feePoint, lang),
      tier.feePoint.price_usd,
      new Set(tier.points.map((p) => p.model)).size,
      tier.cheapest ? tier.cheapest.real_usd_per_mtok : (tier.points.some(unmetered) ? 0 : null),
    ]),
  },
)}
</section>
<section aria-labelledby="included"><h2 id="included">${t("What each plan includes", "各套餐包含的模型")}</h2>
<p>${t("Real price = monthly fee ÷ tokens you can actually use in a month, per model. Allowances of different models in one plan are alternatives and must not be added up.", "真实单价 = 月费 ÷ 该模型每月实际可用 token。同一套餐内不同模型的额度为替代关系，不可相加。")}</p>
${tierSections}
</section>
${codingPlanReviews((data.codingPlanReviews ?? []).filter(r=>r.channel===pr.name), lang)}
${renderToStaticMarkup(createElement(CodingPlanWatch, {data,lang,channel:pr.name}))}
${providerComparisons.length ? `<section aria-labelledby="compare"><h2 id="compare">${t("Related comparisons", "相关对比")}</h2>${chips(providerComparisons.map((c) => compareLink(c, lang)))}${moreLink(U.compares(lang), t("All comparisons", "全部对比"))}</section>` : ""}
${relatedNews(newsFor.provider(pr), lang)}
<p><a class="button" href="${U.explorer(lang, `&channels=${encodeURIComponent(pr.name)}`)}">${t("Open in the interactive explorer", "在交互式图表中查看")}<span class="arrow" aria-hidden="true">→</span></a></p>`;
  const h1 = zh ? `${pr.name}：套餐与包含的模型` : `${pr.name} plans & included models`;
  return page({
    section: "providers",
    lang,
    path: U.provider(pr, lang),
    alt: U.provider(pr, zh ? "en" : "zh"),
    title,
    description,
    keywords: [pr.name, `${pr.name} ${t("pricing", "价格")}`, `${pr.name} ${t("plans", "套餐")}`, ...subs.map((x) => x.name(lang)), ...pr.models.slice(0, 10).map((m) => m.name), t("AI coding plan", "AI 编程套餐"), t("cost per million tokens", "每百万 token 价格")],
    kicker: `${t("Provider", "供应商")} · ${zh ? `${nTiers} 个套餐` : plural(nTiers, "plan")}`,
    h1,
    lead: esc(
      zh
        ? `${pr.name} 的 ${nTiers} 个套餐分别包含哪些模型，每个模型每月能用多少 token、真实单价多少。`
        : `Every ${pr.name} plan, the models each one includes, and how many tokens of each model a month really buys.`,
    ),
    body,
    crumbs: [
      [NAME[lang], U.home(lang)],
      [t("Providers", "供应商"), U.providers(lang)],
      [pr.name, U.provider(pr, lang)],
    ],
    graph: { modified: providerModified, about: { "@id": org["@id"] }, mainEntity: { "@id": org["@id"] }, extra: [org] },
    fingerprint: {
      title,
      description,
      h1,
      tiers: pr.tierList.map((tier) => [tier.id, tier.feePoint.price_usd, tier.points.map((p) => [p.id, p.model, p.monthly_tokens, p.real_usd_per_mtok, p.data_date])]),
      reviews: (data.codingPlanReviews ?? []).filter((r) => r.channel === pr.name).map((r) => [r.checkedAt, r.note[lang]]),
      comparisons: providerComparisons.map((c) => U.compare(c, lang)),
      news: newsFor.provider(pr).map((a) => [a.slug, a.updated]),
    },
  });
}

// ---------------------------------------------------------------------------
// Comparison page: two models on the plans that serve both and on the
// leaderboards that score both — the facts neither model page states.
// ---------------------------------------------------------------------------
const times = (r, lang) => r < 1.01 ? "&lt;1.01×" : `${fmt(r, lang, r >= 10 ? 1 : 2)}×`;
const realLink = (p, lang) => `<a href="${U.evidence(p, lang)}">${unmetered(p) ? "≈$0" : `<strong>${usd(p.real_usd_per_mtok)}</strong>`}</a>`;
const selectLink = (ms, lang) => U.explorer(lang, ms.flatMap((m) => m.points).map((p) => `sel=${encodeURIComponent(p.id)}`).join("&"));
const workloadName = (p, lang) => ({
  standard: ["Standard workload", "标准负载"],
  anthropic: ["Anthropic workload", "Anthropic 负载"],
  lowCache: ["Low-cache workload", "低缓存负载"],
  gemini: ["Gemini workload", "Gemini 负载"],
  cacheWrite: ["Cache-write workload", "缓存写入负载"],
}[p.workload]?.[lang === "zh" ? 1 : 0] ?? (lang === "zh" ? "未归一化" : "Not normalized"));

function comparePage(c, lang) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const { a, b, plans, boards } = c;
  const side = (s) => (s === "a" ? a : b);
  const [va, vb] = [makers.get(a.maker), makers.get(b.maker)];
  const name = compareName(c);
  const n = plans.length;
  const k = boards.length;

  const q = c.comparablePlans.length;
  const ties = q - c.plansWon.a - c.plansWon.b;
  const priceSentence = zh
    ? `截至 ${updated}，${n} 个共同订阅套餐中有 ${q} 个使用相同的已归一化负载：${a.name} 的记录单价在 ${c.plansWon.a} 个中较低，${b.name} 在 ${c.plansWon.b} 个中较低，${ties} 个持平。`
    : `As of ${updated}, ${q} of ${n} shared subscriptions use matching normalized workloads: ${a.name} has a lower recorded token cost on ${c.plansWon.a}, ${b.name} on ${c.plansWon.b}, with ${ties} tied.`;
  // The broadest leaderboard both are on, as one citable head-to-head figure.
  const lead = boards.find((r) => r.board === "aa_intelligence_index_v5_0_1") ?? boards[0];
  const boardSentence = zh
    ? `${boardName(lead.board, lang)}上两者最高存档配置的成绩分别为 ${fmt(lead.a.best.score, lang, 2)} 和 ${fmt(lead.b.best.score, lang, 2)}；下表保留全部 ${k} 个共同榜单的配置与来源。`
    : `Their highest archived configurations score ${fmt(lead.a.best.score, lang, 2)} and ${fmt(lead.b.best.score, lang, 2)} on ${boardName(lead.board, lang)}; all ${k} shared leaderboard snapshots, configurations and sources appear below.`;

  const title = zh ? `${name} 价格与榜单对比` : `${name}: Price & Benchmarks`;
  const description = clip(
    zh
      ? `${name} 深度对比：覆盖 ${n} 个同时包含两者的共同订阅套餐（其中 ${q} 个负载口径一致，可直接比较真实每百万 token 单价）以及 ${k} 个共同独立榜单快照。在 Tokenews 逐项查看套餐月费、可用额度、官方 API 标价、最高存档评测配置、采样日期与原始证据来源。`
      : `${name}: head-to-head across ${plural(n, "shared subscription")} (${q} with matching workloads) and ${k} shared leaderboards. Compare real per-token costs, monthly allowances, official API list prices, archived benchmark configs and evidence.`,
    lang,
  );

  const priceCell = (p) => `${realLink(p, lang)}<small> /MTok</small>
<small class="block">${tokens(p, lang)} ${t("tokens/month", "token/月")}</small>
<small class="block"><a href="#basis">${workloadName(p, lang)}</a>${unmetered(p) ? ` · ${esc(unmeteredNote(p, lang))}` : ""}</small>
<small class="block">${esc(dataDateLine(p, lang) || t("Date unavailable", "日期未提供"))} · ${t("confidence", "置信度")} ${esc(conf(p.confidence, lang))}${p.quota_is_estimated ? ` · ${t("estimate", "估算")}` : ""}</small>`;
  const priceResult = (win) => {
    if (win.reason !== "comparable") return ({
      raw: t("Unnormalized records", "未归一化记录"),
      workload: t("Different workloads", "负载口径不同"),
      unmetered: t("Unmetered access; no token ratio", "含不计额度渠道，不计算倍数"),
      invalid: t("No comparable token price", "缺少可比单价"),
    })[win.reason];
    return win.side
      ? `${esc(side(win.side).name)} ${t("lower", "较低")}<small class="block">${times(win.ratio, lang)} ${t("price ratio (higher/lower)", "单价比（高/低）")}</small>`
      : t("Equal recorded cost", "记录单价相同");
  };
  const canonicalPlanPoint = (pa, pb) => (pa.quota_is_estimated && !pb.quota_is_estimated ? pb : pa);
  const planRows = plans.map(({ a: pa, b: pb, win }) => {
    const planPoint = canonicalPlanPoint(pa, pb);
    return [
      `${planLink(planPoint, lang)}<small class="block">${providerLink(planPoint.channel, lang)}</small>`,
      feeCell(planPoint, lang),
      priceCell(pa),
      priceCell(pb),
      priceResult(win),
    ];
  });
  const scoreCell = (x) => {
    const v = x.best;
    const source = safeUrl(v.archive_url ?? "") ?? safeUrl(firstUrl(v.source) ?? "");
    return `<strong>${fmt(v.score, lang, 2)}</strong>${v.score_is_self_reported ? ` <small>${t("self-reported", "厂商自报")}</small>` : ""}${v.score_is_estimated ? ` <small>${t("estimate", "估计值")}</small>` : ""}${currentScoreFlags(v, lang)}
<small class="block">#${x.rank} / ${x.of} · ${esc(variantLabel(v.board_label ?? v.variant, lang))}</small>
<small class="block">${esc([v.agent_harness, effortLabel(v.reasoning_effort, lang), v.service_mode].filter(Boolean).join(" · ")) || t("Configuration details unavailable", "配置细节未提供")}</small>
${v.score_low != null && v.score_high != null ? `<small class="block">${t("Reported interval", "来源分数区间")} ${fmt(v.score_low, lang, 2)}–${fmt(v.score_high, lang, 2)}</small>` : ""}
<small class="block">${esc(v.checked_at ?? data.boards[v.board].snapshot)}${source ? ` · ${ext(source, t("Record", "存档依据"))}` : ""}</small>`;
  };
  const boardRows = boards.map((r) => [
    ext(data.boards[r.board].url, boardName(r.board, lang)),
    esc(metricName(r.board, lang)),
    scoreCell(r.a),
    scoreCell(r.b),
    r.win.side ? `${esc(side(r.win.side).name)}<small class="block">${r.win.diff < 0.01 ? "&lt;0.01" : `+${fmt(r.win.diff, lang, 2)}`}</small>` : t("Equal score", "分数相同"),
  ]);
  const lists = [a, b];
  const pricedModels = lists.filter((m) => m.apiReference).length;
  const others = comparisons.filter((x) => x !== c && (x.a === a || x.b === a || x.a === b || x.b === b));
  const cmpNews = news.filter((x) => x.models.includes(a.id) || x.models.includes(b.id));

  const body = `
<p class="answer">${esc(priceSentence)} ${esc(boardSentence)}</p>
${overview(
  t("Overview", "概览"),
  [
    [t("Shared subscriptions", "共同订阅套餐"), String(n), t("Both models available", "两者均可使用")],
    [t("Comparable workloads", "同口径套餐"), String(q), t("Used for price ratios", "仅这些记录计算单价比")],
    [t("Shared leaderboards", "共同榜单"), String(k), t("Highest archived configurations", "各取最高存档配置")],
    [t("Official API prices", "官方 API 标价"), `${pricedModels} <span class="unit">/ 2</span>`, t("Models with list prices", "有标价的模型数")],
  ],
  [
    [t("Makers", "厂商"), va === vb ? makerLink(va, lang) : `${makerLink(va, lang)} · ${makerLink(vb, lang)}`],
    [t("Model pages", "模型页面"), `${modelLink(a, lang)} · ${modelLink(b, lang)}`],
    [t("Model IDs", "模型 ID"), `<code>${esc(a.id)}</code> · <code>${esc(b.id)}</code>`],
    [t("Comparison method", "比较方法"), link("#basis", t("Workloads, shared quotas and benchmark limits", "负载、共享额度与评测限制"))],
  ],
)}
<p><a class="button" href="${selectLink([a, b], lang)}">${t(`Plot both on the price–capability chart`, `在价格–能力图中查看两者`)}<span class="arrow" aria-hidden="true">→</span></a></p>
<section aria-labelledby="plans"><h2 id="plans">${t("Same plan, side by side", "同一套餐，逐个对比")}</h2>
<p>${t(
  "Each row is a subscription that includes both models at the same fee. Real cost = monthly fee ÷ the recorded monthly allowance. Each model's allowance assumes using the plan for that model; the columns cannot be added together. Click a price for its calculation and sources. Ratios use only matching normalized workloads.",
  "每行是以相同月费提供两个模型的订阅套餐。真实单价 = 月费 ÷ 记录的月额度。两列额度分别按使用对应模型估算，不能相加；实际共享额度与限流以套餐规则为准。点击单价查看计算与来源。仅负载口径一致的归一化记录计算单价比。",
)}</p>
${table(
  t(`Plans that include both ${a.name} and ${b.name}`, `同时包含 ${a.name} 和 ${b.name} 的套餐`),
  [t("Plan / provider", "套餐 / 供应商"), t("Monthly fee", "月费"), esc(a.name), esc(b.name), t("Recorded token cost", "记录单价对比")],
  planRows,
  {
    column: 1, direction: "ascending",
    types: ["text", "number", "number", "number", null],
    defaultDirections: ["ascending", "ascending", "ascending", "ascending", null],
    values: plans.map(({ a: pa, b: pb }) => {
      const planPoint = canonicalPlanPoint(pa, pb);
      return [
        planName(planPoint, lang),
        planPoint.price_usd,
        unmetered(pa) ? 0 : pa.real_usd_per_mtok,
        unmetered(pb) ? 0 : pb.real_usd_per_mtok,
        null,
      ];
    }),
  },
)}</section>
<section aria-labelledby="bench"><h2 id="bench">${t("Leaderboards head to head", "榜单成绩对比")}</h2>
<p>${t(
  "Each model's highest archived configuration on each shared leaderboard snapshot, ranked among the models archived in this dataset. Harness, reasoning effort and service mode can differ; self-reported and estimated results are marked. These reference configurations are not measurements of the subscriptions above. Overlapping leaderboards do not form an overall ability rating.",
  "每个共同榜单快照中，各取已归档的最高配置；排名范围是本数据集在该榜单存档的模型。框架、推理强度与服务模式可能不同，自报和估计值会单独标注。这些参考配置并非上方订阅套餐的实测结果；相互重叠的榜单不能合成整体能力评分。",
)}</p>
${table(
  t(`${name} on independent leaderboards`, `${name} 在独立榜单上的成绩`),
  [t("Leaderboard", "榜单"), t("Metric", "指标"), esc(a.name), esc(b.name), t("Higher archived score", "较高存档成绩")],
  boardRows,
)}</section>
<section aria-labelledby="list"><h2 id="list">${t("Official API pricing", "官方 API 定价")}</h2>
<p>${t("Each row uses its listed pricing conditions. Cache writes are shown separately; subscription costs above retain their recorded quota basis. An em dash means that rate is not recorded.", "各行价格适用于该行列明的条件。缓存写入费单独展示；上方订阅成本沿用其记录的额度口径。— 表示该项价格尚未收录。")}</p>
${table(
  t("List price per million tokens", "每百万 token 标价"),
  [t("Model / pricing conditions", "模型 / 定价条件"), t("Cached input", "缓存读"), t("Input", "输入"), t("Cache write", "缓存写"), t("Output", "输出")],
  lists.map((m) => {
    const ref = m.apiReference;
    const lp = listPrice(ref?.prices);
    const evidence = ref?.source
      ? `${ext(ref.source, t("Official source", "官方来源"))} · ${t("Checked", "核实于")} <time class="nw" datetime="${esc(ref.checkedAt)}">${esc(ref.checkedAt)}</time>`
      : lp ? link(U.evidence(m.listPoint, lang), t("Upstream price reference", "上游价格参考"))
        : t("Official API list price not recorded", "当前数据未收录官方 API 标价");
    return [`${modelLink(m, lang)}${ref ? `<small class="block">${esc(apiPriceScope(ref.variant, lang))}</small>` : ""}<small class="block">${evidence}</small>${ref?.origin === "maintained" ? `<small class="block">${link(`${U.model(m, lang)}#list`, t("All pricing tiers", "全部价格档位"))}</small>` : ""}`, lp?.cached ?? "—", lp?.input ?? "—", ref ? formatApiAmount(ref.variant.rates.cacheWrite, ref.variant.currency) : "—", lp?.output ?? "—"];
  }),
)}</section>
<section aria-labelledby="basis"><h2 id="basis">${t("How to read this comparison", "如何理解这些对比")}</h2>
<p>${t(
  "Price ratios compare recorded USD/MTok under the same known workload. Raw measured totals, different workloads and unmetered access remain visible but are excluded from the lower-cost counts. Recorded allowances assume using the quota; your effective cost depends on utilization, cache mix, output mix and plan limits. Qualitative confidence is not an error bar.",
  "单价比仅比较相同已知负载下记录的 USD/MTok。原始实测总量、不同负载和不计额度渠道仍展示，但不计入单价较低的套餐数。额度折算假设使用相应额度；实际成本取决于使用率、缓存与输出比例及套餐限制。定性置信度不等于数值误差条。",
)}</p>
<ul class="note">${[...new Map(plans.flatMap((r) => [r.a, r.b]).map((p) => [p.workload ?? "", p])).values()].map((p) => `<li>${esc(workloadLine(p, data.conventions, lang))}</li>`).join("")}</ul>
${moreLink(U.method(lang), t("Methodology and sources", "方法与来源"))}</section>
${relatedNews(cmpNews, lang)}
${
  others.length
    ? `<section aria-labelledby="more"><h2 id="more">${t("More comparisons", "更多对比")}</h2>${chips(others.map((x) => compareLink(x, lang)))}${moreLink(U.compares(lang), t("All comparisons", "全部对比"))}</section>`
    : ""
}`;
  const h1 = zh ? `${name}：价格、额度与榜单对比` : `${name}: pricing, allowances and benchmarks`;
  return page({
    section: "compare",
    lang,
    path: U.compare(c, lang),
    alt: U.compare(c, zh ? "en" : "zh"),
    title,
    description,
    keywords: [name, `${b.name} vs ${a.name}`, a.name, b.name, a.id, b.id, t(`${a.name} or ${b.name}`, `${a.name} 和 ${b.name} 哪个好`), t("AI model comparison", "AI 模型对比"), t("cost per million tokens", "每百万 token 价格")],
    kicker: `${t("Comparison", "对比")} · ${va === vb ? makerLink(va, lang) : `${makerLink(va, lang)} vs ${makerLink(vb, lang)}`}`,
    h1,
    lead: esc(
      zh
        ? `${a.name}（${makerLabel(va, lang)}）与 ${b.name}（${makerLabel(vb, lang)}）的 ${n} 个共同订阅套餐和 ${k} 个共同榜单快照，保留负载口径、采样日期与评测配置。`
        : `${a.name} (${makerLabel(va, lang)}) and ${b.name} (${makerLabel(vb, lang)}): ${plural(n, "shared subscription")} and ${plural(k, "shared leaderboard snapshot")}, with workloads, sample dates and benchmark configurations.`,
    ),
    body,
    ogType: "article",
    crumbs: [
      [NAME[lang], U.home(lang)],
      [t("Comparisons", "模型对比"), U.compares(lang)],
      [name, U.compare(c, lang)],
    ],
    graph: { modified: latest(a.modified, b.modified, ...cmpNews.map((x) => isoDay(x.updated))), about: [a, b].map((m) => ({ "@id": `${abs(U.model(m, "en"))}#model` })) },
    fingerprint: {
      title,
      description,
      h1,
      plans: c.plans.map(({ a: pa, b: pb, win }) => [pa.id, pa.real_usd_per_mtok, pa.monthly_tokens, pb.id, pb.real_usd_per_mtok, pb.monthly_tokens, win]),
      boards: c.boards.map((r) => [r.board, r.a.best.score, r.a.rank, r.b.best.score, r.b.rank, r.win]),
      api: [c.a.apiReference?.checkedAt ?? null, c.b.apiReference?.checkedAt ?? null],
      news: cmpNews.map((x) => [x.slug, x.updated]),
    },
  });
}

// ---------------------------------------------------------------------------
// News: the list, one page per article (English only) and the RSS feed.
// ---------------------------------------------------------------------------
const chips = (items) => (items.length ? `<ul class="chips">${items.map((x) => `<li>${x}</li>`).join("")}</ul>` : "");
const articleChips = (a) =>
  chips([
    ...a.makers.map((n) => makerLink(makers.get(n), "en")),
    ...a.models.map((id) => modelLink(models.get(id), "en")),
    ...a.providers.map((n) => providerLink(n, "en")),
  ]);

// An article's cover for cards: the WebP in its widths, sized to `sizes`.
const coverImg = (a, sizes, eager = false) =>
  a.cover
    ? `<img src="${esc(a.cover.url)}"${
        a.cover.sizes.length ? ` srcset="${[...a.cover.sizes.map((v) => `${esc(v.url)} ${v.width}w`), `${esc(a.cover.url)} ${a.cover.width}w`].join(", ")}" sizes="${sizes}"` : ""
      } alt=""${a.cover.width ? ` width="${a.cover.width}" height="${a.cover.height}"` : ""}${eager ? "" : ' loading="lazy"'} decoding="async">`
    : "";
const readMeta = (a, lang) => `<time datetime="${a.date}">${formatDay(a.date, lang)}</time> · ${a.minutes} min read`;
// One article on the news index; the whole card is the title's link.
const newsCard = (a, featured) => `<article class="news-card${featured ? " featured" : ""}${a.cover ? "" : " no-cover"}">${
  a.cover
    ? `<div class="news-cover">${coverImg(a, featured ? "(min-width: 900px) 640px, 100vw" : "(min-width: 900px) 420px, 100vw", featured)}</div>`
    : featured
      ? ""
      : `<div class="news-cover placeholder" aria-hidden="true"><span>#${esc(a.tags[0] ?? "news")}</span></div>`
}<div class="news-card-body"><p class="kicker">${readMeta(a, "en")}</p><h2><a href="${U.article(a)}">${esc(a.title)}</a></h2><p>${esc(a.summary)}</p>${articleChips(a)}</div></article>`;

function newsIndex() {
  const lang = "en";
  const list = {
    "@type": "ItemList",
    "@id": `${abs(U.news())}#list`,
    numberOfItems: news.length,
    itemListElement: news.map((a, i) => ({ "@type": "ListItem", position: i + 1, url: abs(U.article(a)), name: a.title })),
  };
  const description = clip(
    `AI news from ${SITE_NAME}: model releases, subscription and API price changes, and leaderboard updates, each linked to real per-token prices and model pages.`,
    lang,
  );
  return page({
    lang,
    section: "news",
    path: U.news(),
    alt: null,
    title: "AI News: Models, Makers and Products",
    description,
    keywords: ["AI news", "LLM news", "AI model releases", "AI pricing news", "coding plan news", SITE_NAME],
    kicker: "Directory · news",
    h1: "AI news",
    lead: esc("Releases, price and plan changes, and leaderboard moves across AI models, makers and products — each linked to the model, maker and provider pages it concerns."),
    byline: `<a href="${U.feed()}">RSS feed</a> · ${news.length ? `${plural(news.length, "article")}, latest ${formatDay(news[0].date, lang)}` : "No articles yet"}`,
    body: news.length
      ? `<div class="news-index">${newsCard(news[0], true)}${news.length > 1 ? `<div class="news-grid">${news.slice(1).map((a) => newsCard(a, false)).join("")}</div>` : ""}</div>`
      : `<p>No articles yet. New ones appear here and in the <a href="${U.feed()}">RSS feed</a>.</p>`,
    crumbs: [
      [NAME[lang], U.home(lang)],
      ["News", U.news()],
    ],
    graph: { modified: news[0]?.updated ?? updated, mainEntity: { "@id": list["@id"] }, extra: [list] },
    fingerprint: {
      title: "AI News: Models, Makers and Products",
      description,
      items: news.map((a) => [a.slug, a.date, a.updated, a.title, a.summary]),
    },
  });
}

function newsArticle(a) {
  const lang = "en";
  const url = abs(U.article(a));
  const mentioned = a.models.map((id) => models.get(id));
  const others = news.filter((x) => x !== a).slice(0, 5);
  const body = `
${articleChips(a)}
<div class="article-layout">
<div class="article-main">
<div class="prose">${a.html}</div>
${
  a.sources.length
    ? `<section aria-labelledby="sources"><h2 id="sources">Sources</h2><ol class="source-list">${a.sources
        .map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener" target="_blank"><span>${esc(s.title)}</span><span class="source-host">${esc(hostOf(s.url))} ↗</span></a></li>`)
        .join("")}</ol></section>`
    : ""
}
</div>
${
  a.toc.length >= 3
    ? `<aside class="article-aside"><nav class="toc" aria-labelledby="contents"><p class="kicker" id="contents">On this page</p><ol>${a.toc
        .map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`)
        .join("")}${a.sources.length ? `<li><a href="#sources">Sources</a></li>` : ""}</ol></nav></aside>`
    : ""
}
</div>
${
  mentioned.length
    ? `<section aria-labelledby="mentioned"><h2 id="mentioned">Models in this article</h2>
${table(
  `Current real prices (data updated ${updated})`,
  ["Model", "Maker", "Lowest real $/MTok", "Cheapest plan", "API list (reference mix)"],
  mentioned.map((m) => [
    modelLink(m, lang),
    makerLink(makers.get(m.maker), lang),
    m.cheapest ? `<strong>${usd(m.cheapest.real_usd_per_mtok)}</strong>` : m.free.length ? "≈$0" : "—",
    m.cheapest ? planLink(m.cheapest, lang) : "—",
    m.listBlended != null ? usd(m.listBlended) : "—",
  ]),
)}</section>`
    : ""
}
${others.length ? `<section aria-labelledby="more"><h2 id="more">More news</h2>${newsItems(others, lang)}${moreLink(U.news(), "All news")}</section>` : ""}`;
  const imgObj = a.image
    ? { "@type": "ImageObject", url: a.image.url, ...(a.image.width ? { width: a.image.width, height: a.image.height } : {}) }
    : { "@type": "ImageObject", url: abs(OG.en.path), width: 2880, height: 1928 };
  const aboutRefs = [
    ...a.makers.map((n) => ({ "@id": `${abs(U.maker(makers.get(n), "en"))}#org` })),
    ...a.models.map((id) => ({ "@id": `${abs(U.model(models.get(id), "en"))}#model` })),
    ...a.providers.map((n) => ({ "@id": `${abs(providerPagePath(n, "en"))}#org` })),
  ];
  const article = {
    "@type": "NewsArticle",
    "@id": `${url}#article`,
    headline: a.title,
    description: a.summary,
    datePublished: a.date,
    dateModified: a.updated,
    inLanguage: "en",
    url,
    mainEntityOfPage: { "@id": `${url}#webpage` },
    author: a.author ? { "@type": "Person", name: a.author } : { "@id": `${SITE}/#organization` },
    publisher: { "@id": `${SITE}/#organization` },
    image: imgObj,
    wordCount: a.wordCount,
    articleSection: "AI News",
    ...(a.tags.length ? { keywords: a.tags } : {}),
    ...(a.sources.length ? { citation: a.sources.map((s) => s.url) } : {}),
    ...(aboutRefs.length ? { about: aboutRefs } : {}),
  };
  const description = clip(a.summary, "en");
  return page({
    lang,
    section: "news",
    path: U.article(a),
    alt: null,
    title: a.title,
    description,
    keywords: [...a.tags, ...a.makers, ...a.models.map((id) => models.get(id).name), ...a.providers, "AI news"],
    kicker: `<a href="${U.news()}">News</a> · ${readMeta(a, lang)}`,
    h1: a.title,
    lead: esc(a.summary),
    byline: `By ${esc(a.author ?? SITE_NAME)}${a.updated !== a.date ? ` · updated <time datetime="${a.updated}">${formatDay(a.updated, lang)}</time>` : ""}${a.tags.map((x) => ` <span class="tag">#${esc(x)}</span>`).join("")}`,
    body,
    ogType: "article",
    published: a.date,
    tags: a.tags,
    image: a.image ? { ...a.image, alt: a.imageAlt ?? a.title } : undefined,
    crumbs: [
      [NAME[lang], U.home(lang)],
      ["News", U.news()],
      [a.title, U.article(a)],
    ],
    graph: { modified: a.updated, about: { "@id": article["@id"] }, mainEntity: { "@id": article["@id"] }, extra: [article] },
    fingerprint: {
      title: a.title,
      description,
      date: a.date,
      updated: a.updated,
      markdown: a.markdown,
      sources: a.sources,
      mentioned: a.models.map((id) => [id, models.get(id).cheapest?.real_usd_per_mtok ?? null]),
    },
  });
}

// RSS 2.0 with the full article in content:encoded.
// Feed readers resolve nothing against the site, so site-relative links become absolute.
const absolutize = (html) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${SITE}/`);
const rfc822 = (d) => new Date(`${d}T00:00:00Z`).toUTCString();
const cdata = (s) => `<![CDATA[${s.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
const feedBody = (a) =>
  absolutize(
    a.html +
      (a.sources.length
        ? `\n<h2>Sources</h2>\n<ol>${a.sources.map((s) => `<li><a href="${esc(s.url)}">${esc(s.title)}</a></li>`).join("")}</ol>`
        : ""),
  );
const newsFeed = () => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${esc(SITE_NAME)} news</title>
<link>${abs(U.news())}</link>
<atom:link href="${abs(U.feed())}" rel="self" type="application/rss+xml" />
<description>${esc(TAGLINE.en)}</description>
<language>en</language>
${news.length ? `<lastBuildDate>${rfc822(news.map((a) => a.updated).sort().at(-1))}</lastBuildDate>\n` : ""}${news
  .map(
    (a) => `<item>
<title>${esc(a.title)}</title>
<link>${abs(U.article(a))}</link>
<guid isPermaLink="true">${abs(U.article(a))}</guid>
<pubDate>${rfc822(a.date)}</pubDate>
${a.updated !== a.date ? `<atom:updated>${a.updated}T00:00:00Z</atom:updated>\n` : ""}<dc:creator>${esc(a.author ?? SITE_NAME)}</dc:creator>
<description>${esc(a.summary)}</description>
${a.tags.map((x) => `<category>${esc(x)}</category>`).join("")}
${a.image?.bytes ? `<enclosure url="${esc(a.image.url)}" length="${a.image.bytes}" type="${esc(a.image.type ?? "image/jpeg")}" />\n` : ""}<content:encoded>${cdata(feedBody(a))}</content:encoded>
</item>`,
  )
  .join("\n")}
</channel>
</rss>
`;

// ---------------------------------------------------------------------------
// Index pages.
// ---------------------------------------------------------------------------
function indexPage({ lang, section, path: [en, zh], title, description, keywords, kicker, h1, lead, caption, head, rows, items, sorting, modified }) {
  const isZh = lang === "zh";
  const t = (a, b) => (isZh ? b : a);
  const urlPath = isZh ? zh : en;
  const list = {
    "@type": "ItemList",
    "@id": `${abs(urlPath)}#list`,
    numberOfItems: items.length,
    itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, url: abs(url), name })),
  };
  return page({
    section,
    lang,
    path: urlPath,
    alt: isZh ? en : zh,
    title,
    description,
    keywords,
    kicker: `${t("Directory", "目录")} · ${esc(kicker)}`,
    h1,
    lead: esc(lead),
    body: table(caption, head, rows, sorting),
    crumbs: [
      [NAME[lang], U.home(lang)],
      [h1, urlPath],
    ],
    graph: { modified: modified ?? updated, mainEntity: { "@id": list["@id"] }, extra: [list] },
    fingerprint: { title, description, h1, rows },
  });
}

const makersIndex = (lang) => {
  const t = (en, cn) => (lang === "zh" ? cn : en);
  const sorted = [...makerList].sort(
    (a, b) => (a.name === "Other") - (b.name === "Other") || b.plans.length - a.plans.length || b.models.length - a.models.length || a.name.localeCompare(b.name),
  );
  return indexPage({
    lang,
    section: "makers",
    path: [U.makers("en"), U.makers("zh")],
    title: t(`AI Model Makers: Real Pricing (${sorted.length})`, `AI 模型厂商真实价格（${sorted.length} 家）`),
    description: clip(
      t(
        `Compare ${sorted.length} AI model makers — OpenAI, Anthropic, Google, DeepSeek, Qwen, Kimi, GLM and more — by real per-token cost across ${data.points.length} plans and APIs.`,
        `对比 OpenAI、Anthropic、Google、DeepSeek、通义千问、Kimi、智谱等 ${sorted.length} 家 AI 模型厂商，覆盖 ${modelList.length} 个模型与 ${data.points.length} 个订阅及 API 组合的真实每百万 token 单价、月额度与官方标价，支持按列排序筛选。`,
      ),
      lang,
    ),
    keywords: [t("AI model makers", "AI 模型厂商"), t("LLM pricing comparison", "大模型价格对比"), ...sorted.map((v) => makerLabel(v, lang))],
    kicker: t(plural(makers.size, "maker"), `${makers.size} 家厂商`),
    h1: t("AI model makers", "AI 模型厂商"),
    lead: t(`${sorted.length} model makers, ${modelList.length} models and ${data.points.length} plan/model combinations, each priced as monthly fee ÷ tokens you can actually use. Click a column heading to sort.`, `${sorted.length} 家厂商、${modelList.length} 个模型、${data.points.length} 个套餐/模型组合，均按「月费 ÷ 实际可用 token」计算真实单价；点击表头可切换排序。`),
    caption: t("Makers · click a column heading to sort", "厂商 · 点击表头切换排序"),
    head: [t("Maker", "厂商"), t("Models", "模型数"), t("Model list", "模型"), t("Lowest real $/MTok", "最低真实单价 $/MTok"), t("Plans", "套餐数")],
    rows: sorted.map((v) => {
      const best = v.models.find((m) => m.cheapest);
      return [
        makerLink(v, lang),
        String(v.models.length),
        join(v.models.map((m) => modelLink(m, lang)), lang),
        best ? `${usd(best.cheapest.real_usd_per_mtok)} <small>${esc(best.name)}</small>` : v.points.some(unmetered) ? "≈$0" : "—",
        String(v.plans.length),
      ];
    }),
    sorting: {
      column: 4, direction: "descending",
      types: ["text", "number", null, "number", "number"],
      defaultDirections: ["ascending", "descending", null, "ascending", "descending"],
      values: sorted.map((v) => {
        const best = v.models.find((m) => m.cheapest);
        return [makerLabel(v, lang), v.models.length, null, best ? best.cheapest.real_usd_per_mtok : (v.points.some(unmetered) ? 0 : null), v.plans.length];
      }),
    },
    items: sorted.map((v) => [makerLabel(v, lang), U.maker(v, lang)]),
    modified: latest(...makerList.flatMap((v) => v.models.map((m) => m.modified))),
  });
};

const providersIndex = (lang) => {
  const t = (en, cn) => (lang === "zh" ? cn : en);
  const sorted = [...providerList].sort((a, b) => b.models.length - a.models.length || b.tierList.length - a.tierList.length || a.name.localeCompare(b.name));
  return indexPage({
    lang,
    section: "providers",
    path: [U.providers("en"), U.providers("zh")],
    title: t(`AI Coding Plans & Providers (${sorted.length})`, `AI 编程套餐与供应商（${sorted.length} 家）`),
    description: clip(
      t(
        `Compare AI coding plans and subscriptions from ${sorted.length} providers — Cursor, Claude, ChatGPT, OpenCode, GLM and more: fees, included models and real token costs.`,
        `对比 OpenCode、Command Code、Cursor、Claude、ChatGPT、GLM 等 ${sorted.length} 家 AI 供应商的订阅套餐与按量 API：查看各档月费、包含的模型、每月实际可用 token 额度与真实每百万 token 单价，支持点击表头排序对比。`,
      ),
      lang,
    ),
    keywords: [t("AI coding plan", "AI 编程套餐"), t("AI subscription comparison", "AI 订阅对比"), ...sorted.map((p) => p.name)],
    kicker: t(plural(providers.size, "provider"), `${providers.size} 个供应商`),
    h1: t("AI providers & plans", "AI 供应商与套餐"),
    lead: t(`${sorted.length} providers sell access to these models through ${[...providers.values()].reduce((n, p) => n + p.tierList.length, 0)} plans and APIs. Each provider page lists its plan tiers and the models every tier includes. Click a column heading to sort.`, `${sorted.length} 家供应商通过 ${[...providers.values()].reduce((n, p) => n + p.tierList.length, 0)} 个套餐与 API 提供这些模型。每个供应商页面列出其各档套餐及每档包含的模型；点击表头可切换排序。`),
    caption: t("Providers · click a column heading to sort", "供应商 · 点击表头切换排序"),
    head: [t("Provider", "供应商"), t("Type", "类型"), t("Plans", "套餐数"), t("Models", "模型数"), t("Monthly fee", "月费"), t("Lowest real $/MTok", "最低真实单价 $/MTok")],
    rows: sorted.map((pr) => [
      link(U.provider(pr, lang), pr.name),
      kindLabel(pr, lang),
      String(pr.tierList.length),
      String(pr.models.length),
      feeRange(pr.tierList.filter((x) => x.billing !== "metered").map((x) => x.feePoint)) ?? "—",
      pr.cheapest ? `${usd(pr.cheapest.real_usd_per_mtok)} <small>${esc(models.get(pr.cheapest.model).name)}</small>` : "≈$0",
    ]),
    sorting: {
      column: 3, direction: "descending",
      types: ["text", "text", "number", "number", "number", "number"],
      defaultDirections: ["ascending", "ascending", "descending", "descending", "ascending", "ascending"],
      values: sorted.map((pr) => {
        const subFees = pr.tierList.filter((x) => x.billing !== "metered").map((x) => x.feePoint.price_usd).filter((x) => x != null);
        return [
          pr.name,
          kindLabel(pr, lang),
          pr.tierList.length,
          pr.models.length,
          subFees.length ? Math.min(...subFees) : null,
          pr.cheapest ? pr.cheapest.real_usd_per_mtok : (pr.points.some(unmetered) ? 0 : null),
        ];
      }),
    },
    items: sorted.map((pr) => [pr.name, U.provider(pr, lang)]),
    modified: latest(...providerList.flatMap((pr) => pr.points.map((p) => isoDay(p.data_date)))),
  });
};

const modelsIndex = (lang) => {
  const t = (en, cn) => (lang === "zh" ? cn : en);
  const sorted = [...modelList].sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.name.localeCompare(b.name));
  return indexPage({
    lang,
    section: "models",
    path: [U.models("en"), U.models("zh")],
    title: t(`AI Model Directory: ${sorted.length} Models`, `AI 模型目录（${sorted.length} 个模型）`),
    description: clip(
      t(
        `Browse ${sorted.length} AI models — GPT, Claude, Gemini, Grok, DeepSeek, Qwen, Kimi and GLM — with release dates, independent benchmarks and real cost per million tokens.`,
        `浏览 GPT、Claude、Gemini、Grok、DeepSeek、通义千问、Kimi、GLM 等全部 ${sorted.length} 个 AI 模型：集中对比发布时间、订阅套餐最低真实每百万 token 单价、官方 API 参考标价与独立榜单成绩，默认按最新模型排序。`,
      ),
      lang,
    ),
    keywords: [t("AI model prices", "AI 模型价格"), t("LLM price per million tokens", "大模型每百万 token 价格"), ...sorted.slice(0, 20).map((m) => m.name)],
    kicker: t(plural(models.size, "model"), `${models.size} 个模型`),
    h1: t("AI model directory", "AI 模型目录"),
    lead: t(`All ${sorted.length} models, including models with benchmark results whose pricing has not yet been recorded. Sorted by release date, newest first. Click a column heading to change the sort order. Missing values appear last.`, `全部 ${sorted.length} 个模型，包括已有榜单成绩、价格尚未收录的模型。默认按发布时间从新到旧排序，点击表头可切换排序；缺失值始终排在末尾。`),
    caption: t("Models · click a column heading to sort", "模型 · 点击表头切换排序"),
    head: [t("Model", "模型"), t("Maker", "厂商"), t("Release date", "发布时间"), t("Lowest real $/MTok", "最低真实单价 $/MTok"), t("Cheapest plan", "最便宜的套餐"), t("API list (reference mix)", "API 标价（参考负载）"), t("Plans", "套餐数")],
    rows: sorted.map((m) => [
      modelLink(m, lang),
      makerLink(makers.get(m.maker), lang),
      m.releaseDate ? `<time datetime="${m.releaseDate}">${m.releaseDate}</time>` : "—",
      m.cheapest ? `<strong>${usd(m.cheapest.real_usd_per_mtok)}</strong>` : m.free.length ? "≈$0" : "—",
      m.cheapest ? planLink(m.cheapest, lang) : "—",
      m.listBlended != null ? usd(m.listBlended) : "—",
      String(m.points.length),
    ]),
    sorting: {
      column: 2, direction: "descending",
      types: ["text", "text", "date", "number", "text", "number", "number"],
      defaultDirections: ["ascending", "ascending", "descending", "ascending", "ascending", "ascending", "descending"],
      values: sorted.map(m => [m.name, makerLabel(makers.get(m.maker), lang), m.releaseDate,
        m.cheapest?.real_usd_per_mtok ?? (m.free.length ? 0 : null),
        m.cheapest ? planName(m.cheapest, lang) : null, m.listBlended, m.points.length]),
    },
    items: sorted.map((m) => [m.name, U.model(m, lang)]),
    modified: latest(...modelList.map((m) => m.modified)),
  });
};

const comparesIndex = (lang) => {
  const t = (en, cn) => (lang === "zh" ? cn : en);
  return indexPage({
    lang,
    section: "compare",
    path: [U.compares("en"), U.compares("zh")],
    title: t(`AI Model Comparisons (${comparisons.length} Pairs)`, `AI 模型对比（${comparisons.length} 组）`),
    description: clip(
      t(
        `Explore ${comparisons.length} AI model comparisons — GPT-6.2 vs Gemini 4, Claude vs GPT, Kimi vs Qwen, DeepSeek vs GLM — across shared subscriptions and leaderboards.`,
        `精选 ${comparisons.length} 组热门 AI 模型深度对比，覆盖 GPT-6.2 对 Gemini 4、Claude 对 GPT、Kimi 对通义千问、DeepSeek 对 GLM 等组合：在共同订阅套餐的同口径负载与共同独立榜单上逐项比较真实每百万 token 单价、可用额度、榜单分数与可追溯来源。`,
      ),
      lang,
    ),
    keywords: [t("AI model comparison", "AI 模型对比"), t("LLM comparison", "大模型对比"), ...comparisons.map(compareName)],
    kicker: t(plural(comparisons.length, "comparison"), `${comparisons.length} 组对比`),
    h1: t("AI model comparisons", "AI 模型对比"),
    lead: t(
      "Curated model pairs with shared subscriptions and leaderboard snapshots. Compare token costs under matching workloads, inspect the recorded allowances, and follow each benchmark's configuration and evidence. Click a column heading to sort.",
      "精选具有共同订阅套餐和榜单快照的模型组合：在相同负载下比较单价，查看记录的额度，并追溯每项成绩的配置与证据；点击表头可切换排序。",
    ),
    caption: t("Comparisons · click a column heading to sort", "全部对比 · 点击表头切换排序"),
    head: [t("Comparison", "对比"), t("Makers", "厂商"), t("Shared subscriptions", "共同订阅"), t("Matching workloads", "同口径套餐"), t("Shared leaderboards", "共同榜单")],
    rows: comparisons.map((c) => [
      compareLink(c, lang),
      c.a.maker === c.b.maker ? makerLink(makers.get(c.a.maker), lang) : `${makerLink(makers.get(c.a.maker), lang)} · ${makerLink(makers.get(c.b.maker), lang)}`,
      String(c.plans.length),
      String(c.comparablePlans.length),
      String(c.boards.length),
    ]),
    sorting: {
      column: null, direction: "descending",
      types: ["text", "text", "number", "number", "number"],
      defaultDirections: ["ascending", "ascending", "descending", "descending", "descending"],
      values: comparisons.map((c) => [
        compareName(c),
        c.a.maker === c.b.maker ? makerLabel(makers.get(c.a.maker), lang) : `${makerLabel(makers.get(c.a.maker), lang)} · ${makerLabel(makers.get(c.b.maker), lang)}`,
        c.plans.length,
        c.comparablePlans.length,
        c.boards.length,
      ]),
    },
    items: comparisons.map((c) => [compareName(c), U.compare(c, lang)]),
    modified: latest(...comparisons.flatMap((c) => [c.a.modified, c.b.modified])),
  });
};

// The methodology, the same React component the explorer shows in place.
function methodologyPage(lang) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const title = t("Methodology: Real AI Token Pricing", "方法论：AI 模型真实单价计算");
  const description = clip(
    t(
      "How Tokenews computes real AI costs per million tokens (monthly fee ÷ usable monthly tokens), standard workload mixes, leaderboard context and evidence grades.",
      "深入了解 Tokenews 如何计算 AI 模型的真实每百万 token 单价（月费 ÷ 每月实际可用 token），以及统一比较负载、多档官方 API 参考标价、独立榜单评测配置语境与高/中/低证据置信度分级方法，所有原始数据源、计算公式与核对记录均开源可核查。",
    ),
    lang,
  );
  const h1 = t("Every number has a story.", "每个数字，都有依据。");
  return page({
    lang,
    section: null,
    path: U.method(lang),
    alt: U.method(zh ? "en" : "zh"),
    title,
    description,
    keywords: [t("real price per token", "真实单价"), t("LLM pricing methodology", "大模型价格计算方法"), t("cost per million tokens", "每百万 token 价格"), t("AI subscription allowance", "AI 订阅额度"), SITE_NAME],
    h1,
    body: renderToStaticMarkup(createElement(Method, { data, zh })),
    bare: true,
    ogType: "article",
    crumbs: [
      [NAME[lang], U.home(lang)],
      [t("Methodology", "方法论"), U.method(lang)],
    ],
    graph: { modified: updated },
    fingerprint: { title, description, h1, conventions: data.conventions },
  });
}

// ---------------------------------------------------------------------------
// Write everything.
// ---------------------------------------------------------------------------
// Every page also as Markdown (index.md beside index.html, announced by
// <link rel="alternate" type="text/markdown">): the page's main content with
// absolute links, for AI tools that read Markdown better than HTML.
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
turndown.use(gfm);
turndown.addRule("sortableHeading", {
  filter: node => node.nodeName === "BUTTON" && node.hasAttribute("data-sort-type"),
  replacement: (_content, node) => node.firstChild.textContent,
});
turndown.remove(["script", "style", "nav", "aside", "button", "svg"]);
const hasClass = (node, name) => (node.getAttribute?.("class") ?? "").split(/\s+/).includes(name);
const elements = (node) => Array.from(node.childNodes).filter((n) => n.nodeType === 1);
turndown.remove((node) => hasClass(node, "arrow"));
turndown.addRule("smallNote", {
  filter: "small",
  replacement: (content, node) => {
    const text = content.trim();
    if (!text) return "";
    const prev = node.previousSibling;
    const needsSep = prev && !(prev.nodeType === 3 && /\s$/.test(prev.textContent));
    if (hasClass(node, "block")) return `${needsSep ? " · " : ""}${text}`;
    return `${needsSep && !/^[/,.)]/.test(text) ? " " : ""}${text}`;
  },
});
turndown.addRule("summary", {
  filter: "summary",
  replacement: (_content, node) => {
    const parts = elements(node).map((el) => turndown.turndown(el.innerHTML).trim()).filter(Boolean);
    const text = parts.length ? parts.join(" · ") : node.textContent.trim();
    return `\n\n**${text}**\n\n`;
  },
});
turndown.addRule("adjacentLinks", {
  filter: (node) =>
    node.nodeName === "A" &&
    node.parentNode &&
    (hasClass(node.parentNode, "source-links") || hasClass(node.parentNode, "board-list") || hasClass(node.parentNode, "method-sources")),
  replacement: (content, node) => {
    const href = node.getAttribute("href");
    const label = content.trim().replace(/\n+/g, " ");
    const md = href ? `[${label}](${href})` : label;
    if (hasClass(node.parentNode, "method-sources")) return `- ${md}\n`;
    const next = node.nextSibling;
    const sep = next && next.nodeName === "A" ? " · " : "";
    return md + sep;
  },
});
// Definition lists (overview stats, key/value rows) as "- **name**: value — note".
turndown.addRule("definitions", {
  filter: "dl",
  replacement: (_, node) =>
    `\n\n${Array.from(node.getElementsByTagName("dt"))
      .map((dt) => {
        let dd = dt.nextSibling;
        while (dd && dd.nodeName !== "DD") dd = dd.nextSibling;
        return `- **${dt.textContent.trim()}**: ${turndown.turndown((dd?.innerHTML ?? "").replace(/<small[^>]*>/g, " — <small>")).replace(/\n+/g, " ")}`;
      })
      .join("\n")}\n\n`,
});
// The methodology's formula card and workload figures: one labelled line each.
turndown.addRule("formula", {
  filter: (node) => hasClass(node, "big-formula"),
  replacement: (_, node) => {
    const [label, formula, unit] = elements(node).map((n) => n.textContent.trim());
    return `\n\n**${label}** = ${formula} (${unit})\n\n`;
  },
});
turndown.addRule("mix", {
  filter: (node) => hasClass(node, "mix-values"),
  replacement: (_, node) =>
    `\n\n${elements(node)
      .map((span) => {
        const [b] = elements(span);
        return `- **${b.textContent.trim()}** ${span.textContent.replace(b.textContent, "").trim()}`;
      })
      .join("\n")}\n\n`,
});
const toMarkdown = (urlPath, html) => {
  const main = html.match(/<main[^>]*>([\s\S]*)<\/main>/)[1];
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  const lang = html.match(/<html lang="([^"]+)"/)?.[1] ?? (urlPath.startsWith("/zh/") ? "zh-CN" : "en");
  const unescape = (x) => x.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return `---
title: ${JSON.stringify(unescape(html.match(/<title>([^<]*)<\/title>/)[1]))}
description: ${JSON.stringify(unescape(description))}
url: ${abs(urlPath)}
lang: ${lang}
updated: ${html.match(/"dateModified":"([^"]+)"/)?.[1] ?? updated}
source: ${SITE_NAME} (${SITE}), data from Real API Pricing (${REPO}, MIT)
---

${turndown
  .turndown(absolutize(main).replace(/href="#/g, `href="${abs(urlPath)}#`))
  // A table's caption line needs a blank line before the table.
  .replace(/^([^|\n].*)\n(\|)/gm, "$1\n\n$2")
  .replace(/\n{3,}/g, "\n\n")
  .trim()}
`;
};
// A news article's Markdown is its source file, with site-relative links made absolute.
const articleMarkdown = (a) => `---
title: ${JSON.stringify(a.title)}
description: ${JSON.stringify(a.summary)}
url: ${abs(U.article(a))}
lang: en
published: ${a.date}
updated: ${a.updated}
author: ${JSON.stringify(a.author ?? SITE_NAME)}
source: ${SITE_NAME} (${SITE}), data from Real API Pricing (${REPO}, MIT)
${a.makers.length ? `makers: ${JSON.stringify(a.makers)}\n` : ""}${a.models.length ? `models: ${JSON.stringify(a.models)}\n` : ""}${a.providers.length ? `providers: ${JSON.stringify(a.providers)}\n` : ""}${a.tags.length ? `tags: ${JSON.stringify(a.tags)}\n` : ""}---

# ${a.title}

${a.summary}

${a.markdown.replace(/\]\(\/(?!\/)/g, `](${SITE}/`)}
${a.sources.length ? `\n## Sources\n\n${a.sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}\n` : ""}`;
const out = async (urlPath, html, markdown = toMarkdown(urlPath, html)) => {
  const file = path.join(dist, urlPath, "index.html");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  await writeFile(path.join(dist, urlPath, "index.md"), markdown);
};
for (const lang of ["en", "zh"]) {
  await out(U.makers(lang), makersIndex(lang));
  await out(U.providers(lang), providersIndex(lang));
  await out(U.models(lang), modelsIndex(lang));
  await out(U.method(lang), methodologyPage(lang));
  for (const v of makerList) await out(U.maker(v, lang), makerPage(v, lang));
  for (const pr of providerList) await out(U.provider(pr, lang), providerPage(pr, lang));
  for (const m of modelList) await out(U.model(m, lang), modelPage(m, lang));
  await out(U.compares(lang), comparesIndex(lang));
  for (const c of comparisons) await out(U.compare(c, lang), comparePage(c, lang));
}
await out(U.news(), newsIndex());
for (const a of news) await out(U.article(a), newsArticle(a), articleMarkdown(a));
await writeFile(path.join(dist, "news/feed.xml"), newsFeed());
// Cloudflare Static Assets handles these without a Worker or duplicate pages.
const comparisonRedirects = comparisons.flatMap((c) => ["en", "zh"].flatMap((lang) => {
  const canonical = U.compare(c, lang);
  const reverse = `${U.compares(lang)}${[slug(c.a.id), slug(c.b.id)].sort().reverse().join("-vs-")}/`;
  return [`${reverse} ${canonical} 301`, `${reverse.slice(0, -1)} ${canonical} 301`];
}));
await writeFile(path.join(dist, "_redirects"), `# One canonical URL per comparison, regardless of naming order.\n${comparisonRedirects.join("\n")}\n`);
const pairs = [
  [U.method, "0.8"],
  [U.makers, "0.8"],
  [U.providers, "0.8"],
  [U.models, "0.8"],
  ...makerList.map((v) => [(lang) => U.maker(v, lang), "0.7"]),
  ...providerList.map((pr) => [(lang) => U.provider(pr, lang), "0.7"]),
  ...modelList.map((m) => [(lang) => U.model(m, lang), "0.6"]),
  [U.compares, "0.7"],
  ...comparisons.map((c) => [(lang) => U.compare(c, lang), "0.6"]),
];

await mkdir(path.join(dist, "og"), { recursive: true });
for (const { path: p, src } of Object.values(OG))
  await copyFile(path.join(repo, src), path.join(dist, p));
await sharp(await readFile(path.join(root, "public/favicon.svg")), { density: 384 })
  .resize(512, 512)
  .png()
  .toFile(path.join(dist, "og/logo.png"));

const alternates = (en, zh) =>
  `<xhtml:link rel="alternate" hreflang="en" href="${abs(en)}"/><xhtml:link rel="alternate" hreflang="zh-CN" href="${abs(zh)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${abs(en)}"/>`;
await writeFile(
  path.join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url><loc>${SITE}/</loc><lastmod>${siteUpdated}</lastmod><priority>1.0</priority></url>
${pairs
  .flatMap(([url, priority]) =>
    [url("en"), url("zh")].map(
      (u) => `<url><loc>${abs(u)}</loc><lastmod>${pageUpdates.get(u) ?? updated}</lastmod><priority>${priority}</priority>${alternates(url("en"), url("zh"))}</url>`,
    ),
  )
  .join("\n")}
<url><loc>${abs(U.news())}</loc><lastmod>${news[0]?.updated ?? updated}</lastmod><priority>0.8</priority></url>
${news.map((a) => `<url><loc>${abs(U.article(a))}</loc><lastmod>${a.updated}</lastmod><priority>0.6</priority></url>`).join("\n")}
</urlset>
`,
);

// llms.txt (https://llmstxt.org): a concise map for AI answer engines, and
// llms-full.txt with the key numbers of every model and plan inline.
const modelLine = (m) => {
  const c = m.cheapest;
  return `- [${m.name}](${abs(U.model(m, "en"))}): ${c ? `from ${usd(c.real_usd_per_mtok)}/MTok real price via ${planName(c, "en")}` : m.free.length ? "unmetered (≈$0)" : "pricing not yet recorded"}${m.listBlended != null ? `; API list ${usd(m.listBlended)}/MTok (standard mix)` : ""}; ${plural(m.points.length, "plan")}`;
};
const comparisonLine = (c) => `- [${compareName(c)}](${abs(U.compare(c, "en"))}): ${c.comparablePlans.length} of ${c.plans.length} shared subscriptions have matching normalized workloads; ${c.boards.length} shared leaderboard snapshots with configuration details and evidence. Raw totals and different workloads are excluded from price ratios.`;
const exampleModel = modelList.find((m) => m.cheapest && m.benchmarks.length) ?? modelList[0];
const intro = `# ${NAME.en}

> ${SITE_NAME} — ${TAGLINE.en} (${TAGLINE.zh}). Every AI model, maker and provider has a page: what each product includes and what each model actually costs — a subscription's monthly fee divided by the tokens you can really use — set against official API list prices and independent leaderboards (Artificial Analysis, Terminal-Bench, Arena, DeepSWE, OpenDesign). Plan data and methodology come from the open-source Real API Pricing project (${REPO}, MIT licence). Tokenews independently maintains current official API references with source URLs, verification dates and billing conditions; uncovered models retain upstream references. Plan data snapshot: ${updated}. API catalog latest verification: ${data.apiPrices?.updatedAt ?? "not recorded"}.

Key definitions:
- Maker: the company that builds a model. Provider: who sells access to it (official or third-party), through plan tiers that each include a set of models.
- Real price (USD per million tokens, "MTok") = monthly fee in USD ÷ monthly usable tokens. CNY prices convert at ${data.conventions.usdPerCny} CNY per USD.
- Standard workload mix used to compare against list prices: ${+(data.conventions.standardTokenMix.cache * 100).toFixed(2)}% cached input, ${+(data.conventions.standardTokenMix.input * 100).toFixed(2)}% input, ${+(data.conventions.standardTokenMix.output * 100).toFixed(2)}% output.
- Benchmark scores are never mixed across leaderboards.

Chinese versions of every page live under ${SITE}/zh/. Every page is also available as Markdown: add \`index.md\` to its URL (e.g. ${abs(U.model(exampleModel, "en"))}index.md).
`;
await writeFile(
  path.join(dist, "llms.txt"),
  `${intro}
## Indexes

- [All makers](${abs(U.makers("en"))}): ${makerList.length} model makers
- [All providers](${abs(U.providers("en"))}): ${providerList.length} providers and their plan tiers
- [All models](${abs(U.models("en"))}): ${modelList.length} models sorted by release date, newest first
- [Model comparisons](${abs(U.compares("en"))}): ${comparisons.length} head-to-head pairs on shared plans and leaderboards
- [News](${abs(U.news())}): AI model, maker and product news (RSS: ${abs(U.feed())})
- [Interactive explorer](${SITE}/): price–capability Pareto charts, rankings and allowance comparisons
- [Methodology](${abs(U.method("en"))}): how real prices, the comparison workload, leaderboard context and evidence grades work

## Makers

${makerList.map((v) => `- [${makerLabel(v, "en")}](${abs(U.maker(v, "en"))}): ${v.models.map((m) => m.name).join(", ")}`).join("\n")}

## Providers

${providerList.map((pr) => `- [${pr.name}](${abs(U.provider(pr, "en"))}): ${pr.tierList.map((x) => x.name("en")).join(", ")}`).join("\n")}

## Models

${modelList.map(modelLine).join("\n")}

## Comparisons

${comparisons.map(comparisonLine).join("\n")}
${news.length ? `\n## Latest news\n\n${news.slice(0, 20).map((a) => `- [${a.title}](${abs(U.article(a))}) (${a.date}): ${a.summary}`).join("\n")}\n` : ""}

## Data

- [points.csv](${SITE}/data/points.csv): every plan × model with fee, allowance and real price
- [points.json](${SITE}/data/points.json)
- [benchmark-configurations.csv](${SITE}/data/benchmark-configurations.csv): archived leaderboard scores
- [Source repository](${REPO})

## About

${SITE_NAME} is a directory of AI models, makers and providers built on the open Real API Pricing dataset (${REPO}, MIT licence), which it checks for updates every day; pages are rebuilt whenever the data changes. Each plan × model figure carries its data date, a confidence level (high: measured or official tables; medium: usage logs or official ratios; low: single reports) and links to the original evidence. Prices are a floor at saturated use, not a promise. When citing a number, cite the page it appears on and its data date.
`,
);
await writeFile(
  path.join(dist, "llms-full.txt"),
  `${intro}
# Models by maker

${makerList
  .map(
    (v) => `## ${makerLabel(v, "en")}

Page: ${abs(U.maker(v, "en"))}

${v.models
  .map(
    (m) => `### ${m.name} (\`${m.id}\`)

Page: ${abs(U.model(m, "en"))}
${
  m.apiReference
    ? (() => {
        const scope = apiPriceScope(m.apiReference.variant, "en");
        const meta = [
          m.apiReference.checkedAt ? `checked ${m.apiReference.checkedAt}` : "",
          m.apiReference.source ? `source: ${m.apiReference.source}` : "",
        ]
          .filter(Boolean)
          .join("; ");
        return `Official API list price per MTok: ${(({ cached, input, output }) => `${cached} cached / ${input} input / ${output} output`)(listPrice(m.apiReference.prices))}${m.listBlended != null ? ` (${usd(m.listBlended)} standard mix)` : ""}\n${scope}${meta ? `; ${meta}` : ""}\n`;
      })()
    : ""
}${
  m.points.length
    ? `| Plan | Provider | Billing | Monthly fee (USD) | Monthly tokens | Real USD/MTok | Data date |
|---|---|---|---|---|---|---|
${m.points.map((p) => `| ${planName(p, "en")} | ${p.channel} | ${p.billing} | ${fee(p) ?? "—"} | ${p.monthly_tokens != null ? number(p.monthly_tokens, "en", 0) : "—"} | ${unmetered(p) ? "≈0 (unmetered)" : priceExact(p.real_usd_per_mtok)} | ${p.data_date ?? "—"} |`).join("\n")}`
    : "Pricing not yet recorded."
}
${
  m.benchmarks.length
    ? `
| Leaderboard | Metric | Best score | Rank | Configuration |
|---|---|---|---|---|
${m.benchmarks.map(({ board, best, rank, of }) => `| ${data.boards[board].name} | ${data.boards[board].metric} | ${fmt(best.score, "en", 2)} | ${rank}/${of} | ${best.board_label ?? best.variant} |`).join("\n")}
`
    : ""
}`,
  )
  .join("\n")}`,
  )
  .join("\n")}

# Plans by provider

${providerList
  .map(
    (pr) => `## ${pr.name}

Page: ${abs(U.provider(pr, "en"))}

${pr.tierList
  .map(
    (tier) => `### ${tier.name("en")}${tier.feePoint.price_usd != null ? ` — ${fee(tier.feePoint)}/month` : " — metered API"}

${tier.points.map((p) => `- ${models.get(p.model).name}: ${p.monthly_tokens != null ? `${number(p.monthly_tokens, "en", 0)} tokens/month, ` : ""}${unmetered(p) ? "unmetered" : `${priceExact(p.real_usd_per_mtok)}/MTok`}`).join("\n")}
`,
  )
  .join("\n")}`,
  )
  .join("\n")}

# Model comparisons

${comparisons.map(comparisonLine).join("\n")}`,
);

// Homepage: structured data and plain links to every page for crawlers.
const indexFile = path.join(dist, "index.html");
const home = await readFile(indexFile, "utf8");
const homeDescription =
  "Tokenews is the AI-era directory of models, makers and products: each model's real price per token, each maker's lineup and what every subscription includes.";
const siteCoverage = temporalCoverage(
  siteUpdated,
  ...data.points.map((p) => p.data_date),
  ...data.configurations.map(configDate),
);
const homeLd = {
  "@context": "https://schema.org",
  "@graph": [
    PUBLISHER,
    WEBSITE,
    {
      "@type": "WebPage",
      "@id": `${SITE}/#webpage`,
      url: `${SITE}/`,
      name: `${SITE_NAME} · ${TAGLINE.en}`,
      description: homeDescription,
      inLanguage: "en",
      isPartOf: { "@id": `${SITE}/#website` },
      publisher: { "@id": `${SITE}/#organization` },
      dateModified: siteUpdated,
      speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".lede"] },
      primaryImageOfPage: { "@type": "ImageObject", url: abs(OG.en.path), width: 2880, height: 1928 },
    },
    {
      "@type": "Dataset",
      "@id": `${SITE}/#dataset`,
      name: `${SITE_NAME} dataset`,
      alternateName: `${SITE_NAME} 数据集`,
      isBasedOn: REPO,
      description: `Monthly fees, usable token allowances and real USD-per-million-token prices for ${data.points.length} AI subscription and API plan/model combinations from ${providerList.length} providers, covering ${modelList.length} models from ${makerList.length} makers, joined to archived scores from ${Object.keys(data.boards).length} independent leaderboards.`,
      url: `${SITE}/`,
      license: "https://opensource.org/licenses/MIT",
      isAccessibleForFree: true,
      creator: { "@id": `${SITE}/#organization` },
      dateModified: siteUpdated,
      ...(siteCoverage ? { temporalCoverage: siteCoverage } : {}),
      measurementTechnique:
        "Monthly subscription fee divided by measured or estimated usable monthly tokens under normalized workloads; independent leaderboard scores retain original evaluation configurations.",
      keywords: ["AI pricing", "LLM API price", "subscription allowance", "cost per million tokens", "Pareto frontier"],
      variableMeasured: ["monthly fee (USD)", "monthly tokens", "real USD per million tokens", "leaderboard score"],
      distribution: [
        { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/data/points.csv` },
        { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/data/points.json` },
        { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/data/benchmark-configurations.csv` },
      ],
    },
  ],
};
await writeFile(
  path.join(dist, "index.md"),
  `---
title: ${JSON.stringify(`${SITE_NAME} · ${TAGLINE.en}`)}
description: ${JSON.stringify(homeDescription)}
url: ${SITE}/
lang: en
updated: ${siteUpdated}
source: ${SITE_NAME} (${SITE}), data from Real API Pricing (${REPO}, MIT)
---

# ${SITE_NAME}

${homeDescription}

- **Models tracked**: ${modelList.length}
- **Makers**: ${makerList.length}
- **Providers**: ${providerList.length}
- **Plan / model points**: ${data.points.length}
- **Comparisons**: ${comparisons.length}
- **Latest update**: ${siteUpdated}

## Directory

- [AI model makers](${abs(U.makers("en"))}) (${makerList.length})
- [AI providers & plans](${abs(U.providers("en"))}) (${providerList.length})
- [AI model directory](${abs(U.models("en"))}) (${modelList.length})
- [Model comparisons](${abs(U.compares("en"))}) (${comparisons.length})
- [Methodology](${abs(U.method("en"))})
- [AI news](${abs(U.news())}) ([RSS feed](${abs(U.feed())}))
- [Chinese edition (中文版)](${abs(U.makers("zh"))})
- [llms.txt](${SITE}/llms.txt) · [llms-full.txt](${SITE}/llms-full.txt)
`,
);
pageFingerprints.set(
  "/",
  hashFingerprint({
    title: `${SITE_NAME} · ${TAGLINE.en}`,
    description: homeDescription,
    points: data.points.length,
    models: modelList.length,
    makers: makerList.length,
    providers: providerList.length,
    comparisons: comparisons.length,
    latestNews: news.slice(0, 10).map((a) => [a.slug, a.updated]),
  }),
);
await mkdir(path.join(dist, "data"), { recursive: true });
await writeFile(
  path.join(dist, "data/indexnow-manifest.json"),
  JSON.stringify({
    version: 1,
    pages: Object.fromEntries([...pageFingerprints.entries()].sort(([a], [b]) => a.localeCompare(b))),
  }),
);
const homeList = (heading, items) =>
  `<h2>${heading}</h2><ul>${items.map(([name, url]) => `<li><a href="${url}">${esc(name)}</a></li>`).join("")}</ul>`;
const homeNav = `<nav class="seo-index" aria-label="News, makers, providers and models">${homeList(
  "News",
  [["All news", U.news()], ["RSS feed", U.feed()], ...news.slice(0, 10).map((a) => [a.title, U.article(a)])],
)}${homeList(
  "Makers",
  makerList.map((v) => [makerLabel(v, "en"), U.maker(v, "en")]),
)}${homeList(
  "Providers",
  providerList.map((pr) => [pr.name, U.provider(pr, "en")]),
)}${homeList(
  "Models",
  modelList.map((m) => [m.name, U.model(m, "en")]),
)}${homeList(
  "Comparisons",
  [["All comparisons", U.compares("en")], ...comparisons.map((c) => [compareName(c), U.compare(c, "en")])],
)}<p><a href="${U.method("en")}">Methodology</a> · 中文：<a href="${U.makers("zh")}">全部厂商</a> · <a href="${U.providers("zh")}">全部供应商</a> · <a href="${U.models("zh")}">全部模型</a> · <a href="${U.compares("zh")}">全部对比</a> · <a href="${U.method("zh")}">方法论</a></p></nav>`;
for (const marker of ["<!--seo:preload-->", "<!--seo:jsonld-->", "<!--seo:index-->"])
  if (!home.includes(marker)) throw new Error(`index.html is missing the ${marker} marker`);
// The first paint is the explorer's own boot skeleton (header included), not
// an unstyled list; the crawler links follow it below the fold.
await writeFile(
  indexFile,
  home
    .replace("<!--seo:preload-->", FONT_PRELOAD)
    .replace("<!--seo:jsonld-->", jsonLd(homeLd))
    .replace(
      "<!--seo:index-->",
      renderToStaticMarkup(createElement(BootSkeleton, { lang: "en" })) + homeNav,
    ),
);

// 404 pages: Cloudflare serves the nearest 404.html (wrangler.jsonc), so
// /zh/... misses get the Chinese one. Not indexed, no canonical.
const notFound = (lang) => {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  return `<!doctype html>
<html lang="${zh ? "zh-CN" : "en"}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t("Page not found", "页面不存在")} | ${NAME[lang]}</title>
<meta name="robots" content="noindex" />
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" content="#f5f3ed" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0f1113" media="(prefers-color-scheme: dark)" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
${FONT_PRELOAD}
<link rel="stylesheet" href="${appCss}" />
<link rel="stylesheet" href="/pages.css" />
<script>try{var t=localStorage.getItem("pricing-theme");if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body>
${renderToStaticMarkup(createElement(SiteHeader, { lang, current: null, languageHref: zh ? "/404.html" : "/zh/404.html" }))}
<main id="main" class="page static-page">
<p class="kicker">${t("Error 404", "错误 404")}</p>
<h1>${t("Page not found", "页面不存在")}</h1>
<p class="lead">${t("This page does not exist or has moved. Every maker, provider and model has its own page:", "该页面不存在或已移动。每个厂商、供应商和模型都有自己的页面：")}</p>
<p class="more pills">${[
    [U.makers(lang), t("All makers", "全部厂商")],
    [U.providers(lang), t("All providers", "全部供应商")],
    [U.models(lang), t("All models", "全部模型")],
    [U.compares(lang), t("All comparisons", "全部对比")],
    [U.method(lang), t("Methodology", "方法论")],
    [U.news(), t("News", "资讯")],
  ]
    .map(([href, text]) => `<a class="more-link" href="${href}">${esc(text)}<span class="arrow" aria-hidden="true">→</span></a>`)
    .join("")}<a class="button" href="${U.home(lang)}">${t("Interactive explorer", "交互式图表")}<span class="arrow" aria-hidden="true">→</span></a></p>
</main>
${renderToStaticMarkup(createElement(SiteFooter, { lang }))}
${PAGE_SCRIPT}
</body>
</html>
`;
};
await writeFile(path.join(dist, "404.html"), notFound("en"));
await writeFile(path.join(dist, "zh/404.html"), notFound("zh"));

// index.html, robots.txt and _headers are hand-written with the default domain.
if (SITE !== DEFAULT_SITE)
  for (const file of ["index.html", "robots.txt", "_headers"]) {
    const target = path.join(dist, file);
    await writeFile(target, (await readFile(target, "utf8")).replaceAll(DEFAULT_SITE, SITE));
  }

const pageCount = 2 * (5 + makerList.length + providerList.length + modelList.length + comparisons.length) + 1 + news.length;
console.log(
  `SEO pages for ${SITE}: ${makerList.length} makers, ${providerList.length} providers, ${modelList.length} models, ${comparisons.length} comparisons × 2 languages, ${news.length} news (${pageCount} pages), sitemap with ${pageCount + 1} URLs, llms.txt.`,
);
