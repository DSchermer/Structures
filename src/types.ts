// Shared types matching the Worker's JSON shapes.

export type Row = {
  id: string;
  spec_id: string;
  spec_number: string;
  part_number: string;
  top_level_part_number: string;
  is_variant: boolean;
  parent_part_number: string | null;
  is_subassembly: boolean;
  current_construction_revision_number: number;
  current_price_revision_number: number;
  line_item_count: number;
  sell_price: number | null;
  subassembly_cost: number | null;
  spec_tags: string[];
  general_tags: string[];
  variant_tags: string[];
  is_archived: boolean;
  is_locked: boolean;
  is_below_target: boolean;
  checkout_holder_name: string | null;
  checkout_holder_id: string | null;
  checkout_acquired_at: string | null;
  is_uncommitted_draft: boolean;
};
export type SearchResp = { rows: Row[] };
export type TagsResp = { spec: string[]; general: string[]; variant: string[] };

export type User = {
  id: string;
  username: string;
  display_name: string;
  initials: string;
  role: string;
  is_admin: number;
};
export type UsersResp = { users: User[] };

export type AppliedTag = { name: string; applied_by: string | null; applied_at: string };

export type LineItemDetail = {
  id: string;
  sort_order: number;
  component_part_number: string;
  part_description: string;
  quantity: number;
  unit_price: number | null;
  chosen_price_scope: 'component_cost' | 'subassembly_cost' | null;
  quote_number: string | null;
  price_override: number | null;
  supplier: string;
  lead_time_days: number;
  product_code: string;
  is_commissioned: boolean;
  commission_cap_pct: number | null;
  sub_assembly: {
    id: string;
    part_number: string;
    top_level_part_number: string;
  } | null;
};

export type RevisionDetail = {
  id: string;
  revision_number: number;
  author: string | null;
  committed_at: string;
  notes: string | null;
  change_set: unknown;
};

export type PricePointDetail = {
  id: string;
  price: number;
  scope: 'structure_sell' | 'subassembly_cost' | 'component_cost';
  set_at: string;
  set_by: string | null;
  tags: string[];
  is_superseded: boolean;
  derived_from_cr: string | null;
  derived_from_pr: string | null;
  target_assembly_margin_pct: number | null;
};

export type Sibling = {
  id: string;
  part_number: string;
  top_level_part_number: string;
  variant_tags: string[];
  is_current: boolean;
};

export type SpecRev = {
  id: string;
  customer_revision: string;
  recorded_at: string;
};

export type StructureDetail = {
  id: string;
  spec_id: string;
  spec_number: string;
  spec_current_customer_revision: string;
  pinned_customer_revision: string;
  part_number: string;
  top_level_part_number: string;
  is_variant: boolean;
  parent: { id: string; part_number: string } | null;
  is_subassembly: boolean;
  is_archived: boolean;
  is_locked: boolean;
  is_below_target: boolean;
  current_construction_revision_number: number;
  current_price_revision_number: number;
  build_hours: number | null;
  target_assembly_margin_pct: number | null;
  created_by_name: string | null;
  created_at: string;
  lock: {
    holder_user_id: string;
    holder_name: string;
    acquired_at: string;
  } | null;
  build_instructions: string[];
  work_instructions: string[];
  spec_tags: string[];
  general_tags: AppliedTag[];
  variant_tags: AppliedTag[];
  line_items: LineItemDetail[];
  construction_revisions: RevisionDetail[];
  price_revisions: RevisionDetail[];
  price_points: PricePointDetail[];
  base_id: string;
  siblings: Sibling[];
  spec_revisions: SpecRev[];
  viewing_at?: {
    cr_id: string;
    revision_number: number | null;
    snapshot_available: boolean;
    snapshot_taken_at?: string;
  };
};
