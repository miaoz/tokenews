export const DEFAULT_MAX_URLS = 50;
export const DEFAULT_DELAY_MS = 250;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Parse <url><loc>...</loc> entries from sitemap XML into pathname strings. */
export function parseSitemapPaths(xml) {
  const paths = new Set();
  for (const m of String(xml ?? "").matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      paths.add(new URL(m[1].trim()).pathname);
    } catch {
      // Ignore malformed loc entries.
    }
  }
  return paths;
}

/**
 * Diff next and live content manifests. When liveManifest is missing (e.g.
 * migrating from sitemap lastmod diffs), fall back to liveSitemapPaths so only
 * newly added pages are reported instead of dumping the whole site.
 */
export function diffManifests(nextManifest, liveManifest, liveSitemapPaths = null) {
  if (
    nextManifest?.version !== 1 ||
    !nextManifest.pages ||
    typeof nextManifest.pages !== "object" ||
    Array.isArray(nextManifest.pages)
  ) {
    throw new Error("Invalid next indexnow-manifest.json");
  }

  const nextPages = nextManifest.pages;
  if (
    !liveManifest ||
    liveManifest.version !== 1 ||
    !liveManifest.pages ||
    typeof liveManifest.pages !== "object" ||
    Array.isArray(liveManifest.pages)
  ) {
    const added =
      liveSitemapPaths?.size > 0
        ? Object.keys(nextPages).filter((p) => !liveSitemapPaths.has(p)).sort()
        : [];
    return { added, modified: [], removed: [], initialized: true };
  }

  const livePages = liveManifest.pages;
  const added = [];
  const modified = [];
  const removed = [];

  for (const [p, hash] of Object.entries(nextPages)) {
    if (!(p in livePages)) added.push(p);
    else if (livePages[p] !== hash) modified.push(p);
  }
  for (const p of Object.keys(livePages)) {
    if (!(p in nextPages)) removed.push(p);
  }

  added.sort();
  modified.sort();
  removed.sort();
  return { added, modified, removed, initialized: false };
}

/**
 * Guard against IndexNow bulk/batch submissions: when total changes exceed
 * maxUrls (e.g. site-wide template updates), submit only genuinely new pages
 * (if within maxUrls) and let sitemap.xml handle bulk refreshes.
 */
export function selectSubmissionPaths({ added, modified, removed }, maxUrls = DEFAULT_MAX_URLS) {
  const total = added.length + modified.length + removed.length;
  if (total === 0) return { paths: [], skippedBulk: false, total: 0 };
  if (total <= maxUrls) return { paths: [...added, ...modified, ...removed], skippedBulk: false, total };
  if (added.length > 0 && added.length <= maxUrls) {
    return { paths: [...added], skippedBulk: true, total };
  }
  return { paths: [], skippedBulk: true, total };
}

/**
 * Submit changed URLs one by one via IndexNow GET streaming requests,
 * respecting a bulk cap and pacing delay, and halting immediately on HTTP 429.
 */
export async function submitUrls({
  urls,
  site,
  key,
  maxUrls = DEFAULT_MAX_URLS,
  delayMs = DEFAULT_DELAY_MS,
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (!unique.length) return { submitted: 0, rateLimited: false, skippedBulk: false };
  if (unique.length > maxUrls) return { submitted: 0, rateLimited: false, skippedBulk: true };

  const cleanSite = site.replace(/\/+$/, "");
  const keyLocation = `${cleanSite}/${key}.txt`;
  let submitted = 0;

  for (let i = 0; i < unique.length; i++) {
    const url = unique[i];
    const endpoint = new URL(INDEXNOW_ENDPOINT);
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("key", key);
    endpoint.searchParams.set("keyLocation", keyLocation);

    const res = await fetchFn(endpoint.toString(), { method: "GET" });
    if (res.status === 429) {
      return { submitted, rateLimited: true, skippedBulk: false };
    }
    if (!res.ok) {
      throw new Error(`IndexNow answered ${res.status} for ${url}: ${await res.text()}`);
    }
    submitted++;
    if (delayMs > 0 && i < unique.length - 1) {
      await sleepFn(delayMs);
    }
  }

  return { submitted, rateLimited: false, skippedBulk: false };
}
