// Checks the built site in web/dist before it is deployed: every page's
// JSON-LD parses, every internal link and #anchor resolves, indexable pages
// carry their metadata with unique titles and descriptions, and the sitemap
// lists only pages that exist. Exits non-zero with a list of problems.
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const problems = [];
const fail = (file, message) => problems.push(`${file}: ${message}`);
const unescape = (s) =>
  s.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");

const files = (await readdir(dist, { recursive: true }))
  .map((f) => f.split(path.sep).join("/"))
  .filter((f) => f.endsWith("index.html"));
const urlOf = (f) => "/" + f.replace(/index\.html$/, "");
const pages = new Map();
for (const f of files) {
  const html = await readFile(path.join(dist, f), "utf8");
  pages.set(urlOf(f), { file: f, html, ids: new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])) });
}

const REQUIRED = ['rel="canonical"', 'name="description"', 'property="og:title"', 'property="og:image"', 'name="twitter:card"', "application/ld+json"];
const SORTABLE_LIST_PAGES = new Set(["/makers/", "/zh/makers/", "/providers/", "/zh/providers/", "/models/", "/zh/models/", "/compare/", "/zh/compare/"]);
const SPA_HASH_ALLOWLIST = /^\/#(?:lang|lock|channels|vendors|sel)=/;
const ISO_DATETIME = /^\d{4}-\d{2}(?:-\d{2})?(?:T\d{2}:\d{2}(?::\d{2})?Z?)?$/;
const BAD_PLURAL = /(?<![.\d-])\b1 (models|plans|providers|makers|comparisons|subscriptions|configurations|articles|sources failed)\b/i;
const BAD_ALL_1 = /\bAll 1 [A-Z][a-z]+s\b/;
const titles = new Map();
const descriptions = new Map();
const definedLdIds = new Set();
const referencedLdIds = [];
const pageAlternates = new Map();
const firstColumnLinks = (sectionHtml) => {
  const tbody = sectionHtml.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return [...tbody.matchAll(/<tr>\s*<th scope="row"[^>]*><a [^>]*>([\s\S]*?)<\/a><\/th>/g)].map((m) =>
    unescape(m[1].replace(/<[^>]+>/g, "").trim()),
  );
};

