// Tells IndexNow (Bing, and through it Copilot, DuckDuckGo and Yahoo; also
// Yandex, Seznam, Naver) which pages changed via single-URL GET streaming so
// they are recrawled promptly without triggering Bing's Batch Mode warnings.
// Used by deploy.yml:
//
//   node scripts/indexnow.mjs diff > changed.txt     before deploying: URLs whose content hash
//                                                    in web/dist/data/indexnow-manifest.json
//                                                    differs from the live manifest
//   node scripts/indexnow.mjs submit changed.txt     after deploying: stream each URL via GET
//
// The key is public by design: IndexNow checks that SITE/<key>.txt holds it
// (web/public/<key>.txt).
import { readFile } from "node:fs/promises";
import {
  DEFAULT_DELAY_MS,
  DEFAULT_MAX_URLS,
  diffManifests,
  parseSitemapPaths,
  selectSubmissionPaths,
  submitUrls,
} from "./lib/indexnow.mjs";

const KEY = "0eaa5771b5fdd84176e27b9df559bcf9";
const SITE = (process.env.SITE_URL ?? "https://tokenews.xyz").replace(/\/+$/, "");

function parseIntEnv(name, fallback, min) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}, got: ${raw}`);
  return n;
}

const maxUrls = parseIntEnv("INDEXNOW_MAX_URLS", DEFAULT_MAX_URLS, 1);
const delayMs = parseIntEnv("INDEXNOW_DELAY_MS", DEFAULT_DELAY_MS, 0);

const [mode, file] = process.argv.slice(2);
if (mode === "diff") {
  const nextManifest = JSON.parse(
    await readFile(new URL("../web/dist/data/indexnow-manifest.json", import.meta.url), "utf8"),
  );
  let liveManifest = null;
  let liveSitemapPaths = null;

  const manifestRes = await fetch(`${SITE}/data/indexnow-manifest.json`);
  if (manifestRes.ok) {
    liveManifest = await manifestRes.json();
  } else {
    const sitemapRes = await fetch(`${SITE}/sitemap.xml`);
    if (sitemapRes.ok) liveSitemapPaths = parseSitemapPaths(await sitemapRes.text());
  }

  const diff = diffManifests(nextManifest, liveManifest, liveSitemapPaths);
  const { paths, skippedBulk, total } = selectSubmissionPaths(diff, maxUrls);

  if (diff.initialized) {
    console.error(
      `IndexNow: initialized live manifest baseline (${diff.added.length} new page(s) vs live sitemap).`,
    );
  }
  if (skippedBulk) {
    console.error(
      `IndexNow: detected bulk update (${total} changed URLs > max ${maxUrls}); submitting ${paths.length} new URL(s) and relying on sitemap.xml for the rest.`,
    );
  } else {
    console.error(
      `IndexNow: ${diff.added.length} added, ${diff.modified.length} modified, ${diff.removed.length} removed -> ${paths.length} URL(s) queued.`,
    );
  }

  for (const p of paths) console.log(`${SITE}${p}`);
} else if (mode === "submit") {
  if (!file) {
    console.error("Usage: node scripts/indexnow.mjs diff | submit <file>");
    process.exit(1);
  }
  const urlList = (await readFile(file, "utf8")).split("\n").map((s) => s.trim()).filter(Boolean);
  const result = await submitUrls({ urls: urlList, site: SITE, key: KEY, maxUrls, delayMs });

  if (result.skippedBulk) {
    console.log(`IndexNow: skipped ${urlList.length} URL(s) (exceeds streaming cap ${maxUrls}; rely on sitemap.xml).`);
  } else if (result.rateLimited) {
    console.warn(`IndexNow: rate limited (HTTP 429) after submitting ${result.submitted}/${urlList.length} URL(s); remaining URLs left for sitemap crawl.`);
  } else if (!result.submitted) {
    console.log("IndexNow: no changed pages.");
  } else {
    console.log(`IndexNow: streamed ${result.submitted} changed page(s) via single-URL GET.`);
  }
} else {
  console.error("Usage: node scripts/indexnow.mjs diff | submit <file>");
  process.exit(1);
}
