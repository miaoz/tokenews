// The site header and footer. The explorer renders them live; build-pages.mjs
// renders the same components to static HTML for the provider and model
// pages, so every page shares one navigation and one footer.
import type { MouseEvent } from "react";
import { ArrowUpRight, ChartScatter, Moon, Sun } from "@phosphor-icons/react";
import type { Lang } from "./types";

/** Site name and positioning, shared by the explorer, static pages and exports. */
export const SITE_NAME = "Tokenews";
export const TAGLINE = {
  en: "Directory and news of models, makers and products for the AI era",
  zh: "AI 时代的模型、厂商、产品目录和资讯",
};
/** The open-source project this site's data and methodology come from (MIT). */
export const REPO = "https://github.com/Fei2411/real-api-pricing";

export type NavKey = "explore" | "makers" | "providers" | "models" | null;

/** In-app navigation handler: the explorer swaps views without a page load;
    static pages leave it out and follow the href. */
type Go = (() => void) | undefined;
const follow = (go: Go) =>
  go
    ? (e: MouseEvent) => {
        e.preventDefault();
        go();
      }
    : undefined;

const homePath = (lang: Lang) => (lang === "zh" ? "/#lang=zh" : "/#lang=en");

export function SiteHeader({
  lang,
  current,
  onExplore,
  onThemeToggle,
  onLanguage,
  languageHref,
}: {
  lang: Lang;
  current: NavKey;
  onExplore?: () => void;
  /** Static pages wire the toggle with an inline script instead. */
  onThemeToggle?: () => void;
  onLanguage?: () => void;
  /** The same page in the other language, for static pages. */
  languageHref?: string;
}) {
  const zh = lang === "zh";
  const t = (en: string, cn: string) => (zh ? cn : en);
  const prefix = zh ? "/zh" : "";
  const nav: [NavKey, string, string, Go][] = [
    ["explore", homePath(lang), t("Explore", "数据探索"), onExplore],
    ["makers", `${prefix}/makers/`, t("Makers", "厂商"), undefined],
    ["providers", `${prefix}/providers/`, t("Providers", "供应商"), undefined],
    ["models", `${prefix}/models/`, t("Models", "模型"), undefined],
  ];
  const other = zh ? "en" : "zh-CN";
  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href={homePath(lang)} onClick={follow(onExplore)}>
          <ChartScatter size={24} weight="bold" />
          <span>{SITE_NAME}</span>
        </a>
        <nav aria-label={t("Main navigation", "主导航")}>
          {nav.map(([key, href, label, go]) => (
            <a
              key={key}
              className={current === key ? "nav-link current" : "nav-link"}
              aria-current={current === key ? "page" : undefined}
              href={href}
              onClick={follow(go)}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="icon-button theme-toggle"
            onClick={onThemeToggle}
            aria-label={t("Toggle dark mode", "切换深浅色模式")}
            title={t("Toggle dark mode", "切换深浅色模式")}
          >
            <Moon size={17} className="theme-icon-moon" />
            <Sun size={17} className="theme-icon-sun" />
          </button>
          {languageHref ? (
            <a className="language" href={languageHref} hrefLang={other} lang={other}>
              {zh ? "EN" : "中文"}
            </a>
          ) : (
            <button
              className="language"
              lang={other}
              onClick={onLanguage}
              title={zh ? "Switch to English" : "切换为中文"}
            >
              {zh ? "EN" : "中文"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({
  lang,
  onMethod,
}: {
  lang: Lang;
  onMethod?: () => void;
}) {
  const zh = lang === "zh";
  const t = (en: string, cn: string) => (zh ? cn : en);
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <span className="footer-brand">
          <ChartScatter size={18} weight="bold" />
          {SITE_NAME}
        </span>
        <p>{TAGLINE[lang]}</p>
        <nav aria-label={t("Footer", "页脚")}>
          <a href={`/#lang=${lang}&view=method`} onClick={follow(onMethod)}>
            {t("Methodology", "方法与来源")}
          </a>
          <a href={`${REPO}/blob/main/SOURCES.md`} target="_blank" rel="noreferrer">
            {t("Sources & attribution", "来源与署名")}
            <ArrowUpRight size={12} />
          </a>
          <a href="/data/points.json" download>
            {t("Open data", "开放数据")}
            <ArrowUpRight size={12} />
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            {t("Based on Real API Pricing (MIT)", "基于 Real API Pricing（MIT）")}
            <ArrowUpRight size={12} />
          </a>
        </nav>
      </div>
    </footer>
  );
}