for (const [url, { file, html }] of pages) {
  if (SORTABLE_LIST_PAGES.has(url) && !html.includes("<table data-sortable>")) fail(file, "directory page missing sortable table");
  if (html.includes("data-sortable") && !html.includes('<script src="/table-sort.js" defer></script>'))
    fail(file, "sortable page missing /table-sort.js");
  const strippedHtml = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const headings = [...strippedHtml.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  const h1Count = headings.filter((l) => l === 1).length;
  if (h1Count !== 1) fail(file, `expected 1 <h1>, got ${h1Count}`);
  for (let i = 1; i < headings.length; i++)
    if (headings[i] - headings[i - 1] > 1) fail(file, `skipped heading level h${headings[i - 1]} -> h${headings[i]}`);

  const visibleText = unescape(strippedHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  if (BAD_ALL_1.test(visibleText)) fail(file, 'contains "All 1 <Plural>" regression');
  const badPlural = visibleText.match(BAD_PLURAL);
  if (badPlural) fail(file, `singular/plural regression: "${badPlural[0]}"`);

  for (const m of html.matchAll(/<time\b([^>]*)>/gi)) {
    const dt = m[1].match(/\bdatetime="([^"]*)"/i)?.[1];
    if (!dt || !ISO_DATETIME.test(dt)) fail(file, `invalid or missing <time datetime="${dt ?? ""}">`);
  }

  const mdHref = html.match(/<link\s+rel="alternate"\s+type="text\/markdown"\s+href="([^"]*)"/i)?.[1];
  if (!mdHref) fail(file, 'missing <link rel="alternate" type="text/markdown">');
  else if (!existsSync(path.join(dist, decodeURIComponent(mdHref)))) fail(file, `missing Markdown copy ${mdHref}`);

  if (/^(\/zh)?\/providers\/[^/]+\/$/.test(url)) {
    const tiersSection = html.match(/<section aria-labelledby="tiers">[\s\S]*?<\/section>/)?.[0];
    if (tiersSection) {
      const names = firstColumnLinks(tiersSection);
      const seen = new Set();
      for (const n of names) {
        if (seen.has(n)) fail(file, `duplicate plan name in #tiers: "${n}"`);
        seen.add(n);
      }
    }
  }
  if (/^(\/zh)?\/makers\/[^/]+\/$/.test(url)) {
    const plansSection = html.match(/<section aria-labelledby="plans">[\s\S]*?<\/section>/)?.[0];
    if (plansSection) {
      const names = firstColumnLinks(plansSection);
      const seen = new Set();
      for (const n of names) {
        if (seen.has(n)) fail(file, `duplicate plan name in #plans: "${n}"`);
        seen.add(n);
      }
    }
  }

  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))
    try {
      // Google rejects a Dataset whose description is outside 50–5000 characters.
      const visit = (o) => {
        if (Array.isArray(o)) return o.forEach(visit);
        if (!o || typeof o !== "object") return;
        if (o["@type"] === "Dataset" && !(o.description?.length >= 50 && o.description.length <= 5000))
          fail(file, `Dataset description is ${o.description?.length ?? 0} characters (needs 50–5000)`);
        if (typeof o["@id"] === "string") {
          if (o["@type"]) definedLdIds.add(o["@id"]);
          else referencedLdIds.push({ file, id: o["@id"] });
        }
        Object.values(o).forEach(visit);
      };
      visit(JSON.parse(m[1]));
    } catch (e) {
      fail(file, `invalid JSON-LD: ${e.message}`);
    }
  for (const [, raw] of html.matchAll(/href="([^"]*)"/g)) {
    const href = unescape(raw);
    if (/^(https?:|mailto:)/.test(href)) continue;
    if (href.startsWith("/#")) {
      if (!SPA_HASH_ALLOWLIST.test(href)) fail(file, `unexpected SPA hash link ${href}`);
      continue;
    }
    const [target, anchor] = href.split("#");
    const resolved = target === "" ? url : target;
    if (!resolved.startsWith("/")) continue;
    if (resolved.endsWith("/")) {
      const page = pages.get(resolved);
      if (!page) fail(file, `broken link ${href}`);
      else if (anchor && !page.ids.has(anchor)) fail(file, `missing anchor ${href}`);
    } else if (!existsSync(path.join(dist, decodeURIComponent(resolved)))) fail(file, `broken link ${href}`);
  }
  const rawDescription = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1];
  const description = rawDescription == null ? null : unescape(rawDescription);
  if (!description) fail(file, 'missing name="description"');
  else {
    if (description.length < 120 || description.length > 160)
      fail(file, `meta description is ${description.length} characters (needs 120–160)`);
    if (descriptions.has(description)) fail(file, `duplicate description (also ${descriptions.get(description)})`);
    descriptions.set(description, file);
  }
  const alts = {};
  for (const m of html.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]*)"\s+href="([^"]*)"/gi))
    alts[m[1]] = new URL(m[2]).pathname;
  if (!alts["x-default"]) fail(file, "missing hreflang alternates");
  pageAlternates.set(url, alts);
  if (url === "/") {
    if (!alts.en) fail(file, 'missing hreflang="en"');
    continue;
  }
  for (const r of REQUIRED) if (!html.includes(r)) fail(file, `missing ${r}`);
  const canonical = html.match(/rel="canonical" href="([^"]*)"/)?.[1];
  if (canonical && new URL(canonical).pathname !== url) fail(file, `canonical points at a different page: ${canonical}`);
  const title = unescape(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
  if (titles.has(title)) fail(file, `duplicate title (also ${titles.get(title)})`);
  titles.set(title, file);
  if (!/^\/news\/.+/.test(url)) {
    const isZh = url.startsWith("/zh/");
    const maxLen = isZh ? 68 : 80;
    if (title.length > maxLen) fail(file, `<title> is ${title.length} chars (max ${maxLen}): ${title}`);
  }
}

