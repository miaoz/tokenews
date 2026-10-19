# Tokenews website

React + TypeScript + Vite, with a hand-written SVG chart (no charting library), plus statically generated maker, provider and model pages. The website reads the data snapshot in `../upstream/` (synced from Real API Pricing, see the root README); it does not fetch live prices or recompute quota adoption.

## Local development

Requires Node.js 20.19+ or 22.12+.

```sh
cd web
npm ci
npm run dev
```

Open the URL printed by Vite. English is the first-visit default. A saved language preference is used on subsequent visits; an explicit shared URL takes precedence.

```sh
npm test
npm run build
npm run preview
```

## Maker, provider and model pages

`npm run build` ends with `npm run pages` (`scripts/build-pages.mjs`), which writes static, JavaScript-free pages into `dist/` from the same `public/data/site.json` the explorer loads, formatted with the explorer's own helpers from `src/domain.ts`:

- `/makers/` and `/makers/<maker>/` (厂商): every model maker with all of its models, its lowest real price, and every plan that serves its models.
- `/providers/` and `/providers/<provider>/` (供应商): every provider — official or third-party, e.g. OpenCode or Command Code — with each plan tier (`#plan-<plan_id>`) and the models that tier includes.
- `/models/` and `/models/<model>/`: each model's plans and real prices, everything the explorer's "Behind the number" dialog shows for each plan (`#ev-<point id>`: data date, calculation, quota basis, benchmark mapping, adoption evidence and sources), best score and rank per leaderboard, every archived configuration, and an FAQ.
- Chinese versions of all of them under `/zh/`.

Curated comparisons live at `/compare/` and `/compare/<model-a>-vs-<model-b>/`, also in Chinese. They show shared subscriptions, recorded allowances, workload-matched cost ratios, official API prices and shared benchmark snapshots. Both models stay visible in the API table; missing list prices are explicitly marked as not recorded. Records keep their dates, confidence and evidence; benchmarks keep their harness, effort, mode and self-reported/estimated flags. Raw or different workloads and unmetered records are excluded from cost ratios. Allowances within a plan are alternatives and cannot be added together.

Edit the curated pairs in `src/comparisons.ts`. The build requires each pair to retain at least one shared subscription with matching normalized workloads and three common leaderboards; a data sync that breaks that requirement fails before publishing. Model slugs are sorted in the canonical URL, with 301 aliases for the reverse order (with and without a trailing slash) in the generated `_redirects`. Comparison pages have reciprocal language links, model-page links, Markdown copies, sitemap entries and listings in both `llms.txt` files. No arbitrary combination pages are generated.

Terms follow the explorer: a maker is the dataset's `vendor`, a provider its `channel`, a plan tier its `plan_id`. Page URLs and anchors come from `src/pageLinks.ts`, shared with the explorer, whose detail dialog links each model, plan, provider and maker to its page. Every page carries a title, description, canonical URL, `hreflang` alternates, Open Graph and Twitter cards, and JSON-LD (`BreadcrumbList`, `FAQPage`, `SoftwareApplication` with offers, `Organization` with an `OfferCatalog`, `ItemList`, `Dataset`). The script also generates `sitemap.xml` (with language alternates), `llms.txt` / `llms-full.txt` for AI answer engines, copies the Pareto PNGs to `/og/` as share images, and injects homepage structured data plus plain links to every page into `index.html` (React replaces them on mount). Header and footer are `src/SiteChrome.tsx`, rendered live by the explorer and to static HTML by the script, so every page shares one navigation and footer; static pages load the explorer's stylesheet plus `public/pages.css` for their content. Model makers follow the explorer (`Muse` → Meta); Nemotron is listed under NVIDIA and remaining `other` models under “Other makers”.

## Data adapter

`npm run data` (adapter: `../scripts/lib/build-site-data.mjs`) verifies all point IDs, monthly fees, monthly allowances, and real prices against `../upstream/data/adopted.csv`, checks configuration references, and writes `public/data/`. `npm run build` runs this adapter, TypeScript, then Vite. The generated data and `dist/` are ignored by Git.

