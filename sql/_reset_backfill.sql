-- Final step of the reset sequence. Re-applies the migration backfills
-- (target_assembly_margin_pct on sell+sub-asm PPs, CR snapshots) since
-- the seed INSERTs predate those columns and don't populate them.

UPDATE PRICE_POINT
SET target_assembly_margin_pct = (
  SELECT s.target_assembly_margin_pct
  FROM STRUCTURE s
  WHERE s.id = PRICE_POINT.structure_id
)
WHERE structure_id IS NOT NULL
  AND scope IN ('structure_sell', 'subassembly_cost');



----------------------------------------------------------------------
-- STRUCTURE.description (from 0007). Required at check-in by gate G2, so a
-- reset that skipped this would leave the whole catalog un-checkin-able.
-- Backfill — base parts
----------------------------------------------------------------------
UPDATE STRUCTURE SET description = '6in 300# lugged butterfly valve, ductile iron disc, EPDM seat'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '116T0093');
UPDATE STRUCTURE SET description = '2in 300# RF ball valve, A105 body, PEEK seat, fire-safe'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '154T1102');
UPDATE STRUCTURE SET description = '6in 600# RF WCB steam-service valve, Stellite-faced seat, 13CR wedge'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '198T0440');
UPDATE STRUCTURE SET description = '6in 300# RF trunnion ball valve, A105 body, anti-static PEEK seat, fire-safe'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '217T4501');
UPDATE STRUCTURE SET description = '12in 600# RF trunnion ball valve, A105 body, PEEK seat, topworks-mounted'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '289T6014');
UPDATE STRUCTURE SET description = '8in 150# RF gate valve, LCC body, 13CR wedge, RPTFE fire-safe seat'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '308T2210');
UPDATE STRUCTURE SET description = '6in 150# wafer butterfly valve, ductile iron disc, EPDM seat'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '333T1907');
UPDATE STRUCTURE SET description = '4in 300# RF ball valve, CF8M cast body, Viton A seat, chemical service'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '372T0501');
UPDATE STRUCTURE SET description = '4in 900# RTJ swing-check valve, 316SS body, Stellite metal seat'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '442T0925');
UPDATE STRUCTURE SET description = '8in 300# lugged butterfly valve, ductile iron disc, EPDM seat'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '471T6655');
UPDATE STRUCTURE SET description = '4in 150# wafer butterfly valve, ductile iron disc, NSF/ANSI 61 EPDM seat'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '565T4480');
UPDATE STRUCTURE SET description = '6in 300# RF gate valve, LCC body, 13CR wedge, fire-safe RPTFE seat'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '705T8821');
UPDATE STRUCTURE SET description = '8in 900# RTJ swing-check valve, 316SS body, Stellite metal seat'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '824T7700');
UPDATE STRUCTURE SET description = '4in 600# RF globe valve, WCB body'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '891T0708');
UPDATE STRUCTURE SET description = '4in 300# CF8M chemical-service valve, 316SS disc, Viton A seat'
  WHERE part_number = 'P001' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '928T2204');

----------------------------------------------------------------------
-- Backfill — variants (base description + the variant axis)
----------------------------------------------------------------------
UPDATE STRUCTURE SET description = '6in 300# lugged butterfly valve, ductile iron disc, EPDM seat — Singapore tagging'
  WHERE part_number = 'P001-SGN' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '116T0093');
UPDATE STRUCTURE SET description = '6in 600# RF WCB steam-service valve, Stellite-faced seat — high-temperature extension'
  WHERE part_number = 'P001-HT' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '198T0440');
UPDATE STRUCTURE SET description = '6in 300# RF trunnion ball valve, A105 body, PEEK seat — arctic service'
  WHERE part_number = 'P001-ARC' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '217T4501');
UPDATE STRUCTURE SET description = '12in 600# RF trunnion ball valve, A105 body, PEEK seat — arctic service'
  WHERE part_number = 'P001-ARC' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '289T6014');
UPDATE STRUCTURE SET description = '12in 600# RF trunnion ball valve, A105 body, PEEK seat — marine service'
  WHERE part_number = 'P001-MAR' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '289T6014');
UPDATE STRUCTURE SET description = '8in 150# RF gate valve, LCC body, 13CR wedge — marine service'
  WHERE part_number = 'P001-MAR' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '308T2210');
UPDATE STRUCTURE SET description = '4in 900# RTJ swing-check valve, 316SS body, Stellite seat — hazardous-area'
  WHERE part_number = 'P001-HAZ' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '442T0925');
UPDATE STRUCTURE SET description = '8in 300# lugged butterfly valve, ductile iron disc, EPDM seat — marine service'
  WHERE part_number = 'P001-MAR' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '471T6655');
UPDATE STRUCTURE SET description = '8in 300# lugged butterfly valve, ductile iron disc, EPDM seat — Singapore tagging'
  WHERE part_number = 'P001-SGN' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '471T6655');
