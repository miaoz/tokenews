// Static, crawlable pages for every model maker (厂商), every provider (供应商)
// with its plan tiers, and every model, in English and Chinese, plus the
// sitemap, llms.txt and the homepage structured data. Runs after `vite build`
// and writes into dist/. It reads the same validated public/data/site.json the
// explorer loads and formats it with the explorer's own helpers, so the pages
// never disagree with the "Behind the number" dialog.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  explorerPath,
  makerPagePath,
  modelPagePath,
  pageMaker,
  pageSlug as slug,
  planAnchor,
  planPagePath,
  providerPagePath,
} from "../src/pageLinks.ts";
import { REPO, SITE_NAME, SiteFooter, SiteHeader, TAGLINE } from "../src/SiteChrome.tsx";
import { loadNews } from "./news.mjs";
import {
  dataDateLine,
  effortLabel,
  firstUrl,
  listPriceLine,
  manufacturer,
  mappingNoteLabel,
  number,
  price,
  priceExact,
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
// The explorer's hashed stylesheet carries the tokens, fonts, header and
// footer; the static pages load it first so all pages share one design.
const appCss = (await readFile(path.join(dist, "index.html"), "utf8")).match(
  /<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"/,
)?.[1];
if (!appCss) throw new Error("Explorer stylesheet not found in dist/index.html");
// Static pages have no React. One inline script drives the shared theme
// toggle and opens a collapsed evidence block when a link targets it.
const PAGE_SCRIPT = `<script>document.querySelector(".theme-toggle").addEventListener("click",function(){var d=document.documentElement,t=d.dataset.theme==="dark"?"light":"dark";d.dataset.theme=t;try{localStorage.setItem("pricing-theme",t)}catch(e){}});function openTarget(){var e=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1)));if(e&&e.tagName==="DETAILS"){e.open=true;e.scrollIntoView()}}addEventListener("hashchange",openTarget);openTarget()</script>`;
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
  SpaceXAI: { alt: ["xAI", "Grok"] },
  Meta: { url: "https://ai.meta.com", alt: ["Muse"] },
  Alibaba: { zhName: "阿里巴巴", url: "https://qwen.ai", alt: ["Qwen", "通义千问", "Alibaba Cloud", "阿里云百炼"] },
  DeepSeek: { zhName: "深度求索", url: "https://www.deepseek.com" },
  Kimi: { zhName: "月之暗面", url: "https://www.kimi.com", alt: ["Moonshot AI"] },
  Zhipu: { zhName: "智谱", url: "https://z.ai", alt: ["Z.ai", "GLM"] },
  MiniMax: { zhName: "稀宇科技", url: "https://www.minimax.io" },
  Xiaomi: { zhName: "小米", url: "https://mimo.xiaomi.com", alt: ["MiMo"] },
  Tencent: { zhName: "腾讯", alt: ["Hunyuan", "混元"] },
  StepFun: { zhName: "阶跃星辰", url: "https://www.stepfun.com" },
  Meituan: { zhName: "美团", alt: ["LongCat"] },
  Mistral: { url: "https://mistral.ai", alt: ["Mistral AI"] },
  Cursor: { url: "https://cursor.com", alt: ["Anysphere"] },
  Cognition: { url: "https://cognition.ai", alt: ["Devin"] },
  NVIDIA: { zhName: "英伟达", url: "https://www.nvidia.com", alt: ["Nemotron"] },
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
// Search snippets show ~160 Latin / ~90 CJK characters; cut at a word boundary.
const clip = (s, lang) => {
  const max = lang === "zh" ? 100 : 160;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return (lang === "zh" ? cut : cut.slice(0, cut.lastIndexOf(" "))).replace(/[\s,;:(（、]+$/, "") + "…";
};
const plural = (n, word, words = word + "s") => `${n} ${n === 1 ? word : words}`;
const unmetered = (p) => p.unmetered || p.real_usd_per_mtok === 0;
const planName = (p, lang) => {
  let plan = p.plan;
  if (plan.startsWith("GLM "))
    plan = plan.replaceAll("老客", "v2").replaceAll("新客", "v3");
  if (lang === "zh") return plan;
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
  const sym = lp.currency === "CNY" ? "¥" : "$";
  const f = (n) =>
    sym + new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(n);
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
  lang === "zh" ? BOARD_ZH[b] ?? data.boards[b].name : data.boards[b].name;
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

const models = new Map();
for (const p of data.points) {
  let m = models.get(p.model);
  if (!m) {
    m = { id: p.model, slug: slug(p.model), name: familyName(p), maker: pageMaker(p), points: [], configs: new Map() };
    models.set(p.model, m);
  }
  if (!p.plan_gen) m.name = familyName(p);
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
  m.listBlended = m.points.find((p) => p.list_blended_usd_per_mtok)?.list_blended_usd_per_mtok ?? null;
  m.mostTokens = [...m.subs].filter((p) => p.monthly_yi != null).sort((a, b) => b.monthly_yi - a.monthly_yi)[0] ?? null;
  m.channels = [...new Set(m.points.map((p) => p.channel))].sort();
  m.benchmarks = BOARD_ORDER.flatMap((board) => {
    const configs = [...m.configs.values()].filter((c) => c.board === board).sort((a, b) => b.score - a.score);
    if (!configs.length) return [];
    const best = configs[0];
    const ranking = [...boardBest.get(board).entries()].sort((a, b) => b[1] - a[1]);
    const rank = ranking.findIndex(([, s]) => s <= best.score) + 1;
    return [{ board, best, configs, rank, of: ranking.length }];
  });
  m.mappingNotes = [...new Set(m.points.flatMap((p) => (mappingsByPoint.get(p.id) ?? []).map((x) => x.mapping_note)))];
}

const makers = new Map();
for (const m of models.values()) {
  if (!makers.has(m.maker))
    makers.set(m.maker, { name: m.maker, models: [], ...MAKERS[m.maker] });
  makers.get(m.maker).models.push(m);
}
for (const v of makers.values()) {
  v.models.sort((a, b) => (a.cheapest?.real_usd_per_mtok ?? Infinity) - (b.cheapest?.real_usd_per_mtok ?? Infinity) || a.name.localeCompare(b.name));
  v.points = v.models.flatMap((m) => m.points);
  v.plans = [...new Map(v.points.map((p) => [p.plan_id, p])).values()];
  v.channels = [...new Set(v.points.map((p) => p.channel))].sort();
}

// A provider sells access; its plan tiers (one plan_id each) serve models.
const providers = new Map();
for (const p of data.points) {
  let pr = providers.get(p.channel);
  if (!pr) {
    pr = { name: p.channel, url: PROVIDER_URLS[p.channel] ?? MAKERS[p.channel]?.url, points: [], tiers: new Map() };
    providers.set(p.channel, pr);
  }
  pr.points.push(p);
  if (!pr.tiers.has(p.plan_id)) pr.tiers.set(p.plan_id, { id: p.plan_id, points: [] });
  pr.tiers.get(p.plan_id).points.push(p);
}
for (const pr of providers.values()) {
  for (const tier of pr.tiers.values()) {
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
  news: () => "/news/",
  article: (a) => `/news/${a.slug}/`,
  feed: () => "/news/feed.xml",
  explorer: (lang, extra = "") => explorerPath(lang, extra.replace(/^&/, "")),
  method: (lang) => explorerPath(lang, "view=method"),
};
const abs = (p) => SITE + p;
const link = (href, text) => `<a href="${href}">${esc(text)}</a>`;
const ext = (href, text) => `<a href="${esc(href)}" rel="nofollow noopener" target="_blank">${esc(text)}</a>`;
const makerLink = (v, lang) => link(U.maker(v, lang), makerLabel(v, lang));
const providerLink = (name, lang) => link(providerPagePath(name, lang), name);
const modelLink = (m, lang) => link(U.model(m, lang), m.name);
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
  logo: `${SITE}/favicon.svg`,
  sameAs: [REPO],
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
const faqLd = (faq) => ({
  "@type": "FAQPage",
  mainEntity: faq.map(([q, a]) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
});

// `alt` is the same page in the other language, or null for English-only
// pages (news). `byline` replaces the data-updated line under the lead;
// `published` and `tags` add article metadata.
function page({ lang, section, path: urlPath, alt, title, description, keywords, h1, lead, body, crumbs, graph, ogType = "website", byline, published, tags = [] }) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const url = abs(urlPath);
  const og = OG[lang];
  const fullTitle = `${title} | ${NAME[lang]}`;
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
        primaryImageOfPage: { "@type": "ImageObject", url: abs(og.path), width: 2880, height: 1928 },
        breadcrumb: { "@id": `${url}#breadcrumb` },
        speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".lead", ".answer"] },
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
<meta name="keywords" content="${esc(keywords.join(", "))}" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<meta name="author" content="${NAME[lang]}" />
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" content="#f5f3ed" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0f1113" media="(prefers-color-scheme: dark)" />
<link rel="canonical" href="${url}" />
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
<link rel="stylesheet" href="${appCss}" />
<link rel="stylesheet" href="/pages.css" />
<meta property="og:type" content="${ogType}" />
<meta property="og:site_name" content="${NAME[lang]}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:locale" content="${zh ? "zh_CN" : "en_US"}" />
${alt ? `<meta property="og:locale:alternate" content="${zh ? "en_US" : "zh_CN"}" />\n` : ""}
<meta property="og:image" content="${abs(og.path)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="2880" />
<meta property="og:image:height" content="1928" />
<meta property="og:image:alt" content="${esc(t("Price–capability Pareto chart of AI subscriptions", "AI 订阅价格–能力帕累托图"))}" />
${published ? `<meta property="article:published_time" content="${published}" />\n` : ""}${ogType === "article" ? `<meta property="article:modified_time" content="${graph.modified ?? updated}" />\n` : ""}${tags.map((x) => `<meta property="article:tag" content="${esc(x)}" />\n`).join("")}<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${abs(og.path)}" />
<meta name="twitter:image:alt" content="${esc(t("Price–capability Pareto chart of AI subscriptions", "AI 订阅价格–能力帕累托图"))}" />
<script>try{var t=localStorage.getItem("pricing-theme");if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}</script>
${jsonLd(ld)}
</head>
<body>
<a class="skip-link" href="#main">${t("Skip to content", "跳到正文")}</a>
${renderToStaticMarkup(createElement(SiteHeader, { lang, current: section, languageHref: alt ?? U.home(zh ? "en" : "zh") }))}
<main id="main" class="page static-page">
<nav class="crumbs" aria-label="${t("Breadcrumb", "面包屑")}"><ol>${crumbs
    .map(([n, h], i) => (i === crumbs.length - 1 ? `<li aria-current="page">${esc(n)}</li>` : `<li><a href="${h}">${esc(n)}</a></li>`))
    .join("")}</ol></nav>
<h1>${esc(h1)}</h1>
<p class="lead">${lead}</p>
<p class="updated">${byline ?? `${t("Data updated", "数据更新于")} <time datetime="${updated}">${updated}</time> · <a href="${U.method(lang)}">${t("How real prices are computed", "真实单价的计算方法")}</a>`}</p>
${body}
</main>
${renderToStaticMarkup(createElement(SiteFooter, { lang }))}
${PAGE_SCRIPT}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Shared fragments.
// ---------------------------------------------------------------------------
const table = (caption, head, rows) =>
  `<div class="table-wrap"><table><caption>${caption}</caption><thead><tr>${head
    .map((h) => `<th scope="col">${h}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
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
const faqHtml = (faq, lang) =>
  `<section aria-labelledby="faq"><h2 id="faq">${lang === "zh" ? "常见问题" : "Frequently asked questions"}</h2>${faq
    .map(([q, a]) => `<details open><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`)
    .join("")}</section>`;
const realCell = (p, lang) =>
  unmetered(p)
    ? `≈$0 <small>${esc(unmeteredNote(p, lang))}</small>`
    : `<strong>${usd(p.real_usd_per_mtok)}</strong>`;
const vsList = (p) =>
  !unmetered(p) && p.list_blended_usd_per_mtok && p.billing !== "metered"
    ? `${fmt(p.list_blended_usd_per_mtok / p.real_usd_per_mtok, "en", 1)}×`
    : "—";
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
      : t("Metered API · public token prices weighted by the project standard workload.", "按量 API · 三段公开标价按项目标准负载加权。");
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
                ? t(` · standard-load blended ≈ ${price(p.list_blended_usd_per_mtok)}/MTok`, `；标准负载加权 ≈ ${price(p.list_blended_usd_per_mtok)}/MTok`)
                : "")
            : "",
        ]
          .filter(Boolean)
          .map((x) => `<p>${esc(x)}</p>`)
          .join("")
      : "";
  const maps = (mappingsByPoint.get(p.id) ?? []).sort((a, b) => BOARD_ORDER.indexOf(a.board) - BOARD_ORDER.indexOf(b.board));
  const texts = [
    zh ? p.source : p.source_en ?? p.source,
    p.decision_note ? (zh ? p.decision_note : p.decision_note_en ?? p.decision_note) : "",
    p.note && p.note !== p.decision_note ? (zh ? p.note : p.note_en ?? p.note) : "",
  ].filter(Boolean);
  const links = [
    ...p.evidence.map((e) => (safeUrl(e.url) ? ext(e.url, e.label) : "")).filter(Boolean),
    ext(`${REPO}/tree/main/data/research`, t("Browse the public evidence archive", "浏览公开证据存档")),
  ];
  return `<details class="evidence" id="${evidenceId(p)}"><summary><span class="ev-plan">${esc(planName(p, lang))}</span><span class="ev-channel">${esc(p.channel)}</span><span class="ev-price">${unmetered(p) ? "≈$0" : priceExact(p.real_usd_per_mtok)}<small>/MTok</small></span></summary>
<div class="ev-body">
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
<h4>${t("Adoption evidence · source and rationale", "采用依据 · 原始来源文字")}${zh ? "" : ` <small>(${t("translated from the Chinese record", "")})</small>`}</h4>
${texts.map((x) => `<p class="original-text">${esc(x)}</p>`).join("")}
<p class="source-links">${links.join("")}</p>
</div></details>`;
}