The raw downloads retain the original computed fields. The smaller website dataset omits duplicated per-board summary fields from point records because the complete configurations and explicit mappings carry them separately. Source numbers are unchanged.

## Data and behavior

- Four linked views: price–capability scatterplot, real-price ranking, monthly-allowance ranking, and the full table (`#view=table`, which uses the scatterplot's per-configuration score rows for the selected leaderboard). Every leaderboard stays independent; scores are never mixed across boards.
- One toolbar per view holds model selection, filters, the benchmark-configuration switch (scatterplot and table), the fee bands (allowance), the chart navigation controls (scatterplot) or the search box (rankings and table), and a single result count.
- All adopted points and all archived benchmark configurations are selected initially. Model selection expands to channels and individual plan/model points. Empty selection is distinct from selecting everything.
- Filters within one category are ORed; categories are ANDed. Harness, effort, and mode filters restrict benchmark references. Plans without matching scores stay in the table and in price/allowance views. Those ranking views use one row per plan/model, with any table score labeled as the highest matching reference.
- The frontier is recomputed for the filtered set with strict dominance. Equal coordinates are grouped only for rendering; every plan/configuration member remains inspectable. Lowest price is on the right. Endpoint extensions cannot imply the highest score at the cheapest price.
- Detail dialogs distinguish quota confidence from mapping confidence, show original adoption evidence, and link to public archives. Original-language evidence is retained; English display labels translate Chinese plan qualifiers without changing IDs or values.
- Search is one shared query across the rankings, the table and the CSV; table sorting affects the table and its CSV, while the global model/filter state affects every view. Tables and rankings scroll inside bounded panels and render progressively as you scroll; CSV and image exports include every matching row.
- Share links serialize state in the URL hash. Removed IDs and invalid settings are ignored with an explicit notice. CSV text is quoted and formula-like text escaped.
- PNG/SVG exports use the current chart. Mobile dialogs fill the screen; long ranking charts and wide tables scroll within their containers.
- Real-price and monthly-allowance ranking views use responsive React rows with comparison bars; all filtered rows remain reachable, and PNG/SVG exports capture the current view with its range and units labeled.

## Fee bands

Monthly-allowance fee bands come from `../upstream/config/allowance-fee-bands.json`. They use adopted USD monthly fees: [0,30], (30,100], (100,300]. "All" retains every allowance, including any future >$300 plan. The `feeBand` hash field is backward compatible and applies only to the allowance view; ranking, detail table, image export and CSV follow it.

## Presentation aliases

GLM ¥49/149/469 is presented as v2 and ¥118/538/1078 as v3; v1 has no adopted data and is not fabricated. These are presentation aliases only — source IDs and historical evidence remain unchanged.

Provider marks live in `src/assets/provider-logos/`; unknown vendors fall back to a two-letter monogram.

## Packed mappings

The site payload omits mapping fields that exactly match their referenced configuration. `unpackData` restores them before use; a deep-equality test checks every restored mapping against the original derived data. Complete source downloads remain available.

## Chart engine

The scatterplot is a purpose-built SVG scene, not a charting library.

- **One scene, two renderers.** `Chart.tsx` renders a single `<ChartScene>` SVG with explicit colours: the page mounts it live, and PNG/SVG export renders the same component off-screen at 1200 px (with a title, the numbered key and the embedded DM Sans font), so downloads match the screen. The export uses the current zoom and theme.
- **Geometry lives in `chartScene.ts`** (pure, unit-tested): the reversed log price axis, 1-2-5 log ticks that thin whole decades on narrow plots and skip the unmetered `$0` slot, nice score ticks, and zoom-about-pointer / pan / box-zoom maths. Logos, names and leaders share the chart's coordinate system, so they can never lag a drag.
- **Names take the nearest free slot.** `placeTextLabels` tries above, below, right, left, then the diagonals, at three distances from the marker edge, and scores each candidate on label collisions, covered markers, crossing leaders, leader length and plot-edge overflow. A name with no clear slot is dropped instead of stacked. Widths come from canvas `measureText` with the rendered font (re-measured once the web font loads). During a gesture names ride with their points; the solver re-runs when the gesture settles.
- **Interaction.** Hover hit-tests in pixel space (badges win over dots by relative distance) and feeds the React hover card; click opens the evidence dialog; drag pans, Box zoom frames a rectangle, the wheel zooms inside the plot rectangle only, double-click on empty plot space or Reset restores the view, and arrow keys / + / − / 0 work when the plot has focus. Touch: horizontal drag pans, pinch zooms, vertical swipes keep scrolling the page.
- **Legend.** Channel entries show point counts; hovering one isolates that channel in the chart and rankings, clicking toggles the channel filter. On desktop the legend is clamped to one line with a "+N" toggle for the rest; on mobile it scrolls horizontally.
- **Navigation controls** (pan, box zoom, zoom, reset, point search) render through a portal into the shared toolbar, so they do not take a row of their own or cover the plot.

Channel colours come from `../upstream/config/channel-colors.json` (its `channels` array is also the single id-prefix → channel map). Dark mode swaps near-black provider marks for light ink — or a bundled `<slug>-dark.svg` official dark variant where one exists (Kimi, Devin) — so they stay visible.

Long tables and rankings render in chunks as they scroll (CSV/PNG exports still include every row), and the dataset request starts from `index.html` in parallel with the JavaScript bundle.

## Validation

`npm test` covers source fidelity, every board's configuration mappings, intersecting filters, empty and invalid selections, unscored models, API exclusion, strict dominance and ties, endpoint directions, language units, sharing, ordering and CSV export. After a build, `node scripts/check-pages.mjs` (root `npm run check`) checks every generated page: JSON-LD, internal links and anchors, metadata, unique titles and descriptions, and the sitemap.

## Cloudflare deployment and primary domain

The primary site is <https://tokenews.xyz>, served by Cloudflare Workers Static Assets as the Worker `tokenews` (root `wrangler.jsonc`). It is fully static, with no Worker script: navigation state lives in the URL hash, and every maker, provider and model page is a prebuilt `index.html`. `html_handling: "auto-trailing-slash"` redirects `/models/x` to the canonical `/models/x/`; `not_found_handling: "404-page"` serves the nearest `404.html` (`zh/404.html` under `/zh/`) with status 404.

The `tokenews.xyz` zone is on Cloudflare. `routes` binds it as the Worker's Custom Domain, so `wrangler deploy` creates the DNS record and certificate. `www.tokenews.xyz` is bound to a separate two-line Worker, `tokenews-www` (`www-redirect/`), that answers with a 301 to the same path and query on `https://tokenews.xyz`; keeping it apart leaves the main site as pure static assets, which do not count against Worker request limits.

Deploy from a machine:

```sh
npm ci && npm run build      # root build: npm --prefix web ci && npm --prefix web run build
npx wrangler login           # once
npm run cf:deploy            # wrangler deploy (site) && wrangler deploy -c www-redirect/wrangler.jsonc
npm run cf:dev               # serve web/dist locally with Cloudflare routing, headers and 404s
```

GitHub Actions deploys on every push to `main` (`.github/workflows/deploy.yml`); see the root README. `.node-version` pins Node.js 22. Build from the full Git checkout: the data adapter reads `data/`, `derived/` and `config/` outside `web/`.

`SITE_URL` (build variable, optional) is the site's https origin, default `https://tokenews.xyz`. It drives canonical URLs, `hreflang`, Open Graph, `sitemap.xml`, `robots.txt` and `llms.txt`; a copy under another domain must set it.

`web/public/_headers` sets the cache policy (`/assets/` immutable, `/data/` and `/pages.css` revalidated, `/og/` share images a day) and marks every `workers.dev` address — production and preview — as `noindex`, so only `tokenews.xyz` is indexed. `wrangler dev` rewrites requests to the first route's host, so test that rule against a config without `routes`. The Vite build enables Vercel Web Analytics only when the platform sets `VERCEL=1`; Cloudflare builds omit it.
