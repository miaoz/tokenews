# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Tokenews (https://tokenews.xyz) — "Directory and news of models, makers and products for the AI era" / "AI 时代的模型、厂商、产品目录和资讯". A static site on Cloudflare Workers: a React price–capability explorer plus prebuilt pages for every maker, provider and model (English and Chinese) and English-only news.

## Commands

Run from the repository root (Node 22, see `.node-version`):

```sh
npm ci                  # root deps (Wrangler); `npm run build` installs web/ deps itself
npm run sync            # pull latest upstream data into upstream/ (npm run sync -- <ref> for a commit/branch)
npm run build           # web/: data adapter → tsc → vite build → static page generator, output web/dist
npm test                # explorer tests (tsx --test) against the synced data
npm run check           # validate web/dist: JSON-LD, internal links/#anchors, metadata, sitemap — needs a build first
npm run cf:dev          # serve web/dist with Cloudflare routing/headers/404s
npm run cf:deploy       # deploy Workers `tokenews` and `tokenews-www` (CI normally does this)
```

Inside `web/`: `npm run dev` (Vite dev server), `npm run data` (regenerate `web/public/data/site.json`), `npm run pages` (re-run only the static page generator — it fails on an already-processed `dist/index.html`, so prefer a full build). Single test: `cd web && npm run data && npx tsx --test --test-name-pattern="<name>" src/domain.test.ts`. There is no linter; `tsc -b` (part of the build) is the type check. Preview news drafts with `NEWS_DRAFTS=1 npm run build`.

## Architecture

**Data comes from upstream; code is ours.** `upstream/` is a snapshot of selected paths from https://github.com/Fei2411/real-api-pricing (MIT), written only by `scripts/sync-upstream.mjs` and pinned in `upstream.lock.json` (which changes only when the synced data's content hash changes). Never edit `upstream/` by hand and never merge upstream code. `scripts/lib/build-site-data.mjs` is our own copy of upstream's adapter: it validates `upstream/` and produces `web/public/data/site.json` (packed mappings; `web/src/loadData.ts` unpacks them). The sync flags upstream changes to its adapter via `adapterBaseline` in the lock file — that usually means the data format moved. Adding a new upstream input means updating `PATHS` in the sync script.

**Build pipeline (`web/package.json` build):** `scripts/build-data.mjs` (adapter → `public/data/`) → `tsc -b` → `vite build` (the explorer SPA, `src/App.tsx`) → `scripts/build-pages.mjs` (run via `tsx` so it can import `.ts`/`.tsx`). `build-pages.mjs` is the static site generator: it reads `public/data/site.json`, imports the explorer's own helpers from `src/domain.ts` so page wording matches the explorer's "Behind the number" dialog, and writes into `dist/` every maker/provider/model page (en + `/zh/`), index pages, news pages, RSS, `sitemap.xml`, `llms.txt`/`llms-full.txt`, 404 pages, and injects JSON-LD and crawler links into `dist/index.html` (markers `<!--seo:jsonld-->`, `<!--seo:index-->`).

**Shared between explorer and static pages** (keep them the single source):
- `src/pageLinks.ts` — all page URLs/anchors: `makerPagePath`, `providerPagePath`, `planPagePath` (`#plan-<plan_id>`), `modelPagePath` (dot-free slugs), `explorerPath` (English omits `lang`; only `#lang=zh` is written), and `pageMaker()` (vendor → maker: Muse→Meta, nemotron→NVIDIA, other→Other).
- `src/SiteChrome.tsx` — `SITE_NAME`, `TAGLINE`, `REPO`, and the header/footer, rendered live by the explorer and via `renderToStaticMarkup` by the generator. Static pages load the explorer's hashed stylesheet plus `public/pages.css` (content styles scoped to `.static-page`).

**Terminology** (used in code, URLs and UI): maker/厂商 = dataset `vendor` (`/makers/`); provider/供应商 = dataset `channel`, who sells access (`/providers/`, each `plan_id` is a plan tier); model = `model` id. A point is one plan × model with a real price = monthly fee ÷ usable monthly tokens (USD/MTok).

**News:** Markdown + YAML front matter in `content/news/YYYY-MM-DD-slug.md` (spec in `content/news/README.md`), loaded by `web/scripts/news.mjs`. Named `makers`/`models`/`providers` must exist in the dataset or the build fails; articles appear under "Related news" on those entity pages. English only (`page()` with `alt: null`).

**Site domain:** `SITE_URL` env (default `https://tokenews.xyz`) drives canonical/hreflang/OG/sitemap/robots/llms; `web/index.html` and `web/public/robots.txt` hard-code the default and are rewritten when it differs.

## Deployment and CI

Cloudflare Workers Static Assets, no Worker script: `wrangler.jsonc` (Worker `tokenews`, custom domain `tokenews.xyz`, `auto-trailing-slash`, `404-page`). `www-redirect/` is a separate Worker that 301s `www.tokenews.xyz` to the apex. `web/public/_headers` sets caching and `noindex` for `workers.dev` hosts (`wrangler dev` rewrites the host to the route, so that rule only tests without `routes`).

GitHub Actions: `ci.yml` (PRs: build/test/check), `deploy.yml` (push to `main` → build/test/check → `npm run cf:deploy`; secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), `sync-upstream.yml` (daily 02:17 UTC: sync; if data changed and checks pass, commit to `main` and call the deploy workflow; on failure or adapter change, open/comment an `upstream-sync` issue).

## Conventions

- Makers and providers are labelled by one name everywhere (no bilingual tags like "深度求索 DeepSeek"); a maker's Chinese name (`zhName` in `build-pages.mjs`) appears only on its own Chinese page and in metadata.
- Overview panels on static pages always have exactly four stats (enforced in `overview()`); variable-length details go in the key/value list below.
- The footer credit to Real API Pricing and both copyright lines in `LICENSE` are required by the upstream MIT licence.