// One leaderboard's archived configurations for a model, as the dialog shows them.
function configTable(b, lang) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const rows = b.configs.map((c) => {
    const median = c.median_cost_usd_per_task ?? c.median_cost_per_task_usd ?? null;
    const src = firstUrl(zh ? c.source : c.source_en ?? c.source) ?? firstUrl(c.source);
    const note = zh ? c.record_note_zh : c.record_note_en;
    return [
      `${esc(variantLabel(c.variant, lang))}${c.board_label && c.board_label !== c.variant ? `<small>${esc(c.board_label)}</small>` : ""}${note ? `<small class="original-text">${esc(note)}</small>` : ""}`,
      `<strong>${fmt(c.score, lang, 4)}</strong>${c.score_is_estimated ? ` <small>${t("AA estimate", "AA 估计值")}</small>` : ""}${c.score_is_self_reported ? ` <small>${t("vendor self-report", "厂商自报")}</small>` : ""}`,
      c.score_low == null && c.score_high == null ? "—" : `${fmt(c.score_low, lang)} – ${fmt(c.score_high, lang)}`,
      `${esc(c.agent_harness ?? "—")} / ${esc(effortLabel(c.reasoning_effort, lang) ?? "—")} / ${esc(c.service_mode ?? "—")}`,
      `${c.mean_cost_usd_per_task == null ? "—" : price(c.mean_cost_usd_per_task)} / ${median == null ? "—" : price(median)}`,
      esc(c.checked_at ?? "—"),
      [src && safeUrl(src) ? ext(src, t("Source", "来源")) : "", c.archive_url ? ext(c.archive_url, t("Archive", "存档")) : ""].filter(Boolean).join(" · ") || "—",
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
        `<li><time datetime="${a.date}">${formatDay(a.date, lang)}</time><a href="${U.article(a)}" hreflang="en" lang="en">${esc(a.title)}</a><p lang="en">${esc(a.summary)}</p></li>`,
    )
    .join("")}</ul>`;
const relatedNews = (articles, lang) =>
  articles.length
    ? `<section aria-labelledby="news"><h2 id="news">${lang === "zh" ? "相关资讯" : "Related news"}</h2>${lang === "zh" ? '<p class="note">资讯目前只有英文版。</p>' : ""}${newsItems(articles.slice(0, 8), lang)}${
        articles.length > 8 ? `<p><a href="${U.news()}">${lang === "zh" ? "全部资讯" : "All news"} →</a></p>` : ""
      }</section>`
    : "";

// ---------------------------------------------------------------------------
// Model page.
// ---------------------------------------------------------------------------
function modelPage(m, lang) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const v = makers.get(m.maker);
  const vName = makerLabel(v, lang);
  const lp = listPrice(m.listPoint?.list_price);
  const c = m.cheapest;
  const nPlans = m.subs.length;
  const topBench = m.benchmarks.slice().sort((a, b) => a.rank / a.of - b.rank / b.of)[0];

  const answer = c
    ? zh
      ? `截至 ${updated}，使用 ${m.name} 最便宜的方式是「${planName(c, lang)}」，真实单价约 ${usd(c.real_usd_per_mtok)} / 百万 token${c.price_usd != null ? `（月费 ${fee(c)}，每月约 ${tokens(c, lang)} token）` : ""}。本站共收录 ${m.points.length} 个可使用 ${m.name} 的套餐或 API 渠道。`
      : `As of ${updated}, the cheapest way to use ${m.name} is ${planName(c, lang)} at a real cost of about ${usd(c.real_usd_per_mtok)} per million tokens${c.price_usd != null ? ` (${fee(c)}/month for roughly ${tokens(c, lang)} tokens a month)` : ""}. We track ${plural(m.points.length, "plan")} and API channels that serve ${m.name}.`
    : zh
      ? `截至 ${updated}，${m.name} 在本站收录的渠道中不计额度（真实单价 ≈$0）。`
      : `As of ${updated}, ${m.name} is unmetered on every channel we track (real cost ≈$0).`;
  const listSentence = lp
    ? zh
      ? `官方 API 标价（每百万 token）：缓存读 ${lp.cached} / 输入 ${lp.input} / 输出 ${lp.output}${m.listBlended ? `；按标准负载折合约 ${usd(m.listBlended)} / 百万 token` : ""}。`
      : `Official API list price per million tokens: ${lp.cached} cached input, ${lp.input} input, ${lp.output} output${m.listBlended ? ` — about ${usd(m.listBlended)} per million tokens on a standard workload mix` : ""}.`
    : "";

  const title = zh
    ? `${m.name} 价格：真实 API 单价与订阅额度（${vName}）`
    : `${m.name} Pricing: Real Cost per Million Tokens & Subscription Limits`;
  const description = clip(
    c
      ? zh
        ? `${m.name}（${vName}）真实单价低至 ${usd(c.real_usd_per_mtok)}/百万 token。对比 ${m.points.length} 个订阅与 API 的月费、额度、官方标价与榜单分数。`
        : `${m.name} (${vName}) real cost from ${usd(c.real_usd_per_mtok)} per million tokens. Compare ${m.points.length} subscriptions & APIs: fees, token limits, list prices, benchmarks.`
      : zh
        ? `${m.name}（${vName}）的订阅额度、官方 API 标价与榜单分数对比，附可追溯来源。`
        : `${m.name} by ${vName}: subscription allowances, official API list prices and leaderboard scores, with traceable sources.`,
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
    p.data_date ? `<time>${esc(p.data_date)}</time>` : "—",
    `<a href="#${evidenceId(p)}">${t("Evidence", "依据")} ↓</a>`,
  ]);
  const benchRows = m.benchmarks.map(({ board, best, configs, rank, of }) => [
    ext(data.boards[board].url, boardName(board, lang)),
    esc(metricName(board, lang)),
    `<strong>${fmt(best.score, lang, 2)}</strong>${best.score_is_self_reported ? ` <small>${t("self-reported", "厂商自报")}</small>` : ""}${best.score_is_estimated ? ` <small>${t("estimate", "估计值")}</small>` : ""}`,
    `#${rank} / ${of}`,
    esc(variantLabel(best.board_label ?? best.variant, lang)),
    esc(effortLabel(best.reasoning_effort, lang) ?? "—"),
    esc(best.agent_harness ?? "—"),
    String(configs.length),
    esc(data.boards[board].snapshot),
  ]);
  const siblings = v.models.filter((x) => x !== m);

  const faq = [];
  if (c)
    faq.push([
      t(`How much does ${m.name} really cost per million tokens?`, `${m.name} 每百万 token 实际多少钱？`),
      zh
        ? `按「订阅月费 ÷ 实际可用 token」计算，${m.name} 的真实单价从 ${usd(c.real_usd_per_mtok)}（${planName(c, lang)}）到 ${usd(m.priced.at(-1).real_usd_per_mtok)}（${planName(m.priced.at(-1), lang)}）不等。`
        : `Measured as monthly fee ÷ tokens you can actually use, ${m.name} ranges from ${usd(c.real_usd_per_mtok)} (${planName(c, lang)}) to ${usd(m.priced.at(-1).real_usd_per_mtok)} (${planName(m.priced.at(-1), lang)}) per million tokens.`,
    ]);
  if (m.mostTokens)
    faq.push([
      t(`Which subscription gives the most ${m.name} usage?`, `哪个订阅的 ${m.name} 额度最多？`),
      zh
        ? `「${planName(m.mostTokens, lang)}」每月约 ${tokens(m.mostTokens, lang)} token，月费 ${fee(m.mostTokens) ?? "—"}。`
        : `${planName(m.mostTokens, lang)} allows roughly ${tokens(m.mostTokens, lang)} tokens of ${m.name} per month for ${fee(m.mostTokens) ?? "—"}.`,
    ]);
  if (lp) faq.push([t(`What is the official API price of ${m.name}?`, `${m.name} 的官方 API 价格是多少？`), listSentence]);
  if (topBench)
    faq.push([
      t(`How does ${m.name} score on independent leaderboards?`, `${m.name} 在独立榜单上的成绩如何？`),
      zh
        ? `${m.name} 收录了 ${m.benchmarks.length} 个榜单的成绩，其中在 ${boardName(topBench.board, lang)} 上为 ${fmt(topBench.best.score, lang, 2)}（${metricName(topBench.board, lang)}），在本站收录的 ${topBench.of} 个模型中排第 ${topBench.rank}。`
        : `${m.name} has scores on ${plural(m.benchmarks.length, "leaderboard")}; its strongest placement is ${fmt(topBench.best.score, lang, 2)} (${metricName(topBench.board, lang)}) on ${boardName(topBench.board, lang)}, #${topBench.rank} of ${topBench.of} models tracked.`,
    ]);
  faq.push([
    t(`Who makes ${m.name}, and where can I use it?`, `${m.name} 是哪家公司的模型？在哪里可以使用？`),
    zh
      ? `${m.name}（模型 ID：${m.id}）由 ${vName} 开发，可通过 ${m.channels.join("、")} 使用。`
      : `${m.name} (model ID ${m.id}) is made by ${vName} and is available through ${m.channels.join(", ")}.`,
  ]);

  const offers = m.points.filter((p) => p.price_usd != null);
  const product = {
    "@type": "SoftwareApplication",
    "@id": `${abs(U.model(m, "en"))}#model`,
    name: m.name,
    alternateName: m.id,
    applicationCategory: "Large language model",
    operatingSystem: "Cloud API",
    url: abs(U.model(m, lang)),
    creator: { "@id": `${abs(U.maker(v, "en"))}#org` },
    ...(offers.length
      ? {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "USD",
            lowPrice: Math.min(...offers.map((p) => p.price_usd)),
            highPrice: Math.max(...offers.map((p) => p.price_usd)),
            offerCount: offers.length,
            offers: offers.map((p) => ({
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
            })),
          },
        }
      : {}),
    additionalProperty: [
      ...(c ? [{ "@type": "PropertyValue", name: "Lowest real price (USD per million tokens)", value: c.real_usd_per_mtok, unitText: "USD/MTok" }] : []),
      ...(m.listBlended ? [{ "@type": "PropertyValue", name: "API list price, standard mix (USD per million tokens)", value: m.listBlended, unitText: "USD/MTok" }] : []),
      ...m.benchmarks.map(({ board, best }) => ({ "@type": "PropertyValue", name: `${data.boards[board].name} — ${data.boards[board].metric}`, value: +best.score.toFixed(3) })),
    ],
  };
  const dataset = {
    "@type": "Dataset",
    name: zh ? `${m.name} 真实定价数据` : `${m.name} real pricing data`,
    description,
    license: "https://opensource.org/licenses/MIT",
    creator: { "@id": `${SITE}/#organization` },
    dateModified: updated,
    isAccessibleForFree: true,
    url: abs(U.model(m, lang)),
    variableMeasured: ["monthly fee (USD)", "monthly tokens", "real USD per million tokens", "leaderboard score"],
    distribution: [
      { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/data/points.csv` },
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/data/points.json` },
    ],
  };

  const body = `
<p class="answer">${esc(answer)}${listSentence ? " " + esc(listSentence) : ""}</p>
${overview(
  t("Overview", "概览"),
  [
    [t("Lowest real price", "最低真实单价"), c ? `${usd(c.real_usd_per_mtok)}<span class="unit">/MTok</span>` : m.free.length ? "≈$0" : null, c ? esc(planName(c, lang)) : t("unmetered on every channel", "所有渠道均不计额度")],
    [t("API list price", "API 标价"), m.listBlended ? `${usd(m.listBlended)}<span class="unit">/MTok</span>` : null, t("standard workload mix", "标准负载")],
    [t("Most monthly tokens", "最多月额度"), m.mostTokens ? tokens(m.mostTokens, lang) : null, m.mostTokens && esc(planName(m.mostTokens, lang))],
    [t("Plans & APIs", "套餐与 API"), String(m.points.length), zh ? `${nPlans} 个订阅 · ${m.api.length} 个按量 API` : `${plural(nPlans, "subscription")} · ${plural(m.api.length, "metered API")}`],
  ],
  [
    [t("Maker", "厂商"), makerLink(v, lang)],
    [t("Model ID", "模型 ID"), `<code>${esc(m.id)}</code>`],
    [t("Providers", "供应商"), join(m.channels.map((ch) => providerLink(ch, lang)), lang)],
    [t("Leaderboards", "榜单"), m.benchmarks.length ? `<a href="#bench">${join(m.benchmarks.map((b) => esc(boardName(b.board, lang))), lang)}</a>` : null],
  ],
)}
<p><a class="button" href="${lockLink(m, lang)}">${t(`Plot ${m.name} on the price–capability chart`, `在价格–能力图中查看 ${m.name}`)} →</a></p>
<section aria-labelledby="plans"><h2 id="plans">${t(`${m.name} plans and real prices`, `${m.name} 套餐与真实单价`)}</h2>
<p>${t("Real price = monthly fee ÷ tokens you can actually use in a month. “vs API” shows how many times cheaper than the official API list price (standard workload mix) the plan is. “Evidence” opens the full calculation and sources for that row.", "真实单价 = 月费 ÷ 每月实际可用 token。「对比 API」表示该套餐比官方 API 标价（标准负载）便宜多少倍。「依据」展开该行的完整计算与来源。")}</p>
${table(
  t(`Every tracked way to use ${m.name}, cheapest first`, `所有可使用 ${m.name} 的套餐，按真实单价从低到高`),
  [t("Plan", "套餐"), t("Provider", "供应商"), t("Billing", "计费"), t("Monthly fee", "月费"), t("Monthly tokens", "月额度"), t("Real $/MTok", "真实单价 $/MTok"), t("vs API", "对比 API"), t("Confidence", "置信度"), t("Data date", "数据日期"), ""],
  planRows,
)}</section>
<section aria-labelledby="evidence"><h2 id="evidence">${t("Behind each number", "每个数字背后的依据")}</h2>
<p>${t("For every plan: the data date, the exact calculation, the quota basis, how leaderboard scores were mapped, and the original adoption evidence with its sources.", "每个套餐的数据日期、精确计算、额度口径、榜单分数的映射方式，以及原始采用依据与来源。")}</p>
${m.points.map((p) => evidenceBlock(p, lang)).join("\n")}
</section>
${
  m.benchmarks.length
    ? `<section aria-labelledby="bench"><h2 id="bench">${t(`${m.name} benchmark scores`, `${m.name} 榜单成绩`)}</h2>
