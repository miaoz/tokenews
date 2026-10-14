// Publishes a news article whose images are local files:
//
//   npm run news:publish -- <article folder or .md> [--slug <slug>] [--dry-run] [--push]
//
// Compresses every local image the Markdown uses (`![alt](assets/x.png)`, and a
// local `image:` in the front matter) to WebP at most 1600px wide plus an 800px
// copy for small screens, and the cover (`image:`, else the first image) to a
// 1200px JPEG for social cards; uploads them to the R2 bucket behind
// media.tokenews.xyz under content-hashed keys (cached for a year); records
// them in content/news/media.json; and writes the article to
// content/news/YYYY-MM-DD-<slug>.md with the images' media URLs. Images already
// uploaded are not sent again, and images the article no longer uses are
// deleted, so re-running after an edit uploads only what changed. --push then
// builds and checks the site and commits and pushes the article, which deploys it.
// Uploading needs Wrangler logged in to the Cloudflare account (`npx wrangler login`).
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { parse as parseYaml } from "yaml";
import { MEDIA_BUCKET, loadMediaManifest, mediaUrl } from "./media.mjs";

// Compression settings. Changing them changes every key (they are part of the
// hash), so republishing an article re-encodes its images.
const WIDTHS = [800, 1600]; // the article column is 720px; 1600 covers 2x screens
const WEBP = { quality: 82, effort: 6, smartSubsample: true };
const OG = { width: 1200, jpeg: { quality: 82, mozjpeg: true } };
const INPUTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);
const MAX_INPUT = 25 * 1024 * 1024;
const WARN_OUTPUT = 400 * 1024;

const repo = fileURLToPath(new URL("../../", import.meta.url));
const newsDir = path.join(repo, "content/news");
const manifestFile = path.join(newsDir, "media.json");

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { slug: { type: "string" }, "dry-run": { type: "boolean" }, push: { type: "boolean" } },
});
const die = (message) => {
  console.error(message);
  process.exit(1);
};
if (positionals.length !== 1) die("Usage: npm run news:publish -- <article folder or .md> [--slug <slug>] [--dry-run] [--push]");

// The article: a .md file, or the one .md file in a folder.
let source = path.resolve(process.cwd(), positionals[0]);
if (!existsSync(source)) die(`${positionals[0]} does not exist`);
if (statSync(source).isDirectory()) {
  const mds = readdirSync(source).filter((f) => f.endsWith(".md") && f !== "README.md");
  if (mds.length !== 1) die(`${positionals[0]} should hold exactly one .md file, found ${mds.length}`);
  source = path.join(source, mds[0]);
}
const text = await readFile(source, "utf8");
const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
if (!match)
  die(`${path.relative(repo, source)} has no front matter. Start it with a block like this (fields in content/news/README.md):

---
title: The headline
date: ${new Date().toISOString().slice(0, 10)}
summary: One or two sentences, under 200 characters.
makers: [Google]
tags: [release]
---`);
const meta = parseYaml(match[1]) ?? {};
const date = meta.date instanceof Date ? meta.date.toISOString().slice(0, 10) : String(meta.date ?? "");
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die("front matter: date is required, as YYYY-MM-DD");

// The slug: --slug, else the file name (minus a leading date), else its folder's name.
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const base = path.basename(source, ".md");
const slug = slugify(opts.slug ?? (base === "index" ? path.basename(path.dirname(source)) : base).replace(/^\d{4}-\d{2}-\d{2}-/, ""));
if (!slug) die("could not derive a slug; pass --slug");
const target = path.join(newsDir, `${date}-${slug}.md`);
const prefix = `news/${slug}/`;