for (const { file, id } of referencedLdIds)
  if (!definedLdIds.has(id)) fail(file, `unresolved JSON-LD @id reference ${id}`);

for (const [url, alts] of pageAlternates) {
  if (url === "/" || (!alts.en && !alts["zh-CN"])) continue;
  for (const target of [alts.en, alts["zh-CN"], alts["x-default"]].filter(Boolean))
    if (!pages.has(target)) fail(pages.get(url).file, `hreflang points to missing page ${target}`);
  if (alts.en && alts["zh-CN"]) {
    const enAlts = pageAlternates.get(alts.en);
    const zhAlts = pageAlternates.get(alts["zh-CN"]);
    if (enAlts?.["zh-CN"] !== alts["zh-CN"] || enAlts?.en !== alts.en || zhAlts?.en !== alts.en || zhAlts?.["zh-CN"] !== alts["zh-CN"])
      fail(pages.get(url).file, `non-reciprocal hreflang between ${alts.en} and ${alts["zh-CN"]}`);
  }
}

const feedPath = path.join(dist, "news/feed.xml");
if (!existsSync(feedPath)) fail("news/feed.xml", "missing");
else {
  const feed = await readFile(feedPath, "utf8");
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  for (const item of items) {
    const linkPath = item.match(/<link>https?:\/\/[^/]+(\/[^<]*)<\/link>/)?.[1];
    const guidPath = item.match(/<guid[^>]*>https?:\/\/[^/]+(\/[^<]*)<\/guid>/)?.[1];
    if (!linkPath || !pages.has(linkPath)) fail("news/feed.xml", `item <link> missing from built pages: ${linkPath ?? ""}`);
    if (!guidPath || !pages.has(guidPath)) fail("news/feed.xml", `item <guid> missing from built pages: ${guidPath ?? ""}`);
    if (!/<dc:creator>[\s\S]+?<\/dc:creator>/.test(item)) fail("news/feed.xml", `item ${linkPath ?? ""} missing <dc:creator>`);
    const articleHtml = linkPath ? pages.get(linkPath)?.html ?? "" : "";
    const ogImg = articleHtml.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1] ?? "";
    if (ogImg && !ogImg.endsWith("/og/pareto-en.png") && !/<enclosure\b/.test(item))
      fail("news/feed.xml", `item ${linkPath ?? ""} missing <enclosure> for cover image`);
    const encoded = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1] ?? "";
    if (/(?:href|src)="\/(?!\/)/.test(encoded)) fail("news/feed.xml", `item ${linkPath ?? ""} has relative URL in <content:encoded>`);
  }
}

const sitemap = await readFile(path.join(dist, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
for (const loc of locs) if (!pages.has(loc)) fail("sitemap.xml", `lists missing page ${loc}`);
const sitemapUrls = new Set(locs);
if (sitemapUrls.size !== locs.length) fail("sitemap.xml", "duplicate URLs");
for (const [url, { file }] of pages) if (!sitemapUrls.has(url)) fail(file, "missing from sitemap");
for (const f of ["404.html", "zh/404.html", "robots.txt", "llms.txt", "llms-full.txt", "_headers", "_redirects"])
  if (!existsSync(path.join(dist, f))) fail(f, "missing");

const manifestPath = path.join(dist, "data/indexnow-manifest.json");
if (!existsSync(manifestPath)) fail("data/indexnow-manifest.json", "missing");
else {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.version !== 1 || !manifest.pages || typeof manifest.pages !== "object" || Array.isArray(manifest.pages))
      fail("data/indexnow-manifest.json", "invalid schema");
    else {
      for (const loc of sitemapUrls) if (!(loc in manifest.pages)) fail("data/indexnow-manifest.json", `missing page ${loc}`);
      for (const [k, v] of Object.entries(manifest.pages)) {
        if (!sitemapUrls.has(k)) fail("data/indexnow-manifest.json", `lists non-sitemap page ${k}`);
        if (typeof v !== "string" || !/^[a-f0-9]{12}$/.test(v)) fail("data/indexnow-manifest.json", `invalid hash for ${k}`);
      }
    }
  } catch (e) {
    fail("data/indexnow-manifest.json", `invalid JSON: ${e.message}`);
  }
}