<p>${t("Highest archived configuration per leaderboard; ranks are among all models each board archives in this dataset. Scores are never mixed across boards.", "每个榜单取已归档的最高配置；排名为该榜单在本数据集中收录的全部模型内的名次。不同榜单的分数不混算。")}</p>
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
${table(t("List price per million tokens", "每百万 token 标价"), [t("Cached input", "缓存读"), t("Input", "输入"), t("Output", "输出")], [[lp.cached, lp.input, lp.output]])}</section>`
    : ""
}
${relatedNews(newsFor.model(m), lang)}
${faqHtml(faq, lang)}
${
  siblings.length
    ? `<section aria-labelledby="more"><h2 id="more">${t(`More ${vName} models`, `${vName} 的其他模型`)}</h2>
${table(
  t(`Other ${vName} models by lowest real price`, `${vName} 的其他模型，按最低真实单价排序`),
  [t("Model", "模型"), t("Lowest real $/MTok", "最低真实单价 $/MTok"), t("Cheapest plan", "最便宜的套餐"), t("Plans", "套餐数")],
  siblings.map((s) => [
    modelLink(s, lang),
    s.cheapest ? `<strong>${usd(s.cheapest.real_usd_per_mtok)}</strong>` : "≈$0",
    s.cheapest ? planLink(s.cheapest, lang) : "—",
    String(s.points.length),
  ]),
)}</section>`
    : ""
}`;
  return page({
    section: "models",
    lang,
    path: U.model(m, lang),
    alt: U.model(m, zh ? "en" : "zh"),
    title,
    description,
    keywords: [m.name, m.id, `${m.name} ${t("pricing", "价格")}`, `${m.name} API ${t("price", "价格")}`, `${m.name} ${t("subscription", "订阅")}`, vName, ...m.channels, t("cost per million tokens", "每百万 token 价格"), t("AI coding plan", "AI 编程套餐")],
    h1: zh ? `${m.name} 真实价格与额度` : `${m.name} pricing: real cost per million tokens`,
    lead: esc(
      zh
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
    graph: { about: { "@id": product["@id"] }, mainEntity: { "@id": product["@id"] }, extra: [product, faqLd(faq), dataset] },
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
    ? t("Other AI models: real pricing & subscription limits", "其他厂商 AI 模型：真实价格与订阅额度")
    : zh
      ? `${vName} 模型价格：全部 ${n} 个模型的真实单价与订阅额度`
      : `${v.name} AI Model Pricing: Real Cost of All ${n} Models`;
  const modelNames = v.models.map((m) => m.name);
  const names = (sep, more) => modelNames.slice(0, 3).join(sep) + (n > 3 ? more : "");
  const description = clip(
    zh
      ? `${vName} 模型${best ? `真实单价低至 ${usd(best.cheapest.real_usd_per_mtok)}/百万 token` : "价格"}：全部 ${n} 个模型（${names("、", " 等")}）的订阅月费、额度与 API 标价对比。`
      : `${isOther ? "AI" : v.name} models${best ? ` from ${usd(best.cheapest.real_usd_per_mtok)} per million tokens` : ""}: real pricing for all ${n} (${names(", ", "…")}) across subscriptions and APIs.`,
    lang,
  );
  const answer = best
    ? zh
      ? `截至 ${updated}，本站收录 ${vName} 的 ${n} 个模型、${v.points.length} 个套餐/渠道组合。真实单价最低的是 ${best.name}，通过「${planName(best.cheapest, lang)}」约 ${usd(best.cheapest.real_usd_per_mtok)} / 百万 token。`
      : `As of ${updated}, we track ${n} ${isOther ? "" : `${v.name} `}model${n === 1 ? "" : "s"} across ${v.points.length} plan/channel combinations. The lowest real price is ${best.name} via ${planName(best.cheapest, lang)} at about ${usd(best.cheapest.real_usd_per_mtok)} per million tokens.`
    : "";
  const rows = v.models.map((m) => {
    const lp = listPrice(m.listPoint?.list_price);
    const top = m.benchmarks.find((b) => b.board === "aa_intelligence_index") ?? m.benchmarks[0];
    return [
      modelLink(m, lang),
      m.cheapest ? `<strong>${usd(m.cheapest.real_usd_per_mtok)}</strong>` : "≈$0",
      m.cheapest ? planLink(m.cheapest, lang) : "—",
      m.listBlended ? usd(m.listBlended) : "—",
      lp ? `${lp.input} / ${lp.output}` : "—",
      m.mostTokens ? `${tokens(m.mostTokens, lang)}` : "—",
      String(m.points.length),
      top ? `${fmt(top.best.score, lang, 1)} <small>${esc(boardName(top.board, lang))}</small>` : "—",
    ];
  });
  const planRows = v.plans
    .slice()
    .sort((a, b) => (a.price_usd ?? Infinity) - (b.price_usd ?? Infinity) || planName(a, lang).localeCompare(planName(b, lang)))
    .map((p) => {
      const ms = [...new Set(v.points.filter((x) => x.plan_id === p.plan_id).map((x) => x.model))].map((id) => models.get(id));
      return [planLink(p, lang), providerLink(p.channel, lang), billingLabel(p, lang), feeCell(p, lang), join(ms.map((x) => modelLink(x, lang)), lang)];
    });
  const faq = [];
  if (best)
    faq.push([
      t(`What is the cheapest ${isOther ? "" : v.name + " "}model per token?`, `${vName} 哪个模型每 token 最便宜？`),
      answer,
    ]);
  faq.push([
    t(`Which ${isOther ? "" : v.name + " "}models are covered?`, `本站收录了 ${vName} 的哪些模型？`),
    zh ? `共 ${n} 个：${modelNames.join("、")}。` : `${n} model${n === 1 ? "" : "s"}: ${modelNames.join(", ")}.`,
  ]);
  faq.push([
    t(`Where can I use ${isOther ? "these" : v.name} models?`, `可以通过哪些供应商使用 ${vName} 的模型？`),
    zh ? `${v.channels.join("、")}，共 ${v.plans.length} 个套餐或 API。` : `Through ${v.channels.join(", ")} — ${v.plans.length} plans or APIs in total.`,
  ]);
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
  const scored = v.models.filter((m) => m.benchmarks.length).length;
  const subs = v.plans.filter((p) => p.billing !== "metered").length;
  const official = v.points.some(firstParty);
  const resellers = v.channels.length - (official ? 1 : 0);
  const channelNote = !resellers
    ? t("official only", "仅官方")
    : zh
      ? `${official ? "官方 + " : ""}${resellers} 个第三方`
      : `${official ? "official + " : ""}${plural(resellers, "reseller")}`;
  const body = `
${answer ? `<p class="answer">${esc(answer)}</p>` : ""}
${overview(
  t("Overview", "概览"),
  [
    [t("Lowest real price", "最低真实单价"), best ? `${usd(best.cheapest.real_usd_per_mtok)}<span class="unit">/MTok</span>` : v.points.some(unmetered) ? "≈$0" : null, best ? esc(best.name) : t("unmetered", "不计额度")],
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
<section aria-labelledby="models"><h2 id="models">${t(`All ${isOther ? "" : v.name + " "}models`, `${vName} 全部模型`)}</h2>
${table(
  t(`${isOther ? "Models" : v.name + " models"} by lowest real price`, `${vName} 模型，按最低真实单价排序`),
  [t("Model", "模型"), t("Lowest real $/MTok", "最低真实单价 $/MTok"), t("Cheapest plan", "最便宜的套餐"), t("API list (std. mix)", "API 标价（标准负载）"), t("API in / out per MTok", "API 输入 / 输出（每 MTok）"), t("Most monthly tokens", "最多月额度"), t("Plans", "套餐数"), t("Score", "分数")],
  rows,
)}
</section>
<section aria-labelledby="plans"><h2 id="plans">${t(`Plans that include ${isOther ? "these" : v.name} models`, `包含 ${vName} 模型的套餐`)}</h2>
${table(t("Subscriptions and APIs, by monthly fee", "订阅与 API，按月费排序"), [t("Plan", "套餐"), t("Provider", "供应商"), t("Billing", "计费"), t("Monthly fee", "月费"), t("Models", "模型")], planRows)}</section>
${relatedNews(newsFor.maker(v), lang)}
${faqHtml(faq, lang)}
<p><a class="button" href="${
  // The explorer filters by the raw vendor field, which lumps some makers under "other".
  v.models.length === 1 || new Set(v.points.map((p) => p.vendor)).has("other")
    ? lockLink(v.models[0], lang)
    : U.explorer(lang, `&vendors=${encodeURIComponent(v.points[0].vendor)}`)
}">${t("Open in the interactive explorer", "在交互式图表中查看")} →</a></p>`;
  return page({
    section: "makers",
    lang,
    path: U.maker(v, lang),
    alt: U.maker(v, zh ? "en" : "zh"),
    title,
    description,
    keywords: [vName, ...(v.zhName ? [v.zhName] : []), ...(v.alt ?? []), `${vName} ${t("pricing", "价格")}`, `${vName} API ${t("price", "价格")}`, ...modelNames, t("AI subscription", "AI 订阅"), t("cost per million tokens", "每百万 token 价格")],
    h1: isOther ? t("Other model makers: models & real pricing", "其他厂商：模型与真实价格") : zh ? `${vName}：模型与真实价格` : `${v.name} models & real pricing`,
    lead: esc(
      zh
        ? `${vName}${v.zhName ? `（${v.zhName}）` : ""}的全部 ${n} 个模型：每个模型在各订阅与 API 中的真实单价、月额度与官方标价。`
        : `Every ${isOther ? "" : v.name + " "}model we track — ${n} in total — with its real per-token price across subscriptions and APIs, monthly allowance and official list price.`,
    ),
    body,
    crumbs: [
      [NAME[lang], U.home(lang)],
      [t("Makers", "厂商"), U.makers(lang)],
      [vName, U.maker(v, lang)],
    ],
    graph: { about: { "@id": org["@id"] }, mainEntity: { "@id": list["@id"] }, extra: [org, list, faqLd(faq)] },
  });
}

// ---------------------------------------------------------------------------
// Provider page: every plan tier and the models it includes.
// ---------------------------------------------------------------------------
function providerPage(pr, lang) {
  const zh = lang === "zh";
  const t = (en, cn) => (zh ? cn : en);
  const nTiers = pr.tierList.length;
  const nModels = pr.models.length;
  const subs = pr.tierList.filter((x) => x.billing !== "metered");
  const fees = feeRange(subs.map((x) => x.feePoint));
  const c = pr.cheapest;
  const answer = zh
    ? `截至 ${updated}，${pr.name} 共有 ${nTiers} 个套餐${fees ? `（月费 ${fees}）` : ""}，包含 ${pr.makers.length} 家厂商的 ${nModels} 个模型。${c ? `真实单价最低的是「${planName(c, lang)}」中的 ${models.get(c.model).name}，约 ${usd(c.real_usd_per_mtok)} / 百万 token。` : ""}`
    : `As of ${updated}, ${pr.name} offers ${plural(nTiers, "plan")}${fees ? ` (${fees} a month)` : ""} covering ${plural(nModels, "model")} from ${plural(pr.makers.length, "maker")}.${c ? ` The lowest real price is ${models.get(c.model).name} on ${planName(c, lang)} at about ${usd(c.real_usd_per_mtok)} per million tokens.` : ""}`;
  const title = zh
    ? `${pr.name} 套餐对比：各档位包含的模型与真实单价`
    : `${pr.name} Plans Compared: Included Models & Real Cost per Token`;
  const description = clip(
    zh
      ? `${pr.name} 全部 ${nTiers} 个套餐${fees ? `（${fees}/月）` : ""}包含哪些模型、每月额度多少、真实单价${c ? `低至 ${usd(c.real_usd_per_mtok)}/百万 token` : ""}，附可追溯来源。`
      : `What each ${pr.name} plan includes: ${plural(nModels, "model")}, monthly token limits and real cost${c ? ` from ${usd(c.real_usd_per_mtok)} per million tokens` : ""}, across ${plural(nTiers, "plan")}${fees ? ` (${fees}/mo)` : ""}.`,
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
          p.data_date ? `<time>${esc(p.data_date)}</time>` : "—",
          `<a href="${U.evidence(p, lang)}">${t("Evidence", "依据")} →</a>`,
        ];
      });
      return `<section class="plan" id="${planAnchor(tier.id)}" aria-labelledby="${planAnchor(tier.id)}-h"><h3 id="${planAnchor(tier.id)}-h">${esc(name)} <span class="plan-fee">${tier.feePoint.price_usd != null ? `${esc(fee(tier.feePoint))}${t("/mo", "/月")}` : billingLabel(tier.feePoint, lang)}</span></h3>
${table(
  t(`Models included in ${name}, cheapest first`, `「${name}」包含的模型，按真实单价从低到高`),
  [t("Model", "模型"), t("Maker", "厂商"), t("Monthly tokens", "月额度"), t("Real $/MTok", "真实单价 $/MTok"), t("vs API", "对比 API"), t("Confidence", "置信度"), t("Data date", "数据日期"), ""],
  rows,
)}</section>`;
    })
    .join("\n");
  const faq = [];
  if (c)
    faq.push([
      t(`Which ${pr.name} plan is cheapest per token?`, `${pr.name} 哪个套餐每 token 最便宜？`),
      zh
        ? `「${planName(c, lang)}」中的 ${models.get(c.model).name} 真实单价最低，约 ${usd(c.real_usd_per_mtok)} / 百万 token${c.price_usd != null ? `（月费 ${fee(c)}，每月约 ${tokens(c, lang)} token）` : ""}。`
        : `${models.get(c.model).name} on ${planName(c, lang)} has the lowest real price, about ${usd(c.real_usd_per_mtok)} per million tokens${c.price_usd != null ? ` (${fee(c)}/month for roughly ${tokens(c, lang)} tokens)` : ""}.`,
    ]);
  faq.push([
    t(`Which models does ${pr.name} include?`, `${pr.name} 包含哪些模型？`),
    zh
      ? `共 ${nModels} 个模型，来自 ${pr.makers.map((v) => makerLabel(v, lang)).join("、")}：${pr.models.map((m) => m.name).join("、")}。`
      : `${plural(nModels, "model")} from ${pr.makers.map((v) => makerLabel(v, lang)).join(", ")}: ${pr.models.map((m) => m.name).join(", ")}.`,
  ]);
  if (subs.length)
    faq.push([
      t(`How much do ${pr.name} plans cost?`, `${pr.name} 的套餐多少钱？`),
      join(subs.map((x) => `${x.name(lang)} ${fee(x.feePoint)}${t("/mo", "/月")}`), lang) + (zh ? "。" : "."),
    ]);
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
${table(t("Plans by monthly fee", "套餐，按月费排序"), [t("Plan", "套餐"), t("Billing", "计费"), t("Monthly fee", "月费"), t("Models", "模型数"), t("Lowest real $/MTok", "最低真实单价 $/MTok")], overviewRows)}
</section>
<section aria-labelledby="included"><h2 id="included">${t("What each plan includes", "各套餐包含的模型")}</h2>
<p>${t("Real price = monthly fee ÷ tokens you can actually use in a month, per model. Allowances of different models in one plan are alternatives and must not be added up.", "真实单价 = 月费 ÷ 该模型每月实际可用 token。同一套餐内不同模型的额度为替代关系，不可相加。")}</p>
${tierSections}
</section>
${relatedNews(newsFor.provider(pr), lang)}
${faqHtml(faq, lang)}
<p><a class="button" href="${U.explorer(lang, `&channels=${encodeURIComponent(pr.name)}`)}">${t("Open in the interactive explorer", "在交互式图表中查看")} →</a></p>`;
  return page({
    section: "providers",
    lang,
    path: U.provider(pr, lang),
    alt: U.provider(pr, zh ? "en" : "zh"),
    title,
    description,
    keywords: [pr.name, `${pr.name} ${t("pricing", "价格")}`, `${pr.name} ${t("plans", "套餐")}`, ...subs.map((x) => x.name(lang)), ...pr.models.slice(0, 10).map((m) => m.name), t("AI coding plan", "AI 编程套餐"), t("cost per million tokens", "每百万 token 价格")],
    h1: zh ? `${pr.name}：套餐与包含的模型` : `${pr.name} plans & included models`,
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
    graph: { about: { "@id": org["@id"] }, mainEntity: { "@id": org["@id"] }, extra: [org, faqLd(faq)] },
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

function newsIndex() {
  const lang = "en";
  const list = {
    "@type": "ItemList",
    "@id": `${abs(U.news())}#list`,
    numberOfItems: news.length,
    itemListElement: news.map((a, i) => ({ "@type": "ListItem", position: i + 1, url: abs(U.article(a)), name: a.title })),
  };
  return page({
    lang,
    section: "news",
    path: U.news(),
    alt: null,
    title: "AI News: Models, Makers and Products",
    description: `News on AI models, makers and products from ${SITE_NAME}: releases, price and plan changes, and leaderboard moves, linked to real per-token prices.`,
    keywords: ["AI news", "LLM news", "AI model releases", "AI pricing news", "coding plan news", SITE_NAME],
    h1: "AI news",
    lead: esc("Releases, price and plan changes, and leaderboard moves across AI models, makers and products — each linked to the model, maker and provider pages it concerns."),
    byline: `<a href="${U.feed()}">RSS feed</a> · ${news.length ? `${plural(news.length, "article")}, latest ${formatDay(news[0].date, lang)}` : "No articles yet"}`,
    body: news.length
      ? `<div class="news-index">${news
          .map(
            (a) => `<article><time datetime="${a.date}">${formatDay(a.date, lang)}</time><h2><a href="${U.article(a)}">${esc(a.title)}</a></h2><p>${esc(a.summary)}</p>${articleChips(a)}</article>`,
          )
          .join("")}</div>`
      : `<p>No articles yet. New ones appear here and in the <a href="${U.feed()}">RSS feed</a>.</p>`,
    crumbs: [
      [NAME[lang], U.home(lang)],
      ["News", U.news()],
    ],
    graph: { mainEntity: { "@id": list["@id"] }, extra: [list] },
  });
}

