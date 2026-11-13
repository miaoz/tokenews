export function isPriceDate(day: unknown): day is string;
export function isPriceVariantActive(variant: { validFrom?: string; validUntil?: string }, asOf: string): boolean;