UPDATE STRUCTURE SET description = '6in 300# RF gate valve, LCC body, 13CR wedge — sour service'
  WHERE part_number = 'P001-SOUR' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '705T8821');
UPDATE STRUCTURE SET description = '8in 900# RTJ swing-check valve, 316SS body, Stellite seat — ACME customer overlay'
  WHERE part_number = 'P001-ACME' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '824T7700');
UPDATE STRUCTURE SET description = '4in 600# RF globe valve, WCB body — arctic service'
  WHERE part_number = 'P001-ARC' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '891T0708');

----------------------------------------------------------------------
-- Backfill — sub-assemblies
----------------------------------------------------------------------
UPDATE STRUCTURE SET description = 'Electric MOV actuator sub-assembly, 2-turn'
  WHERE part_number = 'SUB-ACT-EMOV-2' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '999T0001');
UPDATE STRUCTURE SET description = '900# RTJ stud and nut bolt-kit sub-assembly'
  WHERE part_number = 'SUB-BOLT-KIT-RTJ900' AND spec_id = (SELECT id FROM SPEC WHERE spec_number = '999T0001');

-- Any structure still missing a description after this (app-created rows) keeps
-- NULL and is caught by G2 the next time it is checked in.


----------------------------------------------------------------------
-- COMPONENT catalog (from 0008). The table survives a wipe but its rows do
-- not, so it is rebuilt here from the freshly seeded LINE_ITEMs.
----------------------------------------------------------------------
-- Seed from what the catalog already knows. For each field take the most common
-- value across that component's line items; break ties on description by length,
-- so a full description wins over a fragment of one.
INSERT INTO COMPONENT
  (component_part_number, description, default_supplier, default_product_code, default_lead_time_days, created_by_user_id)
SELECT
  li.component_part_number,
  (SELECT x.part_description FROM LINE_ITEM x
    WHERE x.component_part_number = li.component_part_number
      AND x.part_description IS NOT NULL AND TRIM(x.part_description) <> ''
    GROUP BY x.part_description
    ORDER BY COUNT(*) DESC, LENGTH(x.part_description) DESC
    LIMIT 1),
  (SELECT x.supplier FROM LINE_ITEM x
    WHERE x.component_part_number = li.component_part_number AND x.supplier IS NOT NULL
    GROUP BY x.supplier ORDER BY COUNT(*) DESC LIMIT 1),
  (SELECT x.product_code FROM LINE_ITEM x
    WHERE x.component_part_number = li.component_part_number AND x.product_code IS NOT NULL
    GROUP BY x.product_code ORDER BY COUNT(*) DESC LIMIT 1),
  (SELECT x.lead_time_days FROM LINE_ITEM x
    WHERE x.component_part_number = li.component_part_number AND x.lead_time_days IS NOT NULL
    GROUP BY x.lead_time_days ORDER BY COUNT(*) DESC LIMIT 1),
  '00000000-0000-0000-0000-000000000001'
FROM LINE_ITEM li
GROUP BY li.component_part_number;

-- Any component that exists only in the price library (quoted but never used on
-- a BOM) still needs a row; its description starts as the part number for an
-- engineer to correct.
INSERT INTO COMPONENT (component_part_number, description, created_by_user_id)
SELECT DISTINCT pp.component_part_number, pp.component_part_number,
       '00000000-0000-0000-0000-000000000001'
FROM PRICE_POINT pp
WHERE pp.scope = 'component_cost'
  AND pp.component_part_number IS NOT NULL
  AND pp.component_part_number NOT IN (SELECT component_part_number FROM COMPONENT);



----------------------------------------------------------------------
-- Exact money (from 0009). Seed INSERTs write only the REAL columns, so the
-- authoritative e4 values are derived here.
----------------------------------------------------------------------
UPDATE PRICE_POINT     SET price_e4          = CAST(ROUND(price * 10000) AS INTEGER)          WHERE price IS NOT NULL;
UPDATE LINE_ITEM       SET price_override_e4 = CAST(ROUND(price_override * 10000) AS INTEGER) WHERE price_override IS NOT NULL;
UPDATE DRAFT_LINE_ITEM SET price_override_e4 = CAST(ROUND(price_override * 10000) AS INTEGER) WHERE price_override IS NOT NULL;

----------------------------------------------------------------------
-- CR snapshots. LAST: this reads STRUCTURE.description and the exact-money
-- columns, so every field it captures must already be populated above.
----------------------------------------------------------------------
INSERT INTO CONSTRUCTION_REVISION_SNAPSHOT (construction_revision_id, snapshot_json)
SELECT
  cr.id,
  json_object(
    'structure_fields', json_object(
      'part_number',                s.part_number,
      'description',                s.description,
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
