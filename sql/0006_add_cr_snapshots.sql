-- Per-CR point-in-time snapshot of the structure's BOM, fields, and tags.
--
-- Each row captures everything needed to render the structure detail
-- viewer as it was at that CR commit, so a sell PP (which carries a
-- derived_from_construction_revision_id) can be expanded to show
-- "the assembly tied to this price" without recomputing diffs.
--
-- Stored as JSON blobs for prototype simplicity. New commits write
-- their own row; existing CRs are backfilled from the structure's
-- current live state below (best-effort — accurate for CRs that
-- correspond to the latest committed state, approximate for older
-- CRs of structures that have evolved since).

CREATE TABLE CONSTRUCTION_REVISION_SNAPSHOT (
  construction_revision_id TEXT PRIMARY KEY REFERENCES CONSTRUCTION_REVISION(id),
  snapshot_json TEXT NOT NULL,
  taken_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Backfill from current live state. SQLite json_object / json_group_array
-- build the payloads inline so this stays a single statement per CR.
INSERT INTO CONSTRUCTION_REVISION_SNAPSHOT (construction_revision_id, snapshot_json)
SELECT
  cr.id,
  json_object(
    'structure_fields', json_object(
      'part_number',                s.part_number,
      'build_hours',                s.build_hours,
      'target_assembly_margin_pct', s.target_assembly_margin_pct,
      'spec_revision_id',           s.spec_revision_id,
      'build_instr_1',              s.build_instr_1,
      'build_instr_2',              s.build_instr_2,
      'build_instr_3',              s.build_instr_3,
      'build_instr_4',              s.build_instr_4,
      'build_instr_5',              s.build_instr_5,
      'work_instr_1',               s.work_instr_1,
      'work_instr_2',               s.work_instr_2,
      'work_instr_3',               s.work_instr_3,
      'work_instr_4',               s.work_instr_4,
      'work_instr_5',               s.work_instr_5
    ),
    'line_items', COALESCE((
      SELECT json_group_array(json_object(
        'id',                        li.id,
        'sort_order',                li.sort_order,
        'component_part_number',     li.component_part_number,
        'part_description',          li.part_description,
        'quantity',                  li.quantity,
        'unit_price',                COALESCE(pp.price, li.price_override),
        'chosen_price_point_id',     li.chosen_price_point_id,
        'price_override',            li.price_override,
        'supplier',                  li.supplier,
        'lead_time_days',            li.lead_time_days,
        'product_code',              li.product_code,
        'is_commissioned',           li.is_commissioned,
        'commission_cap_pct',        li.commission_cap_pct,
        'sub_assembly_structure_id', li.sub_assembly_structure_id
      ))
      FROM LINE_ITEM li
      LEFT JOIN PRICE_POINT pp ON pp.id = li.chosen_price_point_id
      WHERE li.structure_id = s.id
    ), '[]'),
    'tags', COALESCE((
      SELECT json_group_array(json_object('name', t.name, 'kind', t.kind))
      FROM STRUCTURE_TAG st JOIN TAG t ON t.id = st.tag_id
      WHERE st.structure_id = s.id AND t.kind IN ('general', 'variant')
    ), '[]')
  )
FROM CONSTRUCTION_REVISION cr
JOIN STRUCTURE s ON s.id = cr.structure_id;