function newsArticle(a) {
  const lang = "en";
  const url = abs(U.article(a));
  const mentioned = a.models.map((id) => models.get(id));
  const others = news.filter((x) => x !== a).slice(0, 5);
  const body = `
${articleChips(a)}
<div class="prose">${a.html}</div>
${
  a.sources.length
    ? `<section aria-labelledby="sources"><h2 id="sources">Sources</h2><ul class="source-list">${a.sources.map((s) => `<li>${ext(s.url, s.title)}</li>`).join("")}</ul></section>`
    : ""
}
${
  mentioned.length
    ? `<section aria-labelledby="mentioned"><h2 id="mentioned">Models in this article</h2>
${table(
  `Current real prices (data updated ${updated})`,
  ["Model", "Maker", "Lowest real $/MTok", "Cheapest plan", "API list (std. mix)"],
  mentioned.map((m) => [
    modelLink(m, lang),
    makerLink(makers.get(m.maker), lang),
    m.cheapest ? `<strong>${usd(m.cheapest.real_usd_per_mtok)}</strong>` : "≈$0",
    m.cheapest ? planLink(m.cheapest, lang) : "—",
    m.listBlended ? usd(m.listBlended) : "—",
  ]),
)}</section>`
    : ""
}
${others.length ? `<section aria-labelledby="more"><h2 id="more">More news</h2>${newsItems(others, lang)}<p><a href="${U.news()}">All news →</a></p></section>` : ""}`;
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
    image: abs(OG.en.path),
    ...(a.tags.length ? { keywords: a.tags } : {}),
    ...(a.sources.length ? { citation: a.sources.map((s) => s.url) } : {}),
    about: [
      ...a.makers.map((n) => ({ "@id": `${abs(U.maker(makers.get(n), "en"))}#org` })),
      ...a.models.map((id) => ({ "@id": `${abs(U.model(models.get(id), "en"))}#model` })),
      ...a.providers.map((n) => ({ "@id": `${abs(providerPagePath(n, "en"))}#org` })),
    ],
  };
  return page({
    lang,
    section: "news",
    path: U.article(a),
    alt: null,
    title: a.title,
    description: a.summary,
    keywords: [...a.tags, ...a.makers, ...a.models.map((id) => models.get(id).name), ...a.providers, "AI news"],
    h1: a.title,
    lead: esc(a.summary),
    byline: `<time datetime="${a.date}">${formatDay(a.date, lang)}</time>${a.updated !== a.date ? ` · updated <time datetime="${a.updated}">${formatDay(a.updated, lang)}</time>` : ""}${a.author ? ` · ${esc(a.author)}` : ""}${a.tags.length ? ` · ${a.tags.map(esc).join(", ")}` : ""}`,
    body,
    ogType: "article",
    published: a.date,
    tags: a.tags,
    crumbs: [
      [NAME[lang], U.home(lang)],
      ["News", U.news()],
      [a.title, U.article(a)],
    ],
    graph: { modified: a.updated, about: { "@id": article["@id"] }, mainEntity: { "@id": article["@id"] }, extra: [article] },
  });
}

