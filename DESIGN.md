# Tokenews design language

Tokenews reads like a **data almanac**: a calm reference that you trust because every number is exact and shows where it comes from. The pages are quiet and the data does the talking. Rules for the explorer (`web/src/styles.css`) and the static pages (`web/public/pages.css`, built by `web/scripts/build-pages.mjs`).

## Principles

1. **Paper, ink, one green.** A warm paper background, near-black ink and a single green accent. Green marks an action (a "go" link, a hover, the current item) and nothing else: names inside data are ink with a quiet underline, so a table never turns into a wall of green. Colour in charts identifies a maker or provider; it is never decoration.
2. **Precision has its own voice.** Labels are set in small uppercase monospace: the kicker above every title, table captions and column heads, stat and key names. So are dates, model IDs, reading times and source domains. Prose, headings and the figures themselves use DM Sans (tabular). That contrast is the brand: editorial words, instrument-grade labels.
3. **Structure through hairlines, not boxes.** Sections open on a 1px rule. Lists are rows divided by hairlines. Cards (white surface, soft border, faint shadow) are only for things you can click as a whole or for panels of data (overview, tables, evidence).
4. **Quiet motion.** Hover means a colour shift to the accent, an arrow nudging 3px forward, a card lifting 2px. Nothing animates on its own.
5. **Both themes, always.** Every colour is a token with a light and a dark value. Never hard-code a colour in a component.

## Tokens

Defined once in `web/src/styles.css` (`:root` and `:root[data-theme="dark"]`).

| Role | Tokens |
|---|---|
| Background, surfaces | `--bg` (paper) · `--surface` (cards) · `--surface-2` (table heads, code) · `--surface-3` (inline code, placeholders) |
| Text | `--ink` (headings, body) · `--ink-2` (secondary prose) · `--muted` (labels, meta) · `--faint` (numbers in lists, markers) |
| Lines | `--line` (section rules, chips) · `--line-2` (inside cards and lists) · `--line-strong` (hover, quote bars) |
| Accent | `--accent` · `--accent-soft` (answer panels) · `--accent-line` (link underlines, hover borders) |
| Type | `--font-sans` (DM Sans) · `--font-mono` (system monospace, no download) |
| Shape | `--radius-xs` 5 · `-s` 8 · `-m` 11 (panels, tables, figures) · `-l` 16 (cards) · pills are `999px` |
| Depth | `--shadow-1` (resting card) · `--shadow-2` (hovered card, popovers) · `--shadow-3` (dialogs) |
| Motion | `--ease`; 0.15s for colour, 0.2s for movement |

## Type

| Use | Style |
|---|---|
| Page title (h1) | 28–40px, semibold, -0.02em, always under a kicker |
| Section (h2) | 22px; opens a section with a hairline rule above |
| Article h2 / h3 | 24px / 18.5px |
| Lead | 18px, `--ink-2` |
| Body | 15px on data pages, 16.5px / 1.75 in articles, max 720px wide |
| Kicker (`.kicker`) | mono 12px, uppercase, +0.04em, `--muted`, e.g. `NEWS · OCT 14, 2026 · 10 MIN READ` |
| Labels | mono 11.5px, uppercase, +0.04em, `--muted`: table captions and column heads, overview stat names, key names. Column heads of the explorer's dense tables use 11px with no extra tracking. Shared rules live in `styles.css` (`.kicker` and friends) |
| Figures | `font-variant-numeric: tabular-nums`; units small and muted after the number; figure columns right-aligned (`.num`) |

## Components

| Component | Class | Use |
|---|---|---|
| Primary button | `.button` | One per page at most: the main way onward (open in the explorer). Ink pill, arrow in `<span class="arrow">`. |
| "See all" link | `.more-link` (`moreLink()`) | Closes a list section ("All news"). White pill, hairline border, arrow nudges on hover. Never a bare `text →` link. |
| Chips | `.chips` | Entities an item is about (makers, models, providers). Pill, hairline, 12.5px. |
| Tags | `.tag` | Free topics: mono, `#release`. Not links. |
| Kicker | `.kicker`, `page({ kicker })` | Every page: what it is and its size, e.g. `EXPLORER · REAL PRICE × CAPABILITY`, `MAKER · 8 MODELS`, `PROVIDER · 7 PLANS`, `MODEL · ANTHROPIC`, `DIRECTORY · 75 MODELS`, `METHODOLOGY · HOW TO READ THE DATA`, `ERROR 404`. |
| Overview panel | `.overview` | Exactly four stats, then a key/value list. |
| Answer panel | `.answer` | The one-paragraph direct answer at the top of an entity page: the same callout as an article quote. |
| Table | `table()` → `.table-wrap` | Data. Caption first, first column is the row header (bold ink). Columns of bare figures are detected and right-aligned. Links in cells are ink with a hairline underline; an action link in a row (`a.action`, "Evidence →") stays green. |
| Disclosure | `<details>` | Chevron at the end of the row, rotates when open. FAQ rows sit on hairlines; evidence rows are cards. |
| News rows | `.news-list` | Date column (mono) + title + summary. Related news and "More news". |
| News cards | `.news-card` | News index: the latest is wide with its cover, the rest in a grid. The whole card is one link. Without a cover, a dotted placeholder shows the first tag. |
| Article | `.article-layout` | 720px reading column, sticky "On this page" list on wide screens (from the article's `##` headings, current section in accent). |
| Prose links | `.prose a` | Ink text with a green underline; turns green on hover. |
| Data links | `td a`, `.meta a`, `.answer a` | Ink text with a grey hairline underline; turns green on hover. |
| Quote / callout | `.prose blockquote` | White panel with a green bar: summaries and highlights. |
| Figure | `.prose figure` | Image with a hairline border and radius; caption muted and centred. |
| Sources | `.source-list` | Numbered rows (`01`), title left, domain in mono right with ↗. |

## Doing it right

- Reach for an existing component before writing new CSS; add a new one here when you do.
- External links get ↗; internal "go somewhere" links get →, in a `.arrow` span so it can move.
- Don't add colours, shadows or radii outside the tokens. Don't use the accent for emphasis in prose: use weight.
- On Chinese pages labels use the sans (the system monospace has no CJK glyphs); dates and IDs stay mono.
- Check new UI in light and dark, in English and Chinese, and at 390px wide.
