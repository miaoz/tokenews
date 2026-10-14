# Writing news

One article = one Markdown file in this folder, named `YYYY-MM-DD-short-slug.md`. The part after the date becomes the URL: `2026-10-14-opus-pricing-update.md` → `https://tokenews.xyz/news/opus-pricing-update/`. News is English only.

Publish by committing the file to `main` (on GitHub: **Add file → Create new file** in `content/news/`). The deploy workflow builds and checks the site and puts it live within a few minutes. A pull request runs the same checks first.

## Articles with images

Images are not kept in git. They are stored in the Cloudflare R2 bucket `tokenews-media` and served from `https://media.tokenews.xyz`. Write the article anywhere, for example in `article/<name>/` (ignored by git), with the front matter below and local image paths (`![alt](assets/chart.png)`), then run from the repository root:

```sh
npm run news:publish -- article/<name> --slug short-slug            # upload images, write content/news/<date>-short-slug.md
npm run news:publish -- article/<name> --slug short-slug --dry-run  # show what would be uploaded
npm run news:publish -- article/<name> --slug short-slug --push     # also build, check, commit and push (deploys it)
```

The script compresses every local PNG, JPEG, GIF, WebP or AVIF the article uses (up to 25 MB each) to WebP at most 1600px wide plus an 800px copy that small screens load, and the cover image to a 1200px JPEG for social cards. It uploads them under content-hashed keys (`news/<slug>/<name>-<hash>-1600.webp`, cached for a year), records their sizes in `content/news/media.json`, and writes the article to `content/news/` with the image URLs replaced. Commit both files. Running it again after an edit uploads only the images that changed and deletes the ones the article no longer uses. Uploading needs Wrangler logged in to the Cloudflare account (`npx wrangler login`). Without `--slug`, the slug comes from the file or folder name.

An image alone in its paragraph becomes a figure. A title becomes its caption: `![Alt text](assets/chart.png "Caption")`. The first image is also the article's social and search image unless `image:` names another. The build fails on a local image path or on a media URL that is not in `media.json`. Other `https://` images are allowed but get no size. Markdown has no maths: write formulas as text, not `$…$`.

## Template

```markdown
---
title: The headline of the article
date: 2026-10-14
summary: One or two sentences that say what happened and why it matters.
makers: [Anthropic]
models: [claude-opus-5.5]
providers: [Anthropic, Cursor]
tags: [pricing]
sources:
  - title: Where the facts come from
    url: https://example.com/source
author: Your name
---

The article body, in Markdown: paragraphs, **bold**, [links](https://example.com),
lists, tables, `code`, images and `##` subheadings (no `#` heading: the title is the page heading).
```

## Fields

| Field | Required | What it does |
|---|---|---|
| `title` | yes | Headline; also the page title. |
| `date` | yes | Publication date, `YYYY-MM-DD`. Articles sort newest first. |
| `summary` | yes | One or two sentences, under 200 characters: the lead, the search snippet and the RSS description. |
| `makers` | no | Makers the article is about, by the name on `/makers/` (e.g. `Anthropic`, `Zhipu`, `SpaceXAI`). |
| `models` | no | Models by model ID, as in the model page's "Model ID" (e.g. `claude-opus-5.5`, `glm-5.3`). |
| `providers` | no | Providers by the name on `/providers/` (e.g. `OpenCode`, `Command Code`, `Cursor`). |
| `tags` | no | Free topics, e.g. `pricing`, `release`, `benchmark`. |
| `sources` | no | Links shown under the article: `- title: …` / `url: …`, or just URLs. |
| `author` | no | Byline; the site is the author when omitted. |
| `updated` | no | Date of a substantive correction, `YYYY-MM-DD`. |
| `image` | no | The social/search image (a local path for `news:publish`, or a media URL). Defaults to the first image in the body. |
| `draft` | no | `true` keeps the article off the site. Preview drafts locally with `NEWS_DRAFTS=1 npm run build`. |

Every maker, model and provider you list gets the article under "Related news" on its page (a maker's page also shows news about its models), and the article shows the models' current real prices. They must exist in the dataset: the build stops with a message naming the field and the value if one does not, so a typo never ships a broken link. A model the dataset does not track yet can still be named in the text; just leave it out of `models`.
