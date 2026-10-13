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
      JSON.parse(m[1]);
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
for (const f of ["404.html", "zh/404.html", "robots.txt", "llms.txt", "llms-full.txt", "_headers"])
  if (!existsSync(path.join(dist, f))) fail(f, "missing");

if (problems.length) {
  console.error(`${problems.length} problem(s):\n` + problems.slice(0, 50).join("\n"));
  process.exit(1);
}
console.log(`Checked ${pages.size} pages and ${locs.length} sitemap URLs: no problems.`);
