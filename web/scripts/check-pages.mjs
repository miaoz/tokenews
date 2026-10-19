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
const titles = new Map();
const descriptions = new Map();
for (const [url, { file, html }] of pages) {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))
    try {
      // Google rejects a Dataset whose description is outside 50–5000 characters.
      const visit = (o) => {
        if (Array.isArray(o)) return o.forEach(visit);
        if (!o || typeof o !== "object") return;
        if (o["@type"] === "Dataset" && !(o.description?.length >= 50 && o.description.length <= 5000))
          fail(file, `Dataset description is ${o.description?.length ?? 0} characters (needs 50–5000)`);
        Object.values(o).forEach(visit);
      };
      visit(JSON.parse(m[1]));
    } catch (e) {
      fail(file, `invalid JSON-LD: ${e.message}`);
    }
  for (const [, raw] of html.matchAll(/href="([^"]*)"/g)) {
    const href = unescape(raw);
    if (/^(https?:|mailto:)/.test(href) || href.startsWith("/#")) continue;
    const [target, anchor] = href.split("#");
    const resolved = target === "" ? url : target;
    if (!resolved.startsWith("/")) continue;
    if (resolved.endsWith("/")) {
      const page = pages.get(resolved);
      if (!page) fail(file, `broken link ${href}`);
      else if (anchor && !page.ids.has(anchor)) fail(file, `missing anchor ${href}`);
    } else if (!existsSync(path.join(dist, decodeURIComponent(resolved)))) fail(file, `broken link ${href}`);
  }
  if (url === "/") continue;
  for (const r of REQUIRED) if (!html.includes(r)) fail(file, `missing ${r}`);
  const canonical = html.match(/rel="canonical" href="([^"]*)"/)?.[1];
  if (canonical && new URL(canonical).pathname !== url) fail(file, `canonical points at a different page: ${canonical}`);
  if (!html.includes('hreflang="x-default"')) fail(file, "missing hreflang alternates");
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  const description = html.match(/name="description" content="([^"]*)"/)?.[1];
  if (titles.has(title)) fail(file, `duplicate title (also ${titles.get(title)})`);
  if (descriptions.has(description)) fail(file, `duplicate description (also ${descriptions.get(description)})`);
  titles.set(title, file);
  descriptions.set(description, file);
}

const sitemap = await readFile(path.join(dist, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
for (const loc of locs) if (!pages.has(loc)) fail("sitemap.xml", `lists missing page ${loc}`);
const sitemapUrls = new Set(locs);
if (sitemapUrls.size !== locs.length) fail("sitemap.xml", "duplicate URLs");
for (const [url, { file }] of pages) if (!sitemapUrls.has(url)) fail(file, "missing from sitemap");
for (const f of ["404.html", "zh/404.html", "robots.txt", "llms.txt", "llms-full.txt", "_headers", "_redirects"])
  if (!existsSync(path.join(dist, f))) fail(f, "missing");

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

if (problems.length) {
  console.error(`${problems.length} problem(s):\n` + problems.slice(0, 50).join("\n"));
  process.exit(1);
}
console.log(`Checked ${pages.size} pages and ${locs.length} sitemap URLs: no problems.`);