// A reverse pair is an HTTP redirect, never a second indexable comparison.
const redirects = new Map();
if (existsSync(path.join(dist, "_redirects"))) {
  for (const line of (await readFile(path.join(dist, "_redirects"), "utf8")).split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [from, to, status] = line.trim().split(/\s+/);
    if (redirects.has(from)) fail("_redirects", `duplicate source ${from}`);
    redirects.set(from, to);
    if (status !== "301" || !pages.has(to) || from === to || pages.has(from))
      fail("_redirects", `invalid comparison redirect ${line}`);
  }
}
for (const [url, { file, html }] of pages) {
  if (!/^(\/zh)?\/compare\/[^/]+\/$/.test(url)) continue;
  const [a, b] = url.split("/").at(-2).split("-vs-");
  const reverse = url.replace(`${a}-vs-${b}/`, `${b}-vs-${a}/`);
  for (const alias of [reverse, reverse.slice(0, -1)])
    if (redirects.get(alias) !== url) fail(file, `missing reverse redirect ${alias}`);
  if (!existsSync(path.join(dist, file.replace(/\.html$/, ".md")))) fail(file, "missing Markdown copy");
  if (!html.includes('id="basis"')) fail(file, "missing comparison methodology");
  try {
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
    const about = graph.find((o) => o["@type"] === "WebPage")?.about;
    const expected = new Set([`/models/${a}/#model`, `/models/${b}/#model`]);
    if (!Array.isArray(about) || about.length !== 2 || about.some((o) => {
      const entity = new URL(o["@id"]);
      return !expected.delete(entity.pathname + entity.hash);
    }) || expected.size !== 0) fail(file, "comparison must identify both model entities");
  } catch (e) {
    fail(file, `invalid comparison structured data: ${e.message}`);
  }
}

// Every catalog model must remain publishable even without any price points.
const siteData = JSON.parse(await readFile(path.join(dist, "data/site.json"), "utf8"));
for (const model of siteData.models ?? []) {
  const slug = model.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const priced = siteData.points.some(p => p.model === model.id);
  for (const prefix of ["", "/zh"]) {
    const url = `${prefix}/models/${slug}/`;
    const p = pages.get(url);
    if (!p) { fail(url, "catalog model page missing"); continue; }
    if (!pages.get(`${prefix}/models/`)?.html.includes(`href="${url}"`)) fail(url, "missing from model directory");
    if (!priced) {
      if (/unmetered on every channel|所有渠道均不计额度/.test(p.html)) fail(url, "missing price misrepresented as unmetered");
      if (p.html.includes(`lock=${encodeURIComponent(`model:${model.id}`)}`)) fail(url, "unpriced model links to empty price chart");
      if (!p.html.includes(prefix ? "尚未收录" : "not yet been recorded")) fail(url, "missing pricing status");
      const graph = JSON.parse(p.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
      if (graph.find(o => o["@type"] === "SoftwareApplication")?.offers) fail(url, "unpriced model publishes fabricated offers");
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} problem(s):\n` + problems.slice(0, 50).join("\n"));
  process.exit(1);
}
console.log(`Checked ${pages.size} pages and ${locs.length} sitemap URLs: no problems.`);
