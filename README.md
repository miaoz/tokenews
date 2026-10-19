# Tokenews

**Directory and news of models, makers and products for the AI era** · AI 时代的模型、厂商、产品目录和资讯

<https://tokenews.xyz>

Every AI model, maker (厂商) and provider (供应商) has its own page: what each product includes, what each model really costs — a subscription's monthly fee divided by the tokens you can actually use — set against official API list prices and independent leaderboards. An interactive explorer plots price against capability.

Curated model comparisons at `/compare/` (Chinese: `/zh/compare/`) put shared subscriptions, token costs and archived benchmark configurations side by side. Price ratios require matching normalized workloads; raw measurements retain their dates and evidence without contributing to the price comparison counts.

## How it is built

```
content/news/        news articles, one Markdown file each (see content/news/README.md)
upstream/            data snapshot synced from Real API Pricing — never edited by hand
upstream.lock.json   which upstream commit the snapshot comes from
scripts/
  sync-upstream.mjs  pulls only the data paths into upstream/
  lib/build-site-data.mjs   our adapter: upstream/ → web/public/data/site.json
web/                 the site: React explorer + static page generator (see web/README.md)
.github/workflows/   CI, deploy, daily upstream sync
```

**News** is English-only Markdown in `content/news/`, written by us. Each article names the makers, models and providers it concerns; the build checks those against the dataset, lists the article under "Related news" on their pages, and publishes `/news/`, one page per article, `/news/feed.xml` (RSS), sitemap and `llms.txt` entries. Commit an article to `main` to publish it.

**Upstream supplies data only.** The pricing, allowance and leaderboard data comes from [Real API Pricing](https://github.com/Fei2411/real-api-pricing) (MIT). `scripts/sync-upstream.mjs` fetches just the paths listed in it — `config/`, `derived/`, `data/adopted.csv`, `data/conventions.json`, `data/i18n/`, `data/research/`, two Pareto PNGs and the licence — into `upstream/`. No upstream code is merged: the site, its design and the adapter are ours and evolve independently. If upstream changes its own copy of the adapter, the sync flags it, because that usually means the data format moved.

## Everyday commands

```sh
npm ci                 # once (root: Wrangler); `npm run build` installs web/
npm run sync           # pull the latest upstream data (or: npm run sync -- <commit>)
npm run build          # web/dist: explorer + every maker, provider and model page
npm test               # explorer domain tests against the synced data
npm run check          # links, anchors, metadata and sitemap of the built pages
npm run cf:dev         # serve web/dist locally with Cloudflare routing and headers
npm run cf:deploy      # deploy static assets (needs `npx wrangler login` or an API token)
```

## Automation

- **CI** (`ci.yml`): pull requests build, test and check.
- **Deploy** (`deploy.yml`): every push to `main` builds, tests, checks and deploys the static-assets site `tokenews` to Cloudflare.
- **Upstream sync** (`sync-upstream.yml`): daily at 10:17 Beijing time, or by hand with an optional upstream ref. Unchanged data does nothing. Changed data that passes build, tests and checks is committed to `main` and deployed. A failure opens or updates an issue labelled `upstream-sync`, and the live site keeps the previous data.

Repository secrets needed by the deploy: `CLOUDFLARE_API_TOKEN` (a token from the "Edit Cloudflare Workers" template, scoped to this account and the `tokenews.xyz` zone) and `CLOUDFLARE_ACCOUNT_ID`.

## Cloudflare routing and billing

Keep the account on **Workers Free**. The site uses Workers Static Assets without a Worker script; ordinary static asset requests are free and unlimited. Do not enable Workers Cache or add a dynamic Worker without reviewing billing and alerts first.

`www.tokenews.xyz` uses a zone **Single Redirect** instead of Worker code:

- Match: `(http.host eq "www.tokenews.xyz")`
- Dynamic target: `concat("https://tokenews.xyz", http.request.uri.path)`
- Status: `301`; preserve query string: enabled
- DNS: keep `www` proxied so Cloudflare evaluates the redirect before reaching the origin.

Manage this rule in Cloudflare → tokenews.xyz → Rules. It is not redeployed by the site workflow. The retired `tokenews-www` Worker must remain unbound from the domain; do not recreate it in CI.

## Licence and attribution

MIT, see `LICENSE`. The explorer, data adapter and methodology are derived from Real API Pricing by FeiZhuLulu (MIT); its licence travels with the data in `upstream/LICENSE`. The data cites third-party sources that keep their own terms; see upstream's `SOURCES.md` and `PUBLICATION.md`.
