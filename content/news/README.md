# Writing news

One article = one Markdown file in this folder, named `YYYY-MM-DD-short-slug.md`. The part after the date becomes the URL: `2026-10-14-opus-pricing-update.md` → `https://tokenews.xyz/news/opus-pricing-update/`. News is English only.

Publish by committing the file to `main` (on GitHub: **Add file → Create new file** in `content/news/`). The deploy workflow builds and checks the site and puts it live within a few minutes. A pull request runs the same checks first.

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
lists, tables, `code`, images and `##` subheadings.
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
| `image` | no | Reserved for a future article image. |
| `draft` | no | `true` keeps the article off the site. Preview drafts locally with `NEWS_DRAFTS=1 npm run build`. |

Every maker, model and provider you list gets the article under "Related news" on its page (a maker's page also shows news about its models), and the article shows the models' current real prices. They must exist in the dataset: the build stops with a message naming the field and the value if one does not, so a typo never ships a broken link. A model the dataset does not track yet can still be named in the text; just leave it out of `models`.
