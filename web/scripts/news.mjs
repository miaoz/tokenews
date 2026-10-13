// News articles: one Markdown file per article in content/news/, with YAML
// front matter (format in content/news/README.md). Loaded at build time by
// build-pages.mjs, validated against the dataset so every maker, model and
// provider an article names has a page to link to, and rendered to HTML.
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELDS = new Set(["title", "date", "updated", "summary", "author", "makers", "models", "providers", "tags", "sources", "image", "draft"]);

// External links open in a new tab and pass no referrer or ranking.
const marked = new Marked({
  gfm: true,
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const external = /^https?:\/\//.test(href);
      return `<a href="${href}"${title ? ` title="${title}"` : ""}${external ? ' rel="noopener" target="_blank"' : ""}>${text}</a>`;
    },
  },
});

const list = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);
// YAML reads an unquoted 2026-10-13 as a Date; keep dates as plain strings.
const day = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? value : String(value));

/**
 * @param {object} o
 * @param {string} o.dir      content/news
 * @param {Map<string, unknown>} o.models     model id → model
 * @param {Map<string, unknown>} o.makers     maker name → maker
 * @param {Map<string, unknown>} o.providers  provider name → provider
 * @param {boolean} [o.drafts] include `draft: true` articles (local preview)
 */
export async function loadNews({ dir, models, makers, providers, drafts = false }) {
  if (!existsSync(dir)) return [];
  const problems = [];
  const articles = [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
  for (const file of files) {
    const fail = (message) => problems.push(`content/news/${file}: ${message}`);
    const match = (await readFile(path.join(dir, file), "utf8")).match(FRONT_MATTER);
    if (!match) {
      fail("missing the --- front matter block");
      continue;
    }
    let meta;
    try {
      meta = parseYaml(match[1]) ?? {};
    } catch (e) {
      fail(`front matter is not valid YAML: ${e.message}`);
      continue;
    }
    for (const key of Object.keys(meta)) if (!FIELDS.has(key)) fail(`unknown field "${key}"`);
    // File name: YYYY-MM-DD-the-slug.md; the URL is /news/the-slug/.
    const slug = file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
    if (!SLUG.test(slug)) fail(`file name must be YYYY-MM-DD-lowercase-words.md, got "${file}"`);
    const date = day(meta.date);
    const updated = day(meta.updated);
    if (typeof meta.title !== "string" || !meta.title.trim()) fail("title is required");
    if (!DATE.test(date ?? "")) fail("date is required, as YYYY-MM-DD");
    if (updated != null && !DATE.test(updated)) fail("updated must be YYYY-MM-DD");
    if (typeof meta.summary !== "string" || !meta.summary.trim()) fail("summary is required");
    else if (meta.summary.length > 200) fail(`summary is ${meta.summary.length} characters; keep it under 200 (it is the search snippet)`);
    if (!match[2].trim()) fail("the article body is empty");

    const refs = (field, known, hint) =>
      list(meta[field]).map(String).filter((name) => {
        if (known.has(name)) return true;
        fail(`${field}: "${name}" is not in the dataset (${hint})`);
        return false;
      });
    const article = {
      file,
      slug,
      title: String(meta.title ?? "").trim(),
      date,
      updated: updated ?? date,
      summary: String(meta.summary ?? "").trim(),
      author: meta.author ? String(meta.author) : null,
      makers: refs("makers", makers, "use the maker's name as on /makers/, e.g. Anthropic"),
      models: refs("models", models, "use the model ID, e.g. claude-opus-5.5"),
      providers: refs("providers", providers, "use the provider's name as on /providers/, e.g. OpenCode"),
      tags: list(meta.tags).map(String),
      sources: list(meta.sources).map((s) => (typeof s === "string" ? { title: s, url: s } : { title: String(s.title ?? s.url), url: String(s.url) })),
      image: meta.image ? String(meta.image) : null,
      draft: meta.draft === true,
      html: marked.parse(match[2]),
    };
    for (const s of article.sources) if (!/^https?:\/\//.test(s.url)) fail(`sources: "${s.url}" is not an http(s) URL`);
    if (article.draft && !drafts) continue;
    articles.push(article);
  }
  const seen = new Map();
  for (const a of articles) {
    if (seen.has(a.slug)) problems.push(`content/news/${a.file}: same URL /news/${a.slug}/ as ${seen.get(a.slug)}`);
    seen.set(a.slug, a.file);
  }
  if (problems.length) throw new Error(`News articles have ${problems.length} problem(s):\n${problems.join("\n")}`);
  return articles.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}
