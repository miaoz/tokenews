// Layout-shaped placeholder shown until explorer.json loads (no spinner, no layout
// jump). The explorer renders it live; build-pages.mjs also writes it into
// dist/index.html so the first paint is already this styled shell with a real <h1>.
import { SiteHeader, TAGLINE } from "./SiteChrome";
import type { Lang } from "./types";

export function BootSkeleton({ lang }: { lang: Lang }) {
  const zh = lang === "zh";
  const t = (en: string, cn: string) => (zh ? cn : en);
  return (
    <div className="skeleton">
      <SiteHeader lang={lang} current="explore" />
      <div className="page" aria-busy="true" aria-label={t("Loading", "正在加载")}>
        <section className="intro">
          <div className="intro-copy">
            <p className="kicker">
              {t("Explorer · real price × capability", "数据探索 · 真实单价 × 能力")}
            </p>
            <h1>{TAGLINE[lang]}</h1>
            <p className="lede">
              {t(
                "Every model's real price per token, every maker's lineup and what each product includes: monthly fee ÷ the tokens you can actually use, set against independent leaderboards.",
                "每个模型的真实单价、每家厂商的全部模型、每个产品包含什么：按「月费 ÷ 每月实际可用 token」计算，对照独立榜单的能力分数。",
              )}
            </p>
          </div>
          <div className="skeleton-stats" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
        <div className="skeleton-card" />
      </div>
    </div>
  );
}
