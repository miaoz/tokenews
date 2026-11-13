import { isPriceDate, isPriceVariantActive } from './priceValidity.mjs';
import type { Mapping, SiteData, SiteNotes } from "./types";

type PackedData = Omit<SiteData, "mappings"> & {
  mappings: (Partial<Mapping> & Pick<Mapping, "configuration_id" | "point_id">)[];
};

// The download files stay complete; site.json and explorer.json reference
// shared configurations once instead of repeating their fields for every
// subscription point.
export function unpackData(data: PackedData, asOf = new Date().toISOString().slice(0, 10)): SiteData {
  if (!isPriceDate(asOf)) throw new Error('Invalid price selection date');
  // Reuse only reviewed same-scope alternatives; preserve benchmark identity
  // while updating its point reference, never its score or measurement date.
  let points = data.points;
  let mappings = data.mappings;
  for (const schedule of data.apiPointSchedules ?? []) {
    const ids = new Set(schedule.pointIds);
    const present = points.some(p=>ids.has(p.id));
    if (!present) continue;
    const active = schedule.alternatives.filter(a=>isPriceVariantActive(a,asOf));
    if (active.length > 1) throw new Error('Overlapping API point validity ranges');
    const replacement = active[0]?.point;
    points = points.filter(p=>!ids.has(p.id));
    if (replacement) points = [...points,replacement];
    mappings = mappings.flatMap(m=>!ids.has(m.point_id) ? [m] : replacement ? [{...m,point_id:replacement.id}] : []);
  }
  const configs = new Map(data.configurations.map((c) => [c.configuration_id, c]));
  return {
    ...data,
    points,
    mappings: mappings.map((m) => {
      const c = configs.get(m.configuration_id);
      if (!c) throw new Error(`Missing benchmark configuration: ${m.configuration_id}`);
      const { model, ...fields } = c;
      return { ...fields, ...m } as Mapping;
    }),
  };
}

let notes: Promise<SiteNotes> | undefined;
/** explorer-notes.json, fetched once (the explorer starts it after the first
    render; the details dialog waits for it if it hasn't arrived yet). */
export function loadNotes(): Promise<SiteNotes> {
  notes ??= fetch("/data/explorer-notes.json").then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<SiteNotes>;
  });
  notes.catch(() => (notes = undefined));
  return notes;
}
