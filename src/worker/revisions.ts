// Which revision stream a draft touched, and the change sets committed with it.
//
// CR is the customer-facing build identity; PR is the internal pricing audit.
// A check-in may advance either, both, or (gate G1) neither — in which case it
// is rejected.

export function isCrChanged(live: any, draft: any, liveLines: any[], draftLines: any[], liveTags: any[], draftTags: any[]): boolean {
  // CR-side: BOM shape + per-line construction fields + structure construction fields + general/variant tags + instructions + spec_revision_id
  if (live.current_construction_revision_number === 0) return true; // never committed
  if (live.part_number !== draft.part_number) return true;
  if ((live.description ?? null) !== (draft.description ?? null)) return true;
  if (Number(live.build_hours) !== Number(draft.build_hours)) return true;
  if (live.spec_revision_id !== draft.spec_revision_id) return true;
  for (const f of ['build_instr_1', 'build_instr_2', 'build_instr_3', 'build_instr_4', 'build_instr_5',
                    'work_instr_1', 'work_instr_2', 'work_instr_3', 'work_instr_4', 'work_instr_5']) {
    if ((live as any)[f] !== (draft as any)[f]) return true;
  }
  if (liveLines.length !== draftLines.length) return true;
  const liveById = new Map(liveLines.map((l) => [l.id, l]));
  for (const dl of draftLines) {
    const ll = liveById.get(dl.id);
    if (!ll) return true;
    if (ll.sort_order !== dl.sort_order) return true;
    for (const f of ['component_part_number', 'part_description', 'quantity', 'supplier', 'lead_time_days', 'product_code', 'sub_assembly_structure_id']) {
      if ((ll as any)[f] !== (dl as any)[f]) return true;
    }
  }
  const liveTagSet = new Set(liveTags.filter((t) => t.kind === 'general' || t.kind === 'variant').map((t) => t.tag_id));
  const draftTagSet = new Set(draftTags.filter((t) => t.kind === 'general' || t.kind === 'variant').map((t: any) => t.tag_id));
  if (liveTagSet.size !== draftTagSet.size) return true;
  for (const id of liveTagSet) if (!draftTagSet.has(id)) return true;
  return false;
}

export function isPrChanged(live: any, draft: any, liveLines: any[], draftLines: any[]): boolean {
  if (live.current_price_revision_number === 0) return true;
  if (Number(live.target_assembly_margin_pct) !== Number(draft.target_assembly_margin_pct)) return true;
  const liveById = new Map(liveLines.map((l) => [l.id, l]));
  for (const dl of draftLines) {
    const ll = liveById.get(dl.id);
    if (!ll) return true;
    for (const f of ['chosen_price_point_id', 'price_override', 'is_commissioned', 'commission_cap_pct']) {
      const a = (ll as any)[f]; const b = (dl as any)[f];
      if ((a ?? null) !== (b ?? null)) return true;
    }
  }
  if (liveLines.length !== draftLines.length) return true;
  return false;
}

export function buildCrChangeSet(live: any, draft: any, liveLines: any[], draftLines: any[], liveTags: any[], draftTags: any[]): unknown {
  const liveById  = new Map(liveLines.map((l) => [l.id, l]));
  const draftById = new Map(draftLines.map((l) => [l.id, l]));

  const summarize = (l: any) => ({
    sort_order: l.sort_order,
    component: l.component_part_number,
    description: l.part_description,
    quantity: l.quantity,
    supplier: l.supplier,
    product_code: l.product_code,
  });
  const lineAdded   = draftLines.filter((dl) => !liveById.has(dl.id)).map(summarize);
  const lineRemoved = liveLines.filter((ll) => !draftById.has(ll.id)).map(summarize);

  const LINE_FIELDS = ['component_part_number', 'part_description', 'quantity', 'supplier', 'lead_time_days', 'product_code', 'sub_assembly_structure_id'];
  const lineModified: Array<{ sort_order: number; component: string; fields: Array<{ field: string; old: unknown; new: unknown }> }> = [];
  for (const dl of draftLines) {
    const ll = liveById.get(dl.id);
    if (!ll) continue;
    const fields: Array<{ field: string; old: unknown; new: unknown }> = [];
    for (const f of LINE_FIELDS) {
      if ((ll as any)[f] !== (dl as any)[f]) {
        fields.push({ field: f, old: (ll as any)[f], new: (dl as any)[f] });
      }
    }
    if (fields.length > 0) lineModified.push({ sort_order: dl.sort_order, component: dl.component_part_number, fields });
  }

  // Structure-level field diffs
  const structureFields: Array<{ field: string; old: unknown; new: unknown }> = [];
  const SF_NUMERIC = ['build_hours'];
  const SF_TEXT = ['part_number', 'description', 'spec_revision_id', 'build_instr_1', 'build_instr_2', 'build_instr_3', 'build_instr_4', 'build_instr_5', 'work_instr_1', 'work_instr_2', 'work_instr_3', 'work_instr_4', 'work_instr_5'];
  for (const f of SF_TEXT) {
    if ((live as any)[f] !== (draft as any)[f]) {
      structureFields.push({ field: f, old: (live as any)[f], new: (draft as any)[f] });
    }
  }
  for (const f of SF_NUMERIC) {
    if (Number((live as any)[f] ?? 0) !== Number((draft as any)[f] ?? 0)) {
      structureFields.push({ field: f, old: (live as any)[f], new: (draft as any)[f] });
    }
  }

  // Tag diffs (with names)
  const liveTagMap  = new Map(liveTags.filter((t) => t.kind === 'general' || t.kind === 'variant').map((t) => [t.tag_id, { name: t.name, kind: t.kind }]));
  const draftTagMap = new Map(draftTags.filter((t) => t.kind === 'general' || t.kind === 'variant').map((t: any) => [t.tag_id, { name: t.name, kind: t.kind }]));
  const tagsAdded:   Array<{ name: string; kind: string }> = [];
  const tagsRemoved: Array<{ name: string; kind: string }> = [];
  for (const [id, t] of draftTagMap) if (!liveTagMap.has(id))  tagsAdded.push(t);
  for (const [id, t] of liveTagMap)  if (!draftTagMap.has(id)) tagsRemoved.push(t);

  return {
    line_items: {
      added: lineAdded,
      removed: lineRemoved,
      modified: lineModified,
    },
    structure_fields: structureFields,
    tags: { added: tagsAdded, removed: tagsRemoved },
  };
}

export function buildPrChangeSet(live: any, draft: any, liveLines: any[], draftLines: any[]): unknown {
  const repriced = draftLines.filter((dl) => {
    const ll = liveLines.find((l) => l.id === dl.id);
    if (!ll) return true; // new line = priced
    return (ll.chosen_price_point_id ?? null) !== (dl.chosen_price_point_id ?? null)
        || (ll.price_override ?? null)        !== (dl.price_override ?? null)
        || !!ll.is_commissioned !== !!dl.is_commissioned
        || (ll.commission_cap_pct ?? null)    !== (dl.commission_cap_pct ?? null);
  }).length;
  return {
    line_items: { priced: repriced },
    structure_fields: {
      target_assembly_margin_pct_changed: Number(live.target_assembly_margin_pct) !== Number(draft.target_assembly_margin_pct),
    },
  };
}