// Image references in the body (outside fenced code) and in `image:`.
const IMAGE = /(!\[[^\]]*\]\(\s*)(?:<([^>]+)>|([^)\s]+))((?:\s+(?:"[^"]*"|'[^']*'))?\s*\))/g;
const parts = match[2].split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m);
const IMAGE_FIELD = /^(image:\s*)(["']?)(.+?)\2\s*$/m;
const isLocal = (ref) => !/^(https?:)?\/\//.test(ref) && !ref.startsWith("/");
const bodyRefs = parts.flatMap((part, i) => (i % 2 ? [] : [...part.matchAll(IMAGE)].map((m) => m[2] ?? m[3])));
const coverRef = meta.image ? String(meta.image) : bodyRefs[0];

// Compress each local image; nothing is uploaded until all of them succeed.
const manifest = await loadMediaManifest(manifestFile);
const tmp = await mkdtemp(path.join(os.tmpdir(), "tokenews-media-"));
const uploads = []; // { key, file, type }
const used = new Set();
const done = new Map(); // ref → media URL
async function toMedia(ref) {
  if (!isLocal(ref)) return ref;
  if (done.has(ref)) return done.get(ref);
  const file = path.resolve(path.dirname(source), decodeURI(ref));
  const ext = path.extname(file).toLowerCase();
  if (!existsSync(file)) die(`image ${ref} not found (looked for ${file})`);
  if (!INPUTS.has(ext)) die(`image ${ref}: use PNG, JPEG, GIF, WebP or AVIF`);
  const buf = readFileSync(file);
  if (buf.length > MAX_INPUT) die(`image ${ref} is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${MAX_INPUT / 1048576} MB`);
  const hash = createHash("sha256").update(buf).update(JSON.stringify([WIDTHS, WEBP, OG])).digest("hex").slice(0, 10);
  const stem = `${prefix}${slugify(path.basename(file, ext))}-${hash}`;
  const input = () => sharp(buf, { animated: true }).rotate();
  const { width: srcWidth } = await input().metadata();
  const widths = [...new Set([...WIDTHS.filter((w) => w < srcWidth), Math.min(srcWidth, WIDTHS.at(-1))])].sort((a, b) => a - b);
  const encode = async (key, pipeline, type) => {
    const out = path.join(tmp, key.replaceAll("/", "_"));
    const info = await pipeline.toFile(out);
    uploads.push({ key, file: out, type });
    return { key, width: info.width, height: info.pageHeight ?? info.height, bytes: info.size };
  };
  const mainKey = `${stem}-${widths.at(-1)}.webp`;
  let entry = manifest[mainKey];
  if (!entry) {
    const variants = [];
    for (const w of widths) variants.push(await encode(`${stem}-${w}.webp`, input().resize({ width: w }).webp(WEBP), "image/webp"));
    const main = variants.pop();
    entry = { width: main.width, height: main.height, bytes: main.bytes, type: "image/webp", sizes: variants };
    if (main.bytes > WARN_OUTPUT) console.warn(`  warning: ${ref} is still ${Math.round(main.bytes / 1024)} KB after compression`);
  }
  if (ref === coverRef && !entry.og)
    entry = { ...entry, og: await encode(`${stem}-og.jpg`, sharp(buf).rotate().resize({ width: OG.width, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg(OG.jpeg), "image/jpeg") };
  manifest[mainKey] = entry;
  used.add(mainKey);
  const url = mediaUrl(mainKey);
  done.set(ref, url);
  return url;
}

// One image at a time, so a repeated reference is encoded and uploaded once.
const replaceAsync = async (s, re, fn) => {
  const subs = [];
  for (const m of s.matchAll(re)) subs.push(await fn(...m));
  let i = 0;
  return s.replace(re, () => subs[i++]);
};
let front = match[1];
if (meta.image) front = await replaceAsync(front, IMAGE_FIELD, async (_, key, q, ref) => `${key}${await toMedia(ref)}`);
let body = "";
for (const [i, part] of parts.entries())
  body += i % 2 ? part : await replaceAsync(part, IMAGE, async (_, open, angled, bare, close) => `${open}${await toMedia(angled ?? bare)}${close}`);
const output = `---\n${front}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;

// This article's images it no longer uses (an edited or removed image, or older settings).
const stale = Object.keys(manifest).filter((k) => k.startsWith(prefix) && !used.has(k));
const objects = (k) => [k, ...(manifest[k].sizes ?? []).map((v) => v.key), ...(manifest[k].og ? [manifest[k].og.key] : [])];

const rel = (f) => path.relative(repo, f);
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`Article: ${rel(source)} → ${rel(target)} (/news/${slug}/)`);
for (const k of used) {
  const e = manifest[k];
  console.log(`  ${k.slice(prefix.length)}  ${[...e.sizes, e].map((v) => `${v.width}w ${kb(v.bytes)}`).join(", ")}${e.og ? `, og ${kb(e.og.bytes)}` : ""}`);
}
console.log(uploads.length ? `  ${uploads.length} new file(s) to upload` : "  no new images to upload");
for (const k of stale) console.log(`  delete unused ${objects(k).join(", ")}`);
if (opts["dry-run"]) {
  await rm(tmp, { recursive: true });
  process.exit(0);
}

const run = (cmd, args, stdio = "inherit") => execFileSync(cmd, args, { cwd: repo, stdio });
for (const u of uploads) {
  console.log(`  upload ${u.key}`);
  run("npx", ["wrangler", "r2", "object", "put", `${MEDIA_BUCKET}/${u.key}`, "--file", u.file, "--content-type", u.type, "--cache-control", "public, max-age=31536000, immutable", "--remote"], "ignore");
}
for (const k of stale) {
  for (const key of objects(k)) {
    console.log(`  delete ${key}`);
    run("npx", ["wrangler", "r2", "object", "delete", `${MEDIA_BUCKET}/${key}`, "--remote"], "ignore");
  }
  delete manifest[k];
}
await rm(tmp, { recursive: true });
const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestFile, JSON.stringify(sorted, null, 2) + "\n");
await writeFile(target, output);
console.log(`Wrote ${rel(target)} and ${rel(manifestFile)}.`);

if (!opts.push) {
  console.log("Preview with `npm run build && npm run cf:dev`, then commit both files to main (or rerun with --push).");
  process.exit(0);
}
run("npm", ["run", "build"]);
run("npm", ["run", "check"]);
run("git", ["add", rel(target), rel(manifestFile)]);
run("git", ["commit", "-m", `News: ${meta.title ?? slug}`]);
run("git", ["push"]);
console.log("Pushed; the deploy workflow puts it live in a few minutes.");
