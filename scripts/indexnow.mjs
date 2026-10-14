// Tells IndexNow (Bing, and through it Copilot, DuckDuckGo and Yahoo; also
// Yandex, Seznam, Naver) which pages changed, so they are recrawled within
// minutes instead of whenever a crawler next comes by. Used by deploy.yml:
//
//   node scripts/indexnow.mjs diff > changed.txt     before deploying: URLs in the new
//                                                    web/dist/sitemap.xml that are new or have a
//                                                    newer <lastmod> than the live sitemap
//   node scripts/indexnow.mjs submit changed.txt     after deploying: send them
//
// The key is public by design: IndexNow checks that SITE/<key>.txt holds it
// (web/public/<key>.txt).
import { readFile } from "node:fs/promises";

const KEY = "0eaa5771b5fdd84176e27b9df559bcf9";
const SITE = (process.env.SITE_URL ?? "https://tokenews.xyz").replace(/\/+$/, "");

const entries = (xml) => new Map([...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1], m[2]]));

const [mode, file] = process.argv.slice(2);
if (mode === "diff") {
  const next = entries(await readFile(new URL("../web/dist/sitemap.xml", import.meta.url), "utf8"));
  const res = await fetch(`${SITE}/sitemap.xml`);
  // Without a live sitemap (first deploy) every URL is new.
  const live = res.ok ? entries(await res.text()) : new Map();
  for (const [url, lastmod] of next) if (live.get(url) !== lastmod) console.log(url);
} else if (mode === "submit") {
  const urlList = (await readFile(file, "utf8")).split("\n").filter(Boolean);
  if (!urlList.length) {
    console.log("IndexNow: no changed pages.");
    process.exit(0);
  }
  // One request takes up to 10,000 URLs.
  for (let i = 0; i < urlList.length; i += 10000) {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urlList.slice(i, i + 10000) }),
    });
    // 200 and 202 both mean accepted.
    if (!res.ok) throw new Error(`IndexNow answered ${res.status}: ${await res.text()}`);
  }
  console.log(`IndexNow: submitted ${urlList.length} changed page(s).`);
} else {
  console.error("Usage: node scripts/indexnow.mjs diff | submit <file>");
  process.exit(1);
}