// RSS 2.0 with the full article in content:encoded.
// Feed readers resolve nothing against the site, so site-relative links become absolute.
const absolutize = (html) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${SITE}/`);
const rfc822 = (d) => new Date(`${d}T00:00:00Z`).toUTCString();
const cdata = (s) => `<![CDATA[${s.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
const newsFeed = () => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
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
<description>${esc(a.summary)}</description>
${a.tags.map((x) => `<category>${esc(x)}</category>`).join("")}
<content:encoded>${cdata(absolutize(a.html))}</content:encoded>
</item>`,
  )
  .join("\n")}
</channel>
</rss>
`;

// ---------------------------------------------------------------------------
// Index pages.
// ---------------------------------------------------------------------------
function indexPage({ lang, section, path: [en, zh], title, description, keywords, h1, lead, caption, head, rows, items }) {
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
    h1,
    lead: esc(lead),
    body: table(caption, head, rows),
    crumbs: [
      [NAME[lang], U.home(lang)],
      [h1, urlPath],
    ],
    graph: { mainEntity: { "@id": list["@id"] }, extra: [list] },
  });
}

const makersIndex = (lang) => {
  const t = (en, cn) => (lang === "zh" ? cn : en);
  return indexPage({
    lang,
    section: "makers",
    path: [U.makers("en"), U.makers("zh")],
    title: t(`AI Model Makers Compared: Real Pricing for ${makerList.length} Makers`, `AI 模型厂商价格对比：${makerList.length} 家厂商的真实单价`),
    description: t(
      `Compare ${makerList.length} AI model makers — OpenAI, Anthropic, Google, DeepSeek, Qwen, Kimi, GLM and more — by real cost per million tokens across ${data.points.length} subscriptions and APIs.`,
      `对比 OpenAI、Anthropic、Google、DeepSeek、通义千问、Kimi、智谱等 ${makerList.length} 家 AI 厂商，覆盖 ${data.points.length} 个订阅与 API 的真实每百万 token 价格。`,
    ),
    keywords: [t("AI model makers", "AI 模型厂商"), t("LLM pricing comparison", "大模型价格对比"), ...makerList.map((v) => makerLabel(v, lang))],
    h1: t("AI model makers", "AI 模型厂商"),
    lead: t(`${makerList.length} model makers, ${modelList.length} models and ${data.points.length} plan/model combinations, each priced as monthly fee ÷ tokens you can actually use.`, `${makerList.length} 家厂商、${modelList.length} 个模型、${data.points.length} 个套餐/模型组合，均按「月费 ÷ 实际可用 token」计算真实单价。`),
    caption: t("Makers by number of plans", "厂商，按套餐数排序"),
    head: [t("Maker", "厂商"), t("Models", "模型数"), t("Model list", "模型"), t("Lowest real $/MTok", "最低真实单价 $/MTok"), t("Plans", "套餐数")],
    rows: makerList.map((v) => {
      const best = v.models.find((m) => m.cheapest);
      return [
        makerLink(v, lang),
        String(v.models.length),
        join(v.models.map((m) => modelLink(m, lang)), lang),
        best ? `${usd(best.cheapest.real_usd_per_mtok)} <small>${esc(best.name)}</small>` : "≈$0",
        String(v.plans.length),
      ];
    }),
    items: makerList.map((v) => [makerLabel(v, lang), U.maker(v, lang)]),
  });
};

const providersIndex = (lang) => {
  const t = (en, cn) => (lang === "zh" ? cn : en);
  return indexPage({
    lang,
    section: "providers",
    path: [U.providers("en"), U.providers("zh")],
    title: t(`AI Coding Plans Compared: ${providerList.length} Providers & What Each Plan Includes`, `AI 编程套餐对比：${providerList.length} 家供应商的套餐与包含的模型`),
    description: t(
      `AI subscriptions from ${providerList.length} providers — OpenCode, Command Code, Cursor, Claude, ChatGPT, GLM and more: plan fees, included models, real cost per token.`,
      `对比 OpenCode、Command Code、Cursor、Claude、ChatGPT、GLM 等 ${providerList.length} 家供应商的 AI 订阅：套餐月费、包含的模型与真实每百万 token 价格。`,
    ),
    keywords: [t("AI coding plan", "AI 编程套餐"), t("AI subscription comparison", "AI 订阅对比"), ...providerList.map((p) => p.name)],
    h1: t("AI providers & plans", "AI 供应商与套餐"),
    lead: t(`${providerList.length} providers sell access to these models through ${[...providers.values()].reduce((n, p) => n + p.tierList.length, 0)} plans and APIs. Each provider page lists its plan tiers and the models every tier includes.`, `${providerList.length} 家供应商通过 ${[...providers.values()].reduce((n, p) => n + p.tierList.length, 0)} 个套餐与 API 提供这些模型。每个供应商页面列出其各档套餐及每档包含的模型。`),
    caption: t("Providers by number of plan × model combinations", "供应商，按套餐 × 模型组合数排序"),
    head: [t("Provider", "供应商"), t("Type", "类型"), t("Plans", "套餐数"), t("Models", "模型数"), t("Monthly fee", "月费"), t("Lowest real $/MTok", "最低真实单价 $/MTok")],
    rows: providerList.map((pr) => [
      link(U.provider(pr, lang), pr.name),
      kindLabel(pr, lang),
      String(pr.tierList.length),
      String(pr.models.length),
      feeRange(pr.tierList.filter((x) => x.billing !== "metered").map((x) => x.feePoint)) ?? "—",
      pr.cheapest ? `${usd(pr.cheapest.real_usd_per_mtok)} <small>${esc(models.get(pr.cheapest.model).name)}</small>` : "≈$0",
    ]),
    items: providerList.map((pr) => [pr.name, U.provider(pr, lang)]),
  });
};

const modelsIndex = (lang) => {
  const t = (en, cn) => (lang === "zh" ? cn : en);
  const sorted = [...modelList].sort((a, b) => (a.cheapest?.real_usd_per_mtok ?? 0) - (b.cheapest?.real_usd_per_mtok ?? 0));
  return indexPage({
    lang,
    section: "models",
    path: [U.models("en"), U.models("zh")],
    title: t(`AI Model Prices: Real Cost per Million Tokens for ${sorted.length} Models`, `AI 模型价格表：${sorted.length} 个模型的真实每百万 token 单价`),
    description: t(
      `Real price per million tokens for ${sorted.length} AI models — GPT, Claude, Gemini, Grok, DeepSeek, Qwen, Kimi, GLM and more — across subscriptions and APIs, cheapest first.`,
      `GPT、Claude、Gemini、Grok、DeepSeek、通义千问、Kimi、GLM 等 ${sorted.length} 个 AI 模型在订阅与 API 中的真实每百万 token 单价，从低到高排序。`,
    ),
    keywords: [t("AI model prices", "AI 模型价格"), t("LLM price per million tokens", "大模型每百万 token 价格"), ...sorted.slice(0, 20).map((m) => m.name)],
    h1: t("AI model prices", "AI 模型价格"),
    lead: t(`All ${sorted.length} models, ranked by the lowest real price we found across every subscription and API that serves them.`, `全部 ${sorted.length} 个模型，按其在所有订阅与 API 中的最低真实单价排序。`),
    caption: t("Models by lowest real price", "模型，按最低真实单价排序"),
    head: [t("Model", "模型"), t("Maker", "厂商"), t("Lowest real $/MTok", "最低真实单价 $/MTok"), t("Cheapest plan", "最便宜的套餐"), t("API list (std. mix)", "API 标价（标准负载）"), t("Plans", "套餐数")],
    rows: sorted.map((m) => [
      modelLink(m, lang),
      makerLink(makers.get(m.maker), lang),
      m.cheapest ? `<strong>${usd(m.cheapest.real_usd_per_mtok)}</strong>` : "≈$0",
      m.cheapest ? planLink(m.cheapest, lang) : "—",
      m.listBlended ? usd(m.listBlended) : "—",
      String(m.points.length),
    ]),
    items: sorted.map((m) => [m.name, U.model(m, lang)]),
  });
};

// ---------------------------------------------------------------------------
// Write everything.
// ---------------------------------------------------------------------------
const out = async (urlPath, html) => {
  const file = path.join(dist, urlPath, "index.html");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
};
for (const lang of ["en", "zh"]) {
  await out(U.makers(lang), makersIndex(lang));
  await out(U.providers(lang), providersIndex(lang));
  await out(U.models(lang), modelsIndex(lang));
  for (const v of makerList) await out(U.maker(v, lang), makerPage(v, lang));
  for (const pr of providerList) await out(U.provider(pr, lang), providerPage(pr, lang));
  for (const m of modelList) await out(U.model(m, lang), modelPage(m, lang));
}
await out(U.news(), newsIndex());
for (const a of news) await out(U.article(a), newsArticle(a));
await writeFile(path.join(dist, "news/feed.xml"), newsFeed());
const pairs = [
  [U.makers, "0.8"],
  [U.providers, "0.8"],
  [U.models, "0.8"],
  ...makerList.map((v) => [(lang) => U.maker(v, lang), "0.7"]),
  ...providerList.map((pr) => [(lang) => U.provider(pr, lang), "0.7"]),
  ...modelList.map((m) => [(lang) => U.model(m, lang), "0.6"]),
];

await mkdir(path.join(dist, "og"), { recursive: true });
for (const { path: p, src } of Object.values(OG))
  await copyFile(path.join(repo, src), path.join(dist, p));

const alternates = (en, zh) =>
  `<xhtml:link rel="alternate" hreflang="en" href="${abs(en)}"/><xhtml:link rel="alternate" hreflang="zh-CN" href="${abs(zh)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${abs(en)}"/>`;
await writeFile(
  path.join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url><loc>${SITE}/</loc><lastmod>${updated}</lastmod><priority>1.0</priority></url>
${pairs
  .flatMap(([url, priority]) =>
    [url("en"), url("zh")].map(
      (u) => `<url><loc>${abs(u)}</loc><lastmod>${updated}</lastmod><priority>${priority}</priority>${alternates(url("en"), url("zh"))}</url>`,
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
  return `- [${m.name}](${abs(U.model(m, "en"))}): ${c ? `from ${usd(c.real_usd_per_mtok)}/MTok real price via ${planName(c, "en")}` : "unmetered (≈$0)"}${m.listBlended ? `; API list ${usd(m.listBlended)}/MTok (standard mix)` : ""}; ${plural(m.points.length, "plan")}`;
};
const intro = `# ${NAME.en}

> ${SITE_NAME} — ${TAGLINE.en} (${TAGLINE.zh}). Every AI model, maker and provider has a page: what each product includes and what each model actually costs — a subscription's monthly fee divided by the tokens you can really use — set against official API list prices and independent leaderboards (Artificial Analysis, Terminal-Bench, Arena, DeepSWE, OpenDesign). Data and methodology come from the open-source Real API Pricing project (${REPO}, MIT licence); every number links to its source. Data updated ${updated}.

Key definitions:
- Maker: the company that builds a model. Provider: who sells access to it (official or third-party), through plan tiers that each include a set of models.
- Real price (USD per million tokens, "MTok") = monthly fee in USD ÷ monthly usable tokens. CNY prices convert at ${data.conventions.usdPerCny} CNY per USD.
- Standard workload mix used to compare against list prices: ${+(data.conventions.standardTokenMix.cache * 100).toFixed(2)}% cached input, ${+(data.conventions.standardTokenMix.input * 100).toFixed(2)}% input, ${+(data.conventions.standardTokenMix.output * 100).toFixed(2)}% output.
- Benchmark scores are never mixed across leaderboards.

Chinese versions of every page live under ${SITE}/zh/.
`;
await writeFile(
  path.join(dist, "llms.txt"),
  `${intro}
## Indexes

- [All makers](${abs(U.makers("en"))}): ${makerList.length} model makers
- [All providers](${abs(U.providers("en"))}): ${providerList.length} providers and their plan tiers
- [All models](${abs(U.models("en"))}): ${modelList.length} models ranked by lowest real price
- [News](${abs(U.news())}): AI model, maker and product news (RSS: ${abs(U.feed())})
- [Interactive explorer](${SITE}/): price–capability Pareto charts, rankings and allowance comparisons
- [Methodology](${REPO}/blob/main/CONVENTIONS.md)

## Makers

${makerList.map((v) => `- [${makerLabel(v, "en")}](${abs(U.maker(v, "en"))}): ${v.models.map((m) => m.name).join(", ")}`).join("\n")}

## Providers

${providerList.map((pr) => `- [${pr.name}](${abs(U.provider(pr, "en"))}): ${pr.tierList.map((x) => x.name("en")).join(", ")}`).join("\n")}

## Models

${modelList.map(modelLine).join("\n")}
${news.length ? `\n## Latest news\n\n${news.slice(0, 20).map((a) => `- [${a.title}](${abs(U.article(a))}) (${a.date}): ${a.summary}`).join("\n")}\n` : ""}

## Data

- [points.csv](${SITE}/data/points.csv): every plan × model with fee, allowance and real price
- [points.json](${SITE}/data/points.json)
- [benchmark-configurations.csv](${SITE}/data/benchmark-configurations.csv): archived leaderboard scores
- [Source repository](${REPO})
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
${m.listPoint?.list_price ? `Official API list price per MTok: ${(({ cached, input, output }) => `${cached} cached / ${input} input / ${output} output`)(listPrice(m.listPoint.list_price))}${m.listBlended ? ` (${usd(m.listBlended)} standard mix)` : ""}\n` : ""}
| Plan | Provider | Billing | Monthly fee (USD) | Monthly tokens | Real USD/MTok | Data date |
|---|---|---|---|---|---|---|
${m.points.map((p) => `| ${planName(p, "en")} | ${p.channel} | ${p.billing} | ${fee(p) ?? "—"} | ${p.monthly_tokens ?? "—"} | ${unmetered(p) ? "≈0 (unmetered)" : priceExact(p.real_usd_per_mtok)} | ${p.data_date ?? "—"} |`).join("\n")}
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
  .join("\n")}`,
);

// Homepage: structured data and plain links to every page for crawlers.
const indexFile = path.join(dist, "index.html");
const home = await readFile(indexFile, "utf8");
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
      description:
        "Tokenews is the AI-era directory of models, makers and products: each model's real price per token, each maker's lineup and what every subscription includes.",
      inLanguage: "en",
      isPartOf: { "@id": `${SITE}/#website` },
      dateModified: updated,
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
      dateModified: updated,
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
const homeList = (heading, items) =>
  `<h2>${heading}</h2><ul>${items.map(([name, url]) => `<li><a href="${url}">${esc(name)}</a></li>`).join("")}</ul>`;
const homeNav = `<nav class="seo-index" aria-label="News, makers, providers and models">${homeList(
  "News",
  [["All news", U.news()], ...news.slice(0, 10).map((a) => [a.title, U.article(a)])],
)}${homeList(
  "Makers",
  makerList.map((v) => [makerLabel(v, "en"), U.maker(v, "en")]),
)}${homeList(
  "Providers",
  providerList.map((pr) => [pr.name, U.provider(pr, "en")]),
)}${homeList(
  "Models",
  modelList.map((m) => [m.name, U.model(m, "en")]),
)}<p>中文：<a href="${U.makers("zh")}">全部厂商</a> · <a href="${U.providers("zh")}">全部供应商</a> · <a href="${U.models("zh")}">全部模型</a></p></nav>`;
if (!home.includes("<!--seo:jsonld-->") || !home.includes("<!--seo:index-->"))
  throw new Error("index.html is missing the <!--seo:jsonld--> / <!--seo:index--> markers");
await writeFile(
  indexFile,
  home
    .replace("<!--seo:jsonld-->", jsonLd(homeLd))
    .replace("<!--seo:index-->", homeNav),
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
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="stylesheet" href="${appCss}" />
<link rel="stylesheet" href="/pages.css" />
<script>try{var t=localStorage.getItem("pricing-theme");if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body>
${renderToStaticMarkup(createElement(SiteHeader, { lang, current: null, languageHref: zh ? "/404.html" : "/zh/404.html" }))}
<main id="main" class="page static-page">
<h1>${t("Page not found", "页面不存在")}</h1>
<p class="lead">${t("This page does not exist or has moved. Every maker, provider and model has its own page:", "该页面不存在或已移动。每个厂商、供应商和模型都有自己的页面：")}</p>
<p><a href="${U.makers(lang)}">${t("All makers", "全部厂商")}</a> · <a href="${U.providers(lang)}">${t("All providers", "全部供应商")}</a> · <a href="${U.models(lang)}">${t("All models", "全部模型")}</a> · <a href="${U.home(lang)}">${t("Interactive explorer", "交互式图表")}</a></p>
</main>
${renderToStaticMarkup(createElement(SiteFooter, { lang }))}
${PAGE_SCRIPT}
</body>
</html>
`;
};
await writeFile(path.join(dist, "404.html"), notFound("en"));
await writeFile(path.join(dist, "zh/404.html"), notFound("zh"));

// index.html and robots.txt are hand-written with the default domain.
if (SITE !== DEFAULT_SITE)
  for (const file of ["index.html", "robots.txt"]) {
    const target = path.join(dist, file);
    await writeFile(target, (await readFile(target, "utf8")).replaceAll(DEFAULT_SITE, SITE));
  }

const pageCount = 2 * (3 + makerList.length + providerList.length + modelList.length) + 1 + news.length;
console.log(
  `SEO pages for ${SITE}: ${makerList.length} makers, ${providerList.length} providers, ${modelList.length} models × 2 languages, ${news.length} news (${pageCount} pages), sitemap with ${pageCount + 1} URLs, llms.txt.`,
);
