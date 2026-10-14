// News articles: one Markdown file per article in content/news/, with YAML
// front matter (format in content/news/README.md). Loaded at build time by
// build-pages.mjs, validated against the dataset so every maker, model and
// provider an article names has a page to link to, and rendered to HTML.
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";
import { MEDIA_URL, loadMediaManifest, mediaKey, mediaUrl } from "./media.mjs";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELDS = new Set(["title", "date", "updated", "summary", "author", "makers", "models", "providers", "tags", "sources", "image", "draft"]);

const attr = (s) => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Renders one article body. External links open in a new tab and pass no
// referrer or ranking. Images must be uploaded to the media bucket (or be other
// http(s) URLs); `image(url)` resolves one to its size and reports problems.
// An image alone in its paragraph becomes a <figure>, its title the caption.
// `##` headings get ids for the article's contents list (`toc`).
const RESERVED_IDS = new Set(["main", "sources", "mentioned", "more", "news", "contents"]);
function render(markdown, image) {
  let first = true;
  const toc = [];
  const ids = new Set(RESERVED_IDS);
  const headingId = (text) => {
    const base = text.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/g, "").replace(/^[\d.\s]+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  const img = (href, text) => {
    const found = image(href);
    // Uploaded images come in several widths; the article column is at most 720px wide.
    const srcset = found?.sizes?.length ? ` srcset="${[...found.sizes.map((v) => `${mediaUrl(v.key)} ${v.width}w`), `${attr(href)} ${found.width}w`].join(", ")}" sizes="(min-width: 760px) 720px, 100vw"` : "";
    const html = `<img src="${attr(href)}"${srcset} alt="${attr(text)}"${found?.width ? ` width="${found.width}" height="${found.height}"` : ""}${first ? "" : ' loading="lazy"'} decoding="async">`;
    first = false;
    return html;
  };
  const marked = new Marked({
    gfm: true,
    renderer: {
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href);
        return `<a href="${href}"${title ? ` title="${title}"` : ""}${external ? ' rel="noopener" target="_blank"' : ""}>${text}</a>`;
      },
      image({ href, text }) {
        return img(href, text);
      },
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        if (depth > 3) return false;
        const id = headingId(html);
        if (depth === 2) toc.push({ id, text: this.parser.parseInline(tokens, this.parser.textRenderer) });
        return `<h${depth} id="${id}">${html}</h${depth}>\n`;
      },
      paragraph({ tokens }) {
        const content = tokens.filter((t) => !(t.type === "text" && !t.raw.trim()));
        if (content.length !== 1 || content[0].type !== "image") return false;
        const { href, text, title } = content[0];
        return `<figure>${img(href, text)}${title ? `<figcaption>${attr(title)}</figcaption>` : ""}</figure>\n`;
      },
    },
  });
  return { html: marked.parse(markdown), toc };
}

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
  const media = await loadMediaManifest(path.join(dir, "media.json"));
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
    if (/^# /m.test(match[2].replace(/^(```|~~~)[\s\S]*?^\1/gm, ""))) fail("the body has a # heading; the title is the page's heading, so start sections at ##");

    // Images: uploaded to the media bucket by `npm run news:publish`, or another http(s) URL.
    const images = [];
    const image = (url, field = "body image") => {
      const key = mediaKey(url);
      if (key != null) {
        if (!media[key]) return fail(`${field} ${url} is not in content/news/media.json; upload it with npm run news:publish`);
        const found = { url, ...media[key] };
        images.push(found);
        return found;
      }
      if (!/^https?:\/\//.test(url)) return fail(`${field} "${url}" is a local file; publish the article with npm run news:publish to upload its images to ${MEDIA_URL}`);
      images.push({ url });
      return { url };
    };
    const { html, toc } = render(match[2], (url) => image(url));
    const cover = meta.image ? image(String(meta.image), "image field") : images[0];

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
      // The social/structured-data image: `image:`, else the body's first image,
      // as its JPEG copy when there is one (not every social network takes WebP).
      image: cover?.og
        ? { url: mediaUrl(cover.og.key), width: cover.og.width, height: cover.og.height, type: "image/jpeg" }
        : cover?.url
          ? { url: cover.url, width: cover.width ?? null, height: cover.height ?? null, type: cover.type ?? null }
          : null,
      // The cover as shown on the news index: the WebP with its srcset.
      cover: cover?.url ? { url: cover.url, width: cover.width ?? null, height: cover.height ?? null, sizes: (cover.sizes ?? []).map((v) => ({ url: mediaUrl(v.key), width: v.width })) } : null,
      minutes: Math.max(1, Math.round(match[2].replace(/```[\s\S]*?```/g, "").split(/\s+/).length / 230)),
      draft: meta.draft === true,
      html,
      toc,
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
