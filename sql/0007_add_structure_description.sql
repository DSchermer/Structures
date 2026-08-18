-- STRUCTURE.description — a short, one-line title for the assembly.
--
-- Construction-side field: it sits alongside part_number and build_hours, so
-- editing it advances the customer-facing CR and shows in the OM "what changed"
-- diff. Required at every check-in (gate G2), which is why this migration
-- backfills every structure that already exists — without the backfill the
-- entire committed catalog would be un-checkin-able until hand-edited.
--
-- Backfill text is derived from each structure's actual BOM (body material,
-- size, pressure class, trim) plus its variant tags. Run BEFORE deploying the
-- code that depends on this column:
--   npx wrangler d1 execute structures --remote --file=sql/0007_add_structure_description.sql

ALTER TABLE STRUCTURE       ADD COLUMN description TEXT;
ALTER TABLE DRAFT_STRUCTURE ADD COLUMN description TEXT;

----------------------------------------------------------------------
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
