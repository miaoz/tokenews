// The methodology: how real prices, workloads, benchmark context and
// evidence work. Rendered by the explorer's method view and, through
// build-pages.mjs, as the static /methodology/ pages, so both say the same.
import { ArrowUpRight } from "@phosphor-icons/react";
import { metricLabel, number } from "./domain";
import { explorerPath } from "./pageLinks";
import { REPO } from "./SiteChrome";
import type { SiteData } from "./types";

export default function Method({
  data,
  zh,
  onBack,
}: {
  data: SiteData;
  zh: boolean;
  /** In the explorer: back to the charts. On the static page it is a link instead. */
  onBack?: () => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const mix = data.conventions.standardTokenMix;
  return (
    <section className="method-page">
      <p className="kicker">{t("Methodology · how to read the data", "方法论 · 如何理解这些数据")}</p>
      <h1>{t("Every number has a story.", "每个数字，都有依据。")}</h1>
      <p className="method-lead">
        {t(
          "We combine subscription cost and quota evidence with independently maintained official API price references. Capability scores come from independent leaderboards, with their original context preserved.",
          "我们结合订阅成本与额度证据、独立维护的官方 API 参考价，帮助理解模型成本。能力分数引用独立榜单，并保留原始评测语境。",
        )}
      </p>
      <div className="big-formula">
        <span>{t("Real unit price", "真实单价")}</span>
        <strong>
          {t(
            "Monthly fee ÷ usable monthly tokens",
            "订阅月费 ÷ 每月实际可用 token",
          )}
        </strong>
        <small>USD / 1,000,000 tokens</small>
      </div>
      <div className="method-grid">
        <article>
          <h2>
            01 <span>{t("A floor, not a promise", "价格下限")}</span>
          </h2>
          <p>
            {t(
              "Allowances assume saturated use. Lower usage increases your effective price. All token types count equally: input, output, cache reads, and cache writes in measured totals. We do not adjust for tokenizer differences or utilization.",
              "额度按饱和使用估算；实际使用不足时单价更高。输入、输出、缓存读写一视同仁，实测采用工具上报 total。不进行分词器或利用率二阶修正。",
            )}
          </p>
          <p>
            {t(
              `A month defaults to ${data.conventions.monthWeeks} weeks. Kimi has an independent monthly pool equal to five weekly pools; Droid's month is 2× its weekly allowance. Model allowances within the same plan are alternatives and must not be summed.`,
              `默认月为 ${data.conventions.monthWeeks} 周；Kimi 独立月池等于周池的 5 倍；Droid 月额度为周额度的 2 倍。同套餐不同模型额度为替代关系，不可相加。`,
            )}
          </p>
        </article>
        <article>
          <h2>
            02 <span>{t("One comparison workload", "统一比较负载")}</span>
          </h2>
          <p>
            {t(
              "Dollar/credit pools priced at public rates and metered APIs are converted using the same three-part workload; for Anthropic models the input share is priced at the 5-minute cache-write rate. Measured samples that include a token breakdown are converted to list-worth at public prices and then to the channel's workload (low-cache for Google and StepFun, Anthropic for Claude); samples without a breakdown and official token tables keep raw totals and are flagged as not workload-normalized. Vendor dashboard dollars are calibrated from measured usage, not treated as public-price dollars.",
              "按公开标价记账的美元/credits 池与按量 API，使用统一三段负载折算（Anthropic 档的普通输入份额按 5 分钟缓存写价计）。带 token 分项的实测样本先按公开标价折成美元价值，再按渠道负载档换算（Google 与 StepFun 用低缓存档、Claude 用 Anthropic 档）；缺分项的实测样本与官方绝对 token 表直接采用 raw 合计，网页标注「未折算」。厂商面板额度美元使用实测标定，不当成公开标价美元。",
            )}
          </p>
          <div className="mix-values">
            <span>
              <b>{number(mix.cache * 100, "en", 3)}%</b>
              {t("Cache reads", "缓存读取")}
            </span>
            <span>
              <b>{number(mix.input * 100, "en", 3)}%</b>
              {t("Fresh input", "普通输入")}
            </span>
            <span>
              <b>{number(mix.output * 100, "en", 3)}%</b>
              {t("Output", "输出")}
            </span>
          </div>
          <p>
            {t(
              "This is a comparison convention, not a measured workload. Cache-write charges are modeled only in the Anthropic workload (input share at the 5-minute cache-write rate); other channels with write fees may still see overstated allowances.",
              "这是比较基准，不代表实测负载。仅 Anthropic 档单列缓存写入（普通输入份额按 5 分钟缓存写价计），其余另收写入费的渠道仍可能高估可用额度。",
            )}
          </p>
        </article>
        <article>
          <h2>
            03 <span>{t("Keep the benchmark context", "保留评测语境")}</span>
          </h2>
          <p>
            {t(
              "Each leaderboard uses one selected snapshot; different benchmark versions are never mixed. Code Arena refers to WebDev Overall, not general coding ability. The default view is each model's highest-score configuration; every archived configuration and the reasoning-effort filter remain available. Harness, reasoning effort, service mode, and known score intervals are retained.",
              "每张榜单使用一份选定快照，不混合不同版本的分数。Code Arena 指 WebDev Overall，不代表通用编程能力。默认取每个模型的最高分配置；全部存档配置和推理强度筛选仍可切换。保留框架、推理强度、模式与已知分数区间。",
            )}
          </p>
          <p>
            {t(
              "Mappings do not verify a subscription’s harness or quota-measurement effort. Missing scores remain missing. Qualitative confidence is not a numerical error bar, and score intervals do not change frontier membership.",
              "参考映射不验证订阅框架或额度实测强度。缺分不补分。定性置信度不等于数值误差条；分数区间不改变前沿成员。",
            )}
          </p>
        </article>
        <article>
          <h2>
            04 <span>{t("Follow the evidence", "追溯证据")}</span>
          </h2>
          <p>
            {t(
              "High: dashboard back-calculations, controlled saturation measurements, or official absolute-token/credit tables. Medium: usage logs plus quota reports, or official ratios applied to a strong baseline. Low: single reports, third-party summaries, and cross-plan assumptions.",
              "高：面板反推、受控饱和实测、官方绝对 token/积分表。中：用量日志与额度口述、官方倍率与高等级基准。低：单一口述、第三方综述与跨套餐假设。",
            )}
          </p>
          <p>
            {t(
              "Conflicting historical evidence is archived. The adopted decision and its rationale are exposed for every point. Original evidence text is preserved in its source language.",
              "矛盾的历史证据完整存档。每个点展示采用值、取舍理由及来源，原始证据文字保留原语言。",
            )}
          </p>
        </article>
      </div>
      <section className="method-sources">
        <h2>{t("Official API price references", "官方 API 价格参考")}</h2>
        <p>{t(
          "Current API references are checked independently against official sources and include the verification date, currency, processing tier, region and input-length conditions. Model pages show every recorded tier; comparisons use the explicitly selected default tier. Cache-write charges are listed separately. These references do not recalculate the historical allowances or real costs of subscription plans.",
          "当前 API 参考价独立核对官方来源，记录核实日期、币种、服务档、地区及输入长度条件。模型页展示全部已收录档位，对比页采用明确指定的默认档位。缓存写入费单独展示。这些参考价不用于重算订阅套餐的历史额度或真实成本。",
        )}</p>
        <p>{t(
          "Models not yet independently covered retain the API references available in the upstream snapshot, with missing conditions left unknown. An em dash indicates an unrecorded rate, not free usage. The standard-mix reference weights cached reads, fresh input and output; it does not include a separate cache-write charge.",
          "尚未独立收录的模型沿用上游快照已有的 API 参考价，缺失的适用条件保留未知。— 表示该项价格未收录，不代表免费。标准负载参考价按缓存读、普通输入和输出加权，不另计缓存写入费。",
        )}</p>
        <p><a href="/data/api-prices.json">{t("Download current API references (JSON)", "下载当前 API 参考价（JSON）")}</a></p>
      </section>
      <section className="method-sources">
        <h2>{t("Independent leaderboards", "独立榜单来源")}</h2>
        {Object.entries(data.boards).map(([id, b]) => (
          <a key={id} href={b.url} target="_blank" rel="noreferrer">
            <span>
              {b.name}
              <small>
                {metricLabel(b.metric, zh ? "zh" : "en")} · {t("Snapshot", "快照")} {b.snapshot}
              </small>
            </span>
            <ArrowUpRight size={18} />
          </a>
        ))}
        <p>
          {t("Currency conversion: ", "货币换算：")}1 USD ={" "}
          {data.conventions.usdPerCny} CNY ·{" "}
          {data.conventions.exchangeRate.date} ·{" "}
          <a
            href={data.conventions.exchangeRate.source}
            target="_blank"
            rel="noreferrer"
          >
            {zh
              ? data.conventions.exchangeRate.labelZh
              : data.conventions.exchangeRate.labelEn}
          </a>
        </p>
        <p>
          <a
            href={`${REPO}/blob/main/SOURCES.md`}
            target="_blank"
            rel="noreferrer"
          >
            {t("Full attribution & licensing", "完整署名与许可")}
          </a>{" "}
          ·{" "}
          <a href="/data/adopted.csv" download>
            {t("Download adopted data", "下载采用数据")}
          </a>{" "}
          ·{" "}
          <a href="/data/benchmark-configurations.json" download>
            {t("All configurations", "全部评测配置")}
          </a>
        </p>
      </section>
      {onBack ? (
        <button className="primary" onClick={onBack}>
          {t("Explore the data", "探索数据")}
          <span className="arrow" aria-hidden="true">→</span>
        </button>
      ) : (
        <a className="primary" href={explorerPath(zh ? "zh" : "en")}>
          {t("Explore the data", "探索数据")}
          <span className="arrow" aria-hidden="true">→</span>
        </a>
      )}
    </section>
  );
}
