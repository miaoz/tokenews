import type { SiteData } from "./types";

export interface ApiPriceVariant {
  id: string;
  label: { en: string; zh: string };
  currency: string;
  region?: string;
  serviceTier?: string;
  /** Inclusive billing thresholds for input tokens; null means no upper tier bound. */
  context?: { min: number; max: number | null };
  rates: { input: number; cachedInput: number | null; output: number; cacheWrite?: number | null };
  notes?: { en: string; zh: string };
}
export interface ApiPriceModel {
  id: string;
  provider: string;
  source: string;
  additionalSources?: string[];
  checkedAt: string;
  defaultVariant: string;
  variants: ApiPriceVariant[];
  recordUrl: string;
  notes?: { en: string; zh: string };
}
export interface ApiPriceCatalog {
  version: 1;
  unit: "per_million_tokens";
  updatedAt: string | null;
  models: Record<string, ApiPriceModel>;
}
export interface ApiPriceReference {
  origin: "maintained" | "upstream";
  variant: ApiPriceVariant;
  variants: ApiPriceVariant[];
  prices: { cached: number | null; input: number; output: number; currency: string };
  source: string | null;
  additionalSources?: string[];
  checkedAt: string | null;
  recordUrl: string | null;
  notes?: { en: string; zh: string };
  blended: number | null;
}

/** Current API references are separate from the prices used to adopt quotas. */
export function apiPriceReference(data: SiteData, model: string): ApiPriceReference | null {
  const own = data.apiPrices && Object.hasOwn(data.apiPrices.models, model) ? data.apiPrices.models[model] : undefined;
  if (own) {
    const variant = own.variants.find((v) => v.id === own.defaultVariant);
    if (!variant) throw new Error(`Missing default API price variant: ${model}`);
    const { input, cachedInput, output } = variant.rates;
    const mix = data.conventions.standardTokenMix;
    const conversion = variant.currency === "USD" ? 1 : variant.currency === "CNY" ? data.conventions.usdPerCny : null;
    return {
      origin: "maintained", variant, variants: own.variants,
      prices: { cached: cachedInput, input, output, currency: variant.currency },
      source: own.source, additionalSources: own.additionalSources, checkedAt: own.checkedAt, recordUrl: own.recordUrl, notes: own.notes,
      blended: cachedInput !== null && conversion !== null
        ? (mix.cache * cachedInput + mix.input * input + mix.output * output) / conversion : null,
    };
  }
  const points = data.points.filter((p) => p.model === model).sort((a, b) =>
    a.real_usd_per_mtok - b.real_usd_per_mtok || (a.price_usd ?? 0) - (b.price_usd ?? 0));
  const point = points.find((p) => p.billing === "metered" && p.list_price) ?? points.find((p) => p.list_price);
  if (!point?.list_price) return null;
  const lp = point.list_price;
  const variant: ApiPriceVariant = {
    id: "upstream", label: { en: "Upstream reference", zh: "上游参考价" }, currency: lp.currency,
    rates: { cachedInput: lp.cached, input: lp.input, output: lp.output },
  };
  return {
    origin: "upstream", variant, variants: [variant], prices: lp,
    source: null, checkedAt: null, recordUrl: null,
    blended: point.list_blended_usd_per_mtok,
  };
}

export function formatApiAmount(amount: number | null | undefined, currency: string): string {
  return amount == null ? "—" : new Intl.NumberFormat("en-US", {
    style: "currency", currency, minimumFractionDigits: 0, maximumSignificantDigits: 6,
  }).format(amount);
}

export function apiPriceScope(variant: ApiPriceVariant, lang: string): string {
  const zh = lang === "zh";
  const parts = [variant.label[zh ? "zh" : "en"]];
  const tiers: Record<string, [string, string]> = { standard: ["Standard", "标准档"], batch: ["Batch", "批处理"], flex: ["Flex", "弹性档"], fast: ["Fast", "快速档"], ultrafast: ["Ultrafast", "极速档"] };
  if (variant.serviceTier) {
    const tier = tiers[variant.serviceTier]?.[zh ? 1 : 0] ?? variant.serviceTier;
    if (!parts[0].toLowerCase().includes(tier.toLowerCase())) parts.push(tier);
  }
  if (variant.region) parts.push(variant.region === "global" ? (zh ? "全球" : "Global")
    : /^[A-Z]{2}$/.test(variant.region) ? new Intl.DisplayNames([zh ? "zh-CN" : "en"], { type: "region" }).of(variant.region)! : variant.region);
  if (variant.context) {
    const { min, max } = variant.context;
    const fmt = (n: number) => n.toLocaleString("en-US");
    const range = min === 0 && max !== null ? `≤ ${fmt(max)}`
      : max === null && min > 0 ? `≥ ${fmt(min)}`
      : max !== null ? `${fmt(min)}–${fmt(max)}` : (zh ? "全部计费长度档位" : "all billing lengths");
    parts.push(zh ? `输入 ${range} tokens` : `${range} input tokens`);
  }
  return parts.join(" · ");
}
