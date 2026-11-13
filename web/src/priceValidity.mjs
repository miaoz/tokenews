export const isPriceDate = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
// Inclusive calendar-day validity. Undated legacy variants remain applicable.
export const isPriceVariantActive = (variant, asOf) =>
  (!variant.validFrom || variant.validFrom <= asOf) && (!variant.validUntil || asOf <= variant.validUntil);

