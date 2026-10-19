import { apiPriceScope, formatApiAmount, type ApiPriceReference } from "./apiPrices";

/** Used by the explorer and rendered unchanged on static model pages. */
export function ApiPriceDetails({ reference, lang }: { reference: ApiPriceReference | null; lang: string }) {
  if (!reference) return null;
  const zh = lang === "zh";
  const t = (en: string, cn: string) => zh ? cn : en;
  return <>
    <p>{reference.source
      ? <><a href={reference.source} target="_blank" rel="noopener noreferrer">{t("Official pricing source ↗", "官方价格来源 ↗")}</a> · {t("Checked", "核实于")} <time dateTime={reference.checkedAt!}>{reference.checkedAt}</time></>
      : t("Reference prices from the upstream snapshot; pricing conditions and verification date are not independently recorded here.", "参考价来自上游快照；本站尚未独立记录其适用条件与价格核实日期。")}</p>
    <p className="api-price-scroll-hint">{t("Swipe the table to see every price.", "左右滑动表格查看全部价格。")}</p>
    <div className="table-wrap api-price-table"><table>
      <caption>{t("Official API rates per million text tokens", "每百万文本 token 的官方 API 标价")}</caption>
      <thead><tr>{[t("Tier / conditions", "档位 / 适用条件"), t("Cached input", "缓存读"), t("Input", "输入"), t("Cache write", "缓存写"), t("Output", "输出")].map((s) => <th scope="col" key={s}>{s}</th>)}</tr></thead>
      <tbody>{reference.variants.map((v) => <tr key={v.id}>
        <th scope="row">{apiPriceScope(v, lang)}{v.id === reference.variant.id && reference.variants.length > 1 && <small className="block">{t("Default comparison tier", "对比页默认档位")}</small>}{v.notes && <small className="block">{v.notes[zh ? "zh" : "en"]}</small>}</th>
        {[v.rates.cachedInput, v.rates.input, v.rates.cacheWrite, v.rates.output].map((n, i) => <td key={i}>{formatApiAmount(n, v.currency)}</td>)}
      </tr>)}</tbody>
    </table></div>
    {reference.notes && <p>{reference.notes[zh ? "zh" : "en"]}</p>}
    {reference.additionalSources?.map((url) => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">{t("Additional pricing conditions ↗", "补充计费条件 ↗")}</a></p>)}
    <p className="note">{t("An em dash means that rate is not recorded. Cache-write rates are shown separately; subscription costs retain their recorded quota and workload basis.", "— 表示该项价格尚未收录。缓存写入费单独展示；订阅成本沿用其记录的额度与负载口径。")}</p>
    {reference.recordUrl && <p><a href={reference.recordUrl}>{t("Download the pricing record (JSON)", "下载价格记录（JSON）")}</a></p>}
  </>;
}
