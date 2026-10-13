// URLs of the static maker, provider and model pages. scripts/build-pages.mjs
// imports this module too, so the explorer's links and the generated pages
// share one definition of maker, slug and anchor.
//
// Terms follow the explorer: a maker (厂商) builds the model — the dataset's
// `vendor`; a provider (供应商) sells access to it — the `channel`, such as
// OpenCode or Command Code, whose plan tiers each serve a set of models.
import type { Lang } from "./types";

interface PagePoint {
  vendor: string;
  model: string;
}

/** Model maker for the maker pages: Muse is Meta's, Nemotron is NVIDIA's,
    and the rest of the dataset's "other" vendor is grouped as "Other". */
export const pageMaker = (p: PagePoint): string =>
  p.vendor === "Muse"
    ? "Meta"
    : p.model.startsWith("nemotron")
      ? "NVIDIA"
      : p.vendor === "other"
        ? "Other"
        : p.vendor;

/** Dot-free so hosts never mistake "claude-opus-5.5" for a file extension. */
export const pageSlug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const prefix = (lang: Lang) => (lang === "zh" ? "/zh" : "");

export const makerPagePath = (maker: string, lang: Lang): string =>
  `${prefix(lang)}/makers/${pageSlug(maker)}/`;

export const providerPagePath = (channel: string, lang: Lang): string =>
  `${prefix(lang)}/providers/${pageSlug(channel)}/`;

/** Anchor of one plan tier on its provider page. */
export const planAnchor = (planId: string): string => `plan-${pageSlug(planId)}`;

export const planPagePath = (channel: string, planId: string, lang: Lang): string =>
  `${providerPagePath(channel, lang)}#${planAnchor(planId)}`;

export const modelPagePath = (model: string, lang: Lang): string =>
  `${prefix(lang)}/models/${pageSlug(model)}/`;
