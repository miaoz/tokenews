// Article images live in the R2 bucket `tokenews-media`, served from
// media.tokenews.xyz (the bucket's custom domain, behind Cloudflare's cache),
// not in git or the site's static assets. scripts/publish-news.mjs compresses
// and uploads them and records each one in content/news/media.json, which the
// build reads for image sizes and srcsets and to check that every image an
// article uses was uploaded.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export const MEDIA_BUCKET = "tokenews-media";
export const MEDIA_URL = (process.env.MEDIA_URL ?? "https://media.tokenews.xyz").replace(/\/+$/, "");

/**
 * @typedef {{ key: string, width: number, height: number, bytes: number }} Variant
 * @typedef {{ width: number, height: number, bytes: number, type: string, sizes: Variant[], og?: Variant }} MediaImage
 *   Keyed by the largest WebP (the URL in the Markdown); `sizes` are the smaller
 *   WebP widths for srcset; `og` is a JPEG for social cards (cover images only).
 * @returns {Promise<Record<string, MediaImage>>}
 */
export async function loadMediaManifest(file) {
  return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : {};
}

export const mediaUrl = (key) => `${MEDIA_URL}/${key}`;

/** The object key of a media URL, or null if the URL is not on the media domain. */
export const mediaKey = (url) => (url.startsWith(`${MEDIA_URL}/`) ? url.slice(MEDIA_URL.length + 1) : null);
