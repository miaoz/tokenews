// Layout-shaped placeholder shown until explorer.json loads (no spinner, no layout
// jump). The explorer renders it live; build-pages.mjs also writes it into
// dist/index.html so the first paint is already this styled shell.
import { SiteHeader } from "./SiteChrome";
import type { Lang } from "./types";

export function BootSkeleton({ lang }: { lang: Lang }) {
  return (
    <div className="skeleton">
      <SiteHeader lang={lang} current="explore" />
      <div className="page" aria-busy="true" aria-label={lang === "zh" ? "正在加载" : "Loading"}>
        <div className="skeleton-hero">
          <span style={{ width: "22%", height: 12 }} />
          <span style={{ width: "46%", height: 34 }} />
          <span style={{ width: "40%", height: 34 }} />
          <span style={{ width: "48%", height: 14 }} />
          <span style={{ width: "44%", height: 14 }} />
        </div>
        <div className="skeleton-card" />
      </div>
    </div>
  );
}
