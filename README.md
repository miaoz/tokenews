# Tokenews

**Directory and news of models, makers and products for the AI era** · AI 时代的模型、厂商、产品目录和资讯

<https://tokenews.xyz>

Every AI model, maker (厂商) and provider (供应商) has its own page: what each product includes, what each model really costs — a subscription's monthly fee divided by the tokens you can actually use — set against official API list prices and independent leaderboards. An interactive explorer plots price against capability.

## How it is built

```
upstream/            data snapshot synced from Real API Pricing — never edited by hand
upstream.lock.json   which upstream commit the snapshot comes from
scripts/
  sync-upstream.mjs  pulls only the data paths into upstream/
  lib/build-site-data.mjs   our adapter: upstream/ → web/public/data/site.json
web/                 the site: React explorer + static page generator (see web/README.md)
www-redirect/        Worker that 301s www.tokenews.xyz to tokenews.xyz
.github/workflows/   CI, deploy, daily upstream sync
```

**Upstream supplies data only.** The pricing, allowance and leaderboard data comes from [Real API Pricing](https://github.com/Fei2411/real-api-pricing) (MIT). `scripts/sync-upstream.mjs` fetches just the paths listed in it — `config/`, `derived/`, `data/adopted.csv`, `data/conventions.json`, `data/i18n/`, `data/research/`, two Pareto PNGs and the licence — into `upstream/`. No upstream code is merged: the site, its design and the adapter are ours and evolve independently. If upstream changes its own copy of the adapter, the sync flags it, because that usually means the data format moved.

## Everyday commands

```sh
npm ci                 # once (root: Wrangler); `npm run build` installs web/
npm run sync           # pull the latest upstream data (or: npm run sync -- <commit>)
npm run build          # web/dist: explorer + every maker, provider and model page
npm test               # explorer domain tests against the synced data
npm run check          # links, anchors, metadata and sitemap of the built pages
npm run cf:dev         # serve web/dist locally with Cloudflare routing and headers
npm run cf:deploy      # deploy both Workers (needs `npx wrangler login` or an API token)
```

## Automation

- **CI** (`ci.yml`): pull requests build, test and check.
- **Deploy** (`deploy.yml`): every push to `main` builds, tests, checks and deploys `tokenews` and `tokenews-www` to Cloudflare.
- **Upstream sync** (`sync-upstream.yml`): daily at 10:17 Beijing time, or by hand with an optional upstream ref. Unchanged data does nothing. Changed data that passes build, tests and checks is committed to `main` and deployed. A failure opens or updates an issue labelled `upstream-sync`, and the live site keeps the previous data.

Repository secrets needed by the deploy: `CLOUDFLARE_API_TOKEN` (a token from the "Edit Cloudflare Workers" template, scoped to this account and the `tokenews.xyz` zone) and `CLOUDFLARE_ACCOUNT_ID`.

## Licence and attribution

MIT, see `LICENSE`. The explorer, data adapter and methodology are derived from Real API Pricing by FeiZhuLulu (MIT); its licence travels with the data in `upstream/LICENSE`. The data cites third-party sources that keep their own terms; see upstream's `SOURCES.md` and `PUBLICATION.md`.
