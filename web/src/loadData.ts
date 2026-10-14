import type { Mapping, SiteData, SiteNotes } from "./types";

type PackedData = Omit<SiteData, "mappings"> & {
  mappings: (Partial<Mapping> & Pick<Mapping, "configuration_id" | "point_id">)[];
};

// The download files stay complete; site.json and explorer.json reference
// shared configurations once instead of repeating their fields for every
// subscription point.
export function unpackData(data: PackedData): SiteData {
  const configs = new Map(data.configurations.map((c) => [c.configuration_id, c]));
  return {
    ...data,
    mappings: data.mappings.map((m) => {
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
